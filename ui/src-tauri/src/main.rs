#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::VecDeque;
use std::fs;
use std::io::Write;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use futures_util::StreamExt;
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::LlamaModel;
use llama_cpp_2::sampling::LlamaSampler;
use parking_lot::RwLock;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tokio::task::JoinHandle;
use tower_http::cors::{Any, CorsLayer};
use tracing::{info, warn};

// ============================================================================
// Log handling
// ============================================================================

#[derive(Clone)]
struct LogTx(Arc<broadcast::Sender<String>>);

#[derive(Clone, Default)]
struct LogBuffer {
    entries: Arc<RwLock<VecDeque<(u64, String)>>>,
    counter: Arc<RwLock<u64>>,
}

impl LogBuffer {
    fn new(capacity: usize) -> Self {
        Self {
            entries: Arc::new(RwLock::new(VecDeque::with_capacity(capacity))),
            counter: Arc::new(RwLock::new(0)),
        }
    }

    fn push(&self, msg: String) {
        let mut entries = self.entries.write();
        let mut counter = self.counter.write();
        *counter += 1;
        let id = *counter;
        if entries.len() >= 500 {
            entries.pop_front();
        }
        entries.push_back((id, msg));
    }

    fn tail(&self, limit: usize) -> Vec<String> {
        let entries = self.entries.read();
        entries
            .iter()
            .rev()
            .take(limit)
            .map(|(_, msg)| msg.clone())
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    }
}

// ============================================================================
// Model registry (JSON file storage)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ModelRegistry {
    models: Vec<ModelEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ModelEntry {
    name: String,
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    repo_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    filename: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
}

fn load_registry(path: &Path) -> ModelRegistry {
    if !path.exists() {
        return ModelRegistry::default();
    }
    match std::fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => ModelRegistry::default(),
    }
}

fn save_registry(path: &Path, registry: &ModelRegistry) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(registry)?;
    std::fs::write(path, content)?;
    Ok(())
}

// ============================================================================
// Config
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppConfig {
    host: String,
    port: u16,
    storage_dir: PathBuf,
    default_model: String,
    #[serde(default)]
    models: std::collections::HashMap<String, String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 11435,
            storage_dir: PathBuf::from("./models"),
            default_model: String::new(),
            models: std::collections::HashMap::new(),
        }
    }
}

fn load_config(path: &Path) -> AppConfig {
    if !path.exists() {
        return AppConfig::default();
    }
    match std::fs::read_to_string(path) {
        Ok(content) => serde_yaml_ng::from_str(&content)
            .or_else(|_| serde_json::from_str(&content))
            .unwrap_or_default(),
        Err(_) => AppConfig::default(),
    }
}

fn save_config(path: &Path, config: &AppConfig) -> anyhow::Result<()> {
    let content = serde_json::to_string_pretty(config)?;
    std::fs::write(path, content)?;
    Ok(())
}

// ============================================================================
// Inference state using llama-cpp-2
// ============================================================================

struct InferenceEngine {
    backend: LlamaBackend,
    model: LlamaModel,
    model_name: String,
}

impl InferenceEngine {
    fn new(gguf_path: &Path, model_name: &str) -> anyhow::Result<Self> {
        let backend = LlamaBackend::init()?;
        let model_params = LlamaModelParams::default();
        let model = LlamaModel::load_from_file(&backend, gguf_path, &model_params)?;

        Ok(Self {
            backend,
            model,
            model_name: model_name.to_string(),
        })
    }

    fn generate(&self, prompt: &str, max_tokens: u32) -> anyhow::Result<String> {
        let ctx_params = LlamaContextParams::default().with_n_ctx(std::num::NonZeroU32::new(2048));
        let mut ctx = self.model.new_context(&self.backend, ctx_params)?;

        // Tokenize the prompt
        let tokens = self
            .model
            .str_to_token(prompt, llama_cpp_2::model::AddBos::Always)?;

        let n_ctx = ctx.n_ctx() as usize;
        if tokens.len() > n_ctx {
            return Err(anyhow::anyhow!("Prompt too long"));
        }

        // Create a batch and add tokens
        let mut batch = LlamaBatch::new(n_ctx, 1);
        for (i, token) in tokens.iter().enumerate() {
            let is_last = i == tokens.len() - 1;
            batch.add(*token, i as i32, &[0], is_last)?;
        }

        // Decode the batch
        ctx.decode(&mut batch)?;

        // Create a greedy sampler
        let mut sampler = LlamaSampler::greedy();

        // Generate tokens
        let mut output_tokens = Vec::new();
        let mut n_cur = tokens.len();

        for _ in 0..max_tokens {
            // Sample the next token using the sampler
            let new_token = sampler.sample(&ctx, batch.n_tokens() - 1);

            // Check for EOS
            if self.model.is_eog_token(new_token) {
                break;
            }

            output_tokens.push(new_token);

            // Prepare for next iteration
            batch.clear();
            batch.add(new_token, n_cur as i32, &[0], true)?;
            n_cur += 1;

            ctx.decode(&mut batch)?;
        }

        // Convert tokens to string
        let output = output_tokens
            .iter()
            .filter_map(|t| self.model.token_to_str(*t, llama_cpp_2::model::Special::Tokenize).ok())
            .collect::<String>();

        Ok(output)
    }
}

// ============================================================================
// App state
// ============================================================================

#[derive(Clone)]
struct AppState {
    logs: LogTx,
    log_buffer: LogBuffer,
    inference: Arc<RwLock<Option<Arc<InferenceEngine>>>>,
    config: Arc<RwLock<AppConfig>>,
    config_path: PathBuf,
}

impl AppState {
    fn log(&self, msg: String) {
        let timestamp = Utc::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string();
        let line = format!("{} INFO {}", timestamp, msg);
        self.log_buffer.push(line.clone());
        let _ = self.logs.0.send(line);
    }

    fn log_request(&self, endpoint: &str, method: &str, details: &str) {
        let timestamp = Utc::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string();
        let line = format!("{} → [{}] {} {}", timestamp, method, endpoint, details);
        self.log_buffer.push(line.clone());
        let _ = self.logs.0.send(line);
    }

    fn log_response(&self, endpoint: &str, status: &str, details: &str) {
        let timestamp = Utc::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string();
        let line = format!("{} ← [{}] {} {}", timestamp, status, endpoint, details);
        self.log_buffer.push(line.clone());
        let _ = self.logs.0.send(line);
    }

    fn log_error(&self, msg: String) {
        let timestamp = Utc::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string();
        let line = format!("{} ERROR {}", timestamp, msg);
        self.log_buffer.push(line.clone());
        let _ = self.logs.0.send(line);
    }

    fn log_model(&self, action: &str, model: &str, details: &str) {
        let timestamp = Utc::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string();
        let line = format!("{} MODEL [{}] {} - {}", timestamp, action, model, details);
        self.log_buffer.push(line.clone());
        let _ = self.logs.0.send(line);
    }

    fn registry_path(&self) -> PathBuf {
        self.config.read().storage_dir.join("models.json")
    }

    fn custom_models_path(&self) -> PathBuf {
        self.config.read().storage_dir.join("custom-models.json")
    }
}

// ============================================================================
// Request/Response types
// ============================================================================

#[derive(Deserialize)]
struct ChatRequest {
    model: Option<String>,
    messages: Vec<Message>,
    #[serde(default)]
    #[allow(dead_code)]
    stream: bool,
    #[serde(default)]
    #[allow(dead_code)]
    options: Option<InferenceOptions>,
}

#[derive(Deserialize, Serialize, Clone)]
struct Message {
    role: String,
    content: String,
}

#[derive(Deserialize, Default)]
struct InferenceOptions {
    #[serde(default = "default_max_tokens")]
    max_tokens: u32,
    #[serde(default = "default_temperature")]
    #[allow(dead_code)]
    temperature: f32,
    #[serde(default = "default_top_p")]
    #[allow(dead_code)]
    top_p: f32,
}

fn default_max_tokens() -> u32 {
    512
}
fn default_temperature() -> f32 {
    0.7
}
fn default_top_p() -> f32 {
    0.95
}

#[derive(Serialize)]
struct ChatResponse {
    model: String,
    message: Message,
    done: bool,
}

#[derive(Deserialize)]
struct GenerateRequest {
    model: Option<String>,
    prompt: String,
    #[serde(default)]
    #[allow(dead_code)]
    stream: bool,
    #[serde(default)]
    #[allow(dead_code)]
    options: Option<InferenceOptions>,
}

#[derive(Serialize)]
struct GenerateResponse {
    model: String,
    response: String,
    done: bool,
}

#[derive(Deserialize)]
struct PullRequest {
    name: String,
    repo_id: String,
    filename: String,
    #[serde(default)]
    subfolder: Option<String>,
    #[serde(default)]
    revision: Option<String>,
    #[serde(default)]
    direct_url: Option<String>,
    #[serde(default)]
    source: Option<String>,
}

#[derive(Serialize)]
struct PullResponse {
    status: String,
    name: String,
}

#[derive(Serialize)]
struct DeleteResponse {
    status: String,
    name: String,
}

#[derive(Serialize)]
struct ModelsResponse {
    models: Vec<ModelInfo>,
}

#[derive(Serialize)]
struct ModelInfo {
    name: String,
    path: String,
    source: String,
}

#[derive(Deserialize)]
struct SettingsUpdate {
    host: Option<String>,
    storage_dir: Option<String>,
    default_model: Option<String>,
}

#[derive(Deserialize)]
struct FrontendLog {
    message: String,
    #[serde(default)]
    level: Option<String>,
}

#[derive(Deserialize)]
struct LogsQuery {
    #[serde(default = "default_log_limit")]
    limit: usize,
}

fn default_log_limit() -> usize {
    200
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PopularModel {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    recommended_quant: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    gguf: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PopularModelsConfig {
    models: Vec<PopularModel>,
}

// ============================================================================
// Custom Model (Modelfile-like) structures
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CustomModelConfig {
    /// Name for this custom model
    name: String,
    /// Base model to use (path or name of an existing model)
    base_model: String,
    /// System prompt template
    #[serde(default)]
    system_prompt: Option<String>,
    /// User prompt template (use {{prompt}} as placeholder)
    #[serde(default)]
    template: Option<String>,
    /// Model parameters
    #[serde(default)]
    parameters: CustomModelParameters,
    /// Description of the custom model
    #[serde(default)]
    description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct CustomModelParameters {
    #[serde(default = "default_temperature")]
    temperature: f32,
    #[serde(default = "default_top_p")]
    top_p: f32,
    #[serde(default)]
    top_k: Option<u32>,
    #[serde(default)]
    repeat_penalty: Option<f32>,
    #[serde(default)]
    context_length: Option<u32>,
    #[serde(default = "default_max_tokens")]
    max_tokens: u32,
    #[serde(default)]
    stop_sequences: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CustomModelRegistry {
    models: Vec<CustomModelConfig>,
}

impl Default for CustomModelRegistry {
    fn default() -> Self {
        Self { models: Vec::new() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ModelTemplate {
    id: String,
    name: String,
    description: String,
    system_prompt: String,
    template: String,
    parameters: CustomModelParameters,
}

fn get_default_templates() -> Vec<ModelTemplate> {
    vec![
        ModelTemplate {
            id: "assistant".to_string(),
            name: "General Assistant".to_string(),
            description: "A helpful, harmless AI assistant for general tasks".to_string(),
            system_prompt: "You are a helpful AI assistant. Answer questions accurately and concisely.".to_string(),
            template: "### User:\n{{prompt}}\n\n### Assistant:\n".to_string(),
            parameters: CustomModelParameters {
                temperature: 0.7,
                top_p: 0.95,
                top_k: Some(40),
                repeat_penalty: Some(1.1),
                context_length: Some(2048),
                max_tokens: 512,
                stop_sequences: vec!["### User:".to_string()],
            },
        },
        ModelTemplate {
            id: "coder".to_string(),
            name: "Code Assistant".to_string(),
            description: "Specialized for programming and code generation".to_string(),
            system_prompt: "You are an expert programmer. Write clean, efficient, well-commented code. Explain your solutions when asked.".to_string(),
            template: "### Task:\n{{prompt}}\n\n### Solution:\n```".to_string(),
            parameters: CustomModelParameters {
                temperature: 0.2,
                top_p: 0.9,
                top_k: Some(50),
                repeat_penalty: Some(1.05),
                context_length: Some(4096),
                max_tokens: 1024,
                stop_sequences: vec!["### Task:".to_string(), "```\n\n".to_string()],
            },
        },
        ModelTemplate {
            id: "writer".to_string(),
            name: "Creative Writer".to_string(),
            description: "For creative writing, stories, and content generation".to_string(),
            system_prompt: "You are a creative writer with a vivid imagination. Write engaging, well-structured prose.".to_string(),
            template: "Write the following:\n\n{{prompt}}\n\n---\n\n".to_string(),
            parameters: CustomModelParameters {
                temperature: 0.9,
                top_p: 0.95,
                top_k: Some(80),
                repeat_penalty: Some(1.15),
                context_length: Some(2048),
                max_tokens: 1024,
                stop_sequences: vec!["---".to_string()],
            },
        },
        ModelTemplate {
            id: "analyst".to_string(),
            name: "Data Analyst".to_string(),
            description: "For data analysis, insights, and structured outputs".to_string(),
            system_prompt: "You are a data analyst. Provide clear, accurate analysis with supporting reasoning.".to_string(),
            template: "Analysis Request:\n{{prompt}}\n\nAnalysis:\n".to_string(),
            parameters: CustomModelParameters {
                temperature: 0.3,
                top_p: 0.85,
                top_k: Some(30),
                repeat_penalty: Some(1.0),
                context_length: Some(2048),
                max_tokens: 768,
                stop_sequences: vec!["Analysis Request:".to_string()],
            },
        },
        ModelTemplate {
            id: "translator".to_string(),
            name: "Translator".to_string(),
            description: "For language translation tasks".to_string(),
            system_prompt: "You are a professional translator. Provide accurate translations preserving the original meaning and tone.".to_string(),
            template: "Translate the following:\n\n{{prompt}}\n\nTranslation:\n".to_string(),
            parameters: CustomModelParameters {
                temperature: 0.1,
                top_p: 0.8,
                top_k: Some(20),
                repeat_penalty: Some(1.0),
                context_length: Some(2048),
                max_tokens: 512,
                stop_sequences: vec!["Translate the following:".to_string()],
            },
        },
        ModelTemplate {
            id: "chat".to_string(),
            name: "Conversational Chat".to_string(),
            description: "Natural conversation with friendly personality".to_string(),
            system_prompt: "You are a friendly conversational AI. Be warm, engaging, and helpful while maintaining natural dialogue.".to_string(),
            template: "Human: {{prompt}}\n\nAssistant: ".to_string(),
            parameters: CustomModelParameters {
                temperature: 0.8,
                top_p: 0.95,
                top_k: Some(50),
                repeat_penalty: Some(1.1),
                context_length: Some(2048),
                max_tokens: 256,
                stop_sequences: vec!["Human:".to_string()],
            },
        },
    ]
}

fn load_custom_models(path: &Path) -> CustomModelRegistry {
    if !path.exists() {
        return CustomModelRegistry::default();
    }
    match std::fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => CustomModelRegistry::default(),
    }
}

fn save_custom_models(path: &Path, registry: &CustomModelRegistry) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(registry)?;
    std::fs::write(path, content)?;
    Ok(())
}

// ============================================================================
// Handlers
// ============================================================================

async fn health_handler(State(state): State<AppState>) -> Json<serde_json::Value> {
    let config = state.config.read();
    let inference = state.inference.read();
    let model_name = inference
        .as_ref()
        .map(|s| s.model_name.clone())
        .unwrap_or_else(|| config.default_model.clone());
    let llama_ok = inference.is_some();
    drop(config);
    drop(inference);

    state.log_request("/health", "GET", &format!("model={}, loaded={}", model_name, llama_ok));
    Json(serde_json::json!({
        "status": "ok",
        "llama": llama_ok,
        "default_model": model_name,
    }))
}

async fn get_settings_handler(State(state): State<AppState>) -> Json<serde_json::Value> {
    let config = state.config.read();
    state.log_request("/api/settings", "GET", "fetching configuration");
    state.log_response("/api/settings", "200", &format!("storage_dir={:?}", config.storage_dir));
    Json(serde_json::json!({
        "host": config.host,
        "storage_dir": config.storage_dir,
        "default_model": config.default_model,
        "llama_server_path": "embedded",
        "llama_server_host": config.host,
        "llama_server_port": config.port,
        "llama_server_args": "",
    }))
}

async fn post_settings_handler(
    State(state): State<AppState>,
    Json(body): Json<SettingsUpdate>,
) -> Json<serde_json::Value> {
    state.log_request("/api/settings", "POST", "updating configuration");
    {
        let mut config = state.config.write();
        if let Some(ref host) = body.host {
            state.log(format!("  → host: {}", host));
            config.host = host.clone();
        }
        if let Some(ref storage_dir) = body.storage_dir {
            state.log(format!("  → storage_dir: {}", storage_dir));
            config.storage_dir = PathBuf::from(storage_dir);
        }
        if let Some(ref default_model) = body.default_model {
            state.log(format!("  → default_model: {}", default_model));
            config.default_model = default_model.clone();
        }
    }
    let config = state.config.read().clone();
    if let Err(e) = save_config(&state.config_path, &config) {
        state.log_error(format!("Failed to save config: {}", e));
        warn!("Failed to save config: {}", e);
    }
    state.log_response("/api/settings", "200", "configuration saved");
    Json(serde_json::json!({ "status": "ok" }))
}

async fn delete_model_handler(
    State(state): State<AppState>,
    axum::extract::Path(name): axum::extract::Path<String>,
) -> impl axum::response::IntoResponse {
    use axum::http::StatusCode;

    state.log_request("/api/models", "DELETE", &name);

    // Config-defined models cannot be removed from the API.
    {
        let config = state.config.read();
        if config.models.contains_key(&name) {
            state.log_error(format!("Refusing to delete config-defined model: {}", name));
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "Model is defined in config.yaml; remove it there."
                })),
            );
        }
    }

    let storage_root = state
        .config
        .read()
        .storage_dir
        .canonicalize()
        .unwrap_or_else(|_| state.config.read().storage_dir.clone());

    let mut registry = load_registry(&state.registry_path());
    if let Some(entry) = registry.models.iter().find(|m| m.name == name).cloned() {
        if let Ok(path) = PathBuf::from(&entry.path).canonicalize() {
            if path.starts_with(&storage_root) {
                let _ = if path.is_dir() {
                    fs::remove_dir_all(&path)
                } else {
                    fs::remove_file(&path)
                };
            } else {
                warn!("Refusing to delete path outside storage_dir: {:?}", path);
            }
        }

        registry.models.retain(|m| m.name != name);
        if let Err(e) = save_registry(&state.registry_path(), &registry) {
            state.log_error(format!("Failed to save registry: {}", e));
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to update registry" })),
            );
        }

        state.log_response("/api/models", "200", &format!("removed {}", name));
        return (
            StatusCode::OK,
            Json(serde_json::json!(DeleteResponse {
                status: "removed".to_string(),
                name
            })),
        );
    }

    // If not in registry, try removing discovered/local files under storage_dir.
    let candidate_dir = storage_root.join(&name);
    if candidate_dir.is_dir() {
        let _ = fs::remove_dir_all(&candidate_dir);
        state.log_response("/api/models", "200", &format!("removed {}", name));
        return (
            StatusCode::OK,
            Json(serde_json::json!(DeleteResponse {
                status: "removed".to_string(),
                name
            })),
        );
    }

    // Look for a gguf file directly under storage_root that matches the name.
    if let Ok(entries) = fs::read_dir(&storage_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file()
                && path.extension().map(|e| e == "gguf").unwrap_or(false)
                && path
                    .file_stem()
                    .map(|s| s.to_string_lossy().eq_ignore_ascii_case(&name))
                    .unwrap_or(false)
            {
                let _ = fs::remove_file(&path);
                state.log_response("/api/models", "200", &format!("removed {}", name));
                return (
                    StatusCode::OK,
                    Json(serde_json::json!(DeleteResponse {
                        status: "removed".to_string(),
                        name
                    })),
                );
            }
        }
    }

    state.log_error(format!("Model not found for deletion: {}", name));
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({ "error": "Model not found" })),
    )
}

async fn frontend_log_handler(
    State(state): State<AppState>,
    Json(body): Json<FrontendLog>,
) -> Json<serde_json::Value> {
    let message = body.message.trim();
    if message.is_empty() {
        return Json(serde_json::json!({
            "status": "ignored",
            "reason": "empty message"
        }));
    }

    let level = body.level.unwrap_or_else(|| "FRONTEND".to_string());
    state.log(format!("[{}] {}", level.to_uppercase(), message));
    Json(serde_json::json!({ "status": "ok" }))
}

async fn logs_handler(
    State(state): State<AppState>,
    axum::extract::Query(query): axum::extract::Query<LogsQuery>,
) -> Json<serde_json::Value> {
    let lines = state.log_buffer.tail(query.limit);
    Json(serde_json::json!({ "lines": lines }))
}

async fn logs_stream_handler(
    State(state): State<AppState>,
) -> axum::response::Sse<impl futures::Stream<Item = Result<axum::response::sse::Event, axum::Error>>>
{
    let mut rx = state.logs.0.subscribe();
    let stream = async_stream::stream! {
        while let Ok(msg) = rx.recv().await {
            yield Ok(axum::response::sse::Event::default().data(msg));
        }
    };
    axum::response::Sse::new(stream)
}

async fn popular_models_handler(
    State(state): State<AppState>,
) -> Result<Json<Vec<PopularModel>>, (axum::http::StatusCode, String)> {
    state.log_request("/api/popular-models", "GET", "fetching popular models catalog");

    // Try multiple locations for the popular-models.yaml file
    let possible_paths = vec![
        // Development: relative to current directory (ui/src-tauri -> ui -> root)
        PathBuf::from("popular-models.yaml"),
        PathBuf::from("../popular-models.yaml"),
        PathBuf::from("../../popular-models.yaml"),
        PathBuf::from("../../../popular-models.yaml"),
        // Production: relative to executable
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.join("popular-models.yaml")))
            .unwrap_or_else(|| PathBuf::from("popular-models.yaml")),
        // Tauri resource directory (bundled)
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.join("../Resources/popular-models.yaml")))
            .unwrap_or_else(|| PathBuf::from("popular-models.yaml")),
        // User config directory
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("aurora")
            .join("popular-models.yaml"),
    ];

    for path in &possible_paths {
        if path.exists() {
            match std::fs::read_to_string(path) {
                Ok(content) => {
                    match serde_yaml_ng::from_str::<PopularModelsConfig>(&content) {
                        Ok(config) => {
                            state.log_response(
                                "/api/popular-models",
                                "200",
                                &format!("loaded {} models from {:?}", config.models.len(), path),
                            );
                            return Ok(Json(config.models));
                        }
                        Err(e) => {
                            state.log_error(format!("Failed to parse popular-models.yaml: {}", e));
                            return Err((
                                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                                format!("Failed to parse popular-models.yaml: {}", e),
                            ));
                        }
                    }
                }
                Err(e) => {
                    state.log_error(format!("Failed to read {:?}: {}", path, e));
                    continue;
                }
            }
        }
    }

    // Return empty list if file not found (graceful fallback)
    state.log_response("/api/popular-models", "200", "no popular-models.yaml found, returning empty list");
    Ok(Json(Vec::new()))
}

// ============================================================================
// Custom Model Handlers
// ============================================================================

/// Get available templates for creating custom models
async fn get_templates_handler(
    State(state): State<AppState>,
) -> Json<Vec<ModelTemplate>> {
    state.log_request("/api/templates", "GET", "fetching model templates");
    let templates = get_default_templates();
    state.log_response("/api/templates", "200", &format!("returning {} templates", templates.len()));
    Json(templates)
}

/// List all custom models
async fn list_custom_models_handler(
    State(state): State<AppState>,
) -> Json<CustomModelRegistry> {
    state.log_request("/api/custom-models", "GET", "listing custom models");
    let registry = load_custom_models(&state.custom_models_path());
    state.log_response("/api/custom-models", "200", &format!("found {} custom models", registry.models.len()));
    Json(registry)
}

/// Create a new custom model
async fn create_custom_model_handler(
    State(state): State<AppState>,
    Json(body): Json<CustomModelConfig>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    state.log_request("/api/custom-models", "POST", &format!("creating custom model: {}", body.name));

    // Validate the custom model
    if body.name.trim().is_empty() {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            "Model name cannot be empty".to_string(),
        ));
    }

    if body.base_model.trim().is_empty() {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            "Base model must be specified".to_string(),
        ));
    }

    // Load existing custom models
    let mut registry = load_custom_models(&state.custom_models_path());

    // Check if a model with this name already exists
    if registry.models.iter().any(|m| m.name == body.name) {
        // Update existing model
        registry.models.retain(|m| m.name != body.name);
        state.log("Updating existing custom model".to_string());
    }

    // Add the new model
    registry.models.push(body.clone());

    // Save the registry
    if let Err(e) = save_custom_models(&state.custom_models_path(), &registry) {
        state.log_error(format!("Failed to save custom model: {}", e));
        return Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to save custom model: {}", e),
        ));
    }

    state.log_response("/api/custom-models", "201", &format!("created custom model: {}", body.name));
    Ok(Json(serde_json::json!({
        "status": "created",
        "name": body.name,
        "base_model": body.base_model
    })))
}

/// Get a specific custom model
async fn get_custom_model_handler(
    State(state): State<AppState>,
    axum::extract::Path(name): axum::extract::Path<String>,
) -> Result<Json<CustomModelConfig>, (axum::http::StatusCode, String)> {
    state.log_request("/api/custom-models", "GET", &format!("fetching custom model: {}", name));

    let registry = load_custom_models(&state.custom_models_path());

    if let Some(model) = registry.models.into_iter().find(|m| m.name == name) {
        state.log_response("/api/custom-models", "200", &format!("found custom model: {}", name));
        Ok(Json(model))
    } else {
        state.log_error(format!("Custom model not found: {}", name));
        Err((
            axum::http::StatusCode::NOT_FOUND,
            format!("Custom model '{}' not found", name),
        ))
    }
}

/// Delete a custom model
async fn delete_custom_model_handler(
    State(state): State<AppState>,
    axum::extract::Path(name): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    state.log_request("/api/custom-models", "DELETE", &format!("deleting custom model: {}", name));

    let mut registry = load_custom_models(&state.custom_models_path());
    let original_len = registry.models.len();
    registry.models.retain(|m| m.name != name);

    if registry.models.len() == original_len {
        state.log_error(format!("Custom model not found: {}", name));
        return Err((
            axum::http::StatusCode::NOT_FOUND,
            format!("Custom model '{}' not found", name),
        ));
    }

    if let Err(e) = save_custom_models(&state.custom_models_path(), &registry) {
        state.log_error(format!("Failed to delete custom model: {}", e));
        return Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to delete custom model: {}", e),
        ));
    }

    state.log_response("/api/custom-models", "200", &format!("deleted custom model: {}", name));
    Ok(Json(serde_json::json!({
        "status": "deleted",
        "name": name
    })))
}

async fn models_handler(State(state): State<AppState>) -> Json<ModelsResponse> {
    state.log_request("/api/models", "GET", "listing available models");
    let config = state.config.read();
    let registry = load_registry(&state.registry_path());

    let mut models = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for (name, path) in &config.models {
        models.push(ModelInfo {
            name: name.clone(),
            path: path.clone(),
            source: "config".to_string(),
        });
        seen.insert(name.clone());
    }

    for entry in registry.models {
        if !seen.contains(&entry.name) {
            models.push(ModelInfo {
                name: entry.name.clone(),
                path: entry.path,
                source: entry.source.unwrap_or_else(|| "registry".to_string()),
            });
            seen.insert(entry.name);
        }
    }

    let storage_dir = config.storage_dir.clone();
    drop(config);

    if storage_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&storage_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    if let Ok(subentries) = std::fs::read_dir(&path) {
                        for subentry in subentries.flatten() {
                            let subpath = subentry.path();
                            if subpath.extension().map(|e| e == "gguf").unwrap_or(false) {
                                let name = path
                                    .file_name()
                                    .unwrap_or_default()
                                    .to_string_lossy()
                                    .to_string();
                                if !seen.contains(&name) {
                                    models.push(ModelInfo {
                                        name: name.clone(),
                                        path: subpath.to_string_lossy().to_string(),
                                        source: "discovered".to_string(),
                                    });
                                    seen.insert(name);
                                }
                                break;
                            }
                        }
                    }
                } else if path.extension().map(|e| e == "gguf").unwrap_or(false) {
                    let name = path
                        .file_stem()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();
                    if !seen.contains(&name) {
                        models.push(ModelInfo {
                            name: name.clone(),
                            path: path.to_string_lossy().to_string(),
                            source: "discovered".to_string(),
                        });
                        seen.insert(name);
                    }
                }
            }
        }
    }

    state.log_response("/api/models", "200", &format!("found {} models", models.len()));
    Json(ModelsResponse { models })
}

async fn chat_handler(
    State(state): State<AppState>,
    Json(body): Json<ChatRequest>,
) -> Result<Json<ChatResponse>, (axum::http::StatusCode, String)> {
    let config = state.config.read();
    let model_name = body
        .model
        .clone()
        .unwrap_or_else(|| config.default_model.clone());
    let storage_dir = config.storage_dir.clone();
    drop(config);

    let msg_count = body.messages.len();
    let last_msg = body.messages.last().map(|m| m.content.chars().take(50).collect::<String>()).unwrap_or_default();
    state.log_request("/api/chat", "POST", &format!("model={}, messages={}, last=\"{}...\"", model_name, msg_count, last_msg));

    // Load model if needed
    {
        let inference = state.inference.read();
        let needs_load = inference
            .as_ref()
            .map(|i| i.model_name != model_name)
            .unwrap_or(true);
        drop(inference);

        if needs_load && !model_name.is_empty() {
            state.log_model("LOADING", &model_name, "initializing inference engine");
            match load_model(&storage_dir, &model_name) {
                Ok(engine) => {
                    let mut inference = state.inference.write();
                    *inference = Some(Arc::new(engine));
                    state.log_model("READY", &model_name, "model loaded successfully");
                }
                Err(e) => {
                    state.log_error(format!("Failed to load model {}: {}", model_name, e));
                    return Err((
                        axum::http::StatusCode::NOT_FOUND,
                        format!("Model '{}' not found: {}", model_name, e),
                    ));
                }
            }
        }
    }

    let inference = state.inference.read();
    let engine = inference.as_ref().ok_or_else(|| {
        state.log_error("No model loaded for inference".to_string());
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "No model loaded".to_string(),
        )
    })?;

    let prompt = body
        .messages
        .iter()
        .map(|m| {
            let role = match m.role.as_str() {
                "system" => "[SYSTEM]",
                "assistant" => "[ASSISTANT]",
                _ => "[USER]",
            };
            format!("{}\n{}\n", role, m.content)
        })
        .collect::<String>()
        + "[ASSISTANT]\n";

    state.log_model("INFERENCE", &model_name, &format!("prompt={}B, generating...", prompt.len()));

    let max_tokens = body
        .options
        .as_ref()
        .map(|o| o.max_tokens)
        .unwrap_or(default_max_tokens());

    let start = std::time::Instant::now();
    let output = engine.generate(&prompt, max_tokens).map_err(|e| {
        state.log_error(format!("Inference failed: {}", e));
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("Inference error: {}", e),
        )
    })?;
    let elapsed = start.elapsed();

    state.log_model("COMPLETE", &model_name, &format!("output={}B, time={:.2}s", output.len(), elapsed.as_secs_f64()));
    state.log_response("/api/chat", "200", &format!("generated {} chars in {:.2}s", output.len(), elapsed.as_secs_f64()));

    Ok(Json(ChatResponse {
        model: model_name,
        message: Message {
            role: "assistant".to_string(),
            content: output,
        },
        done: true,
    }))
}

async fn generate_handler(
    State(state): State<AppState>,
    Json(body): Json<GenerateRequest>,
) -> Result<Json<GenerateResponse>, (axum::http::StatusCode, String)> {
    let config = state.config.read();
    let model_name = body
        .model
        .clone()
        .unwrap_or_else(|| config.default_model.clone());
    let storage_dir = config.storage_dir.clone();
    drop(config);

    let prompt_preview = body.prompt.chars().take(50).collect::<String>();
    state.log_request("/api/generate", "POST", &format!("model={}, prompt=\"{}...\"", model_name, prompt_preview));

    {
        let inference = state.inference.read();
        let needs_load = inference
            .as_ref()
            .map(|i| i.model_name != model_name)
            .unwrap_or(true);
        drop(inference);

        if needs_load && !model_name.is_empty() {
            state.log_model("LOADING", &model_name, "initializing inference engine");
            match load_model(&storage_dir, &model_name) {
                Ok(engine) => {
                    let mut inference = state.inference.write();
                    *inference = Some(Arc::new(engine));
                    state.log_model("READY", &model_name, "model loaded successfully");
                }
                Err(e) => {
                    state.log_error(format!("Failed to load model {}: {}", model_name, e));
                    return Err((
                        axum::http::StatusCode::NOT_FOUND,
                        format!("Model '{}' not found: {}", model_name, e),
                    ));
                }
            }
        }
    }

    let inference = state.inference.read();
    let engine = inference.as_ref().ok_or_else(|| {
        state.log_error("No model loaded for inference".to_string());
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "No model loaded".to_string(),
        )
    })?;

    state.log_model("INFERENCE", &model_name, &format!("prompt={}B, generating...", body.prompt.len()));

    let max_tokens = body
        .options
        .as_ref()
        .map(|o| o.max_tokens)
        .unwrap_or(default_max_tokens());

    let start = std::time::Instant::now();
    let output = engine.generate(&body.prompt, max_tokens).map_err(|e| {
        state.log_error(format!("Inference failed: {}", e));
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("Inference error: {}", e),
        )
    })?;
    let elapsed = start.elapsed();

    state.log_model("COMPLETE", &model_name, &format!("output={}B, time={:.2}s", output.len(), elapsed.as_secs_f64()));
    state.log_response("/api/generate", "200", &format!("generated {} chars in {:.2}s", output.len(), elapsed.as_secs_f64()));

    Ok(Json(GenerateResponse {
        model: model_name,
        response: output,
        done: true,
    }))
}

async fn pull_handler(
    State(state): State<AppState>,
    Json(body): Json<PullRequest>,
) -> Json<PullResponse> {
    let storage_dir = state.config.read().storage_dir.clone();
    let registry_path = state.registry_path();

    state.log_request(
        "/api/pull",
        "POST",
        &format!(
            "name={}, repo={}, file={}, direct={}",
            body.name,
            body.repo_id,
            body.filename,
            body.direct_url.clone().unwrap_or_default()
        ),
    );

    let name = body.name.clone();
    let repo_id = body.repo_id.clone();
    let filename = body.filename.clone();
    let subfolder = body.subfolder.clone();
    let direct_url = body.direct_url.clone();
    let source = body.source.clone();
    let state_clone = state.clone();

    tokio::spawn(async move {
        let source_desc = direct_url
            .clone()
            .unwrap_or_else(|| format!("{}/{}", repo_id, filename));
        state_clone.log_model(
            "DOWNLOAD",
            &name,
            &format!("starting from {}", source_desc),
        );

        match download_model(
            &storage_dir,
            &name,
            &repo_id,
            &filename,
            subfolder.as_deref(),
            direct_url.as_deref(),
        )
        .await
        {
            Ok(model_path) => {
                let mut registry = load_registry(&registry_path);
                registry.models.retain(|m| m.name != name);
                registry.models.push(ModelEntry {
                    name: name.clone(),
                    path: model_path.to_string_lossy().to_string(),
                    repo_id: Some(repo_id.clone()),
                    filename: Some(filename.clone()),
                    source: source.clone().or_else(|| Some("pulled".to_string())),
                });
                if let Err(e) = save_registry(&registry_path, &registry) {
                    state_clone.log_error(format!("Failed to save registry: {}", e));
                    warn!("Failed to save registry: {}", e);
                }
                state_clone.log_model("DOWNLOADED", &name, &format!("saved to {:?}", model_path));
            }
            Err(e) => {
                state_clone.log_error(format!("Download failed for {}: {}", name, e));
            }
        }
    });

    state.log_response("/api/pull", "202", &format!("download queued for {}", body.name));
    Json(PullResponse {
        status: "queued".to_string(),
        name: body.name,
    })
}

async fn index_handler() -> axum::response::Html<&'static str> {
    axum::response::Html(
        r#"<!DOCTYPE html>
<html>
  <head><title>Aurora API</title></head>
  <body style="font-family: sans-serif; max-width: 720px; margin: 40px auto;">
    <h1>Aurora API</h1>
    <p>From the brain of FinAI Labz - copyright 2026.</p>
    <p>This server powers the Aurora desktop app.</p>
    <p>Endpoints: /health, /api/models, /api/popular-models, /api/chat, /api/generate, /api/pull, /api/settings, /api/log, /api/logs</p>
  </body>
</html>"#,
    )
}

// ============================================================================
// Model loading
// ============================================================================

fn load_model(storage_dir: &Path, model_name: &str) -> anyhow::Result<InferenceEngine> {
    let gguf = find_model_file(storage_dir, model_name)?;
    info!("loading model from {:?}", gguf);
    InferenceEngine::new(&gguf, model_name)
}

fn find_model_file(storage_dir: &Path, model_name: &str) -> anyhow::Result<PathBuf> {
    let direct_path = PathBuf::from(model_name);
    if direct_path.exists() && direct_path.extension().map(|e| e == "gguf").unwrap_or(false) {
        return Ok(direct_path);
    }

    let candidate_dir = storage_dir.join(model_name);
    if candidate_dir.is_dir() {
        let mut ggufs: Vec<PathBuf> = Vec::new();
        for entry in std::fs::read_dir(&candidate_dir)? {
            let p = entry?.path();
            if p.extension().map(|e| e == "gguf").unwrap_or(false) {
                ggufs.push(p);
            }
        }
        ggufs.sort();
        for gguf in &ggufs {
            let name = gguf.file_name().unwrap_or_default().to_string_lossy();
            if name.contains("-00001-of-") {
                return Ok(gguf.clone());
            }
        }
        if let Some(first) = ggufs.first() {
            return Ok(first.clone());
        }
    }

    let direct = storage_dir.join(format!("{}.gguf", model_name));
    if direct.exists() {
        return Ok(direct);
    }

    Err(anyhow::anyhow!("No GGUF found for model '{}'", model_name))
}

// ============================================================================
// Model download from HuggingFace
// ============================================================================

async fn download_model(
    storage_dir: &Path,
    name: &str,
    repo_id: &str,
    filename: &str,
    subfolder: Option<&str>,
    direct_url: Option<&str>,
) -> anyhow::Result<PathBuf> {
    let model_dir = storage_dir.join(name);
    std::fs::create_dir_all(&model_dir)?;

    let split_re = Regex::new(r"^(?P<prefix>.+)-00001-of-(?P<total>\d+)\.gguf$")?;
    let files_to_download: Vec<(String, String)> = if let Some(url) = direct_url {
        vec![(filename.to_string(), url.to_string())]
    } else if let Some(caps) = split_re.captures(filename) {
        let prefix = caps.name("prefix").unwrap().as_str();
        let total: u32 = caps.name("total").unwrap().as_str().parse()?;
        (1..=total)
            .map(|i| {
                let file = format!("{}-{:05}-of-{:05}.gguf", prefix, i, total);
                let url = if let Some(sf) = subfolder {
                    format!(
                        "https://huggingface.co/{}/resolve/main/{}/{}",
                        repo_id, sf, file
                    )
                } else {
                    format!("https://huggingface.co/{}/resolve/main/{}", repo_id, file)
                };
                (file, url)
            })
            .collect()
    } else {
        let file = filename.to_string();
        let url = if let Some(sf) = subfolder {
            format!(
                "https://huggingface.co/{}/resolve/main/{}/{}",
                repo_id, sf, file
            )
        } else {
            format!("https://huggingface.co/{}/resolve/main/{}", repo_id, file)
        };
        vec![(file, url)]
    };

    let client = reqwest::Client::new();

    for (file, url) in files_to_download {
        let dest_path = model_dir.join(&file);
        if dest_path.exists() {
            info!("file already exists: {:?}", dest_path);
            continue;
        }

        info!("downloading {} to {:?}", url, dest_path);

        let response = client
            .get(url)
            .header("User-Agent", "Aurora/0.1")
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(anyhow::anyhow!(
                "Failed to download {}: {}",
                file,
                response.status()
            ));
        }

        let mut dest_file = std::fs::File::create(&dest_path)?;
        let mut stream = response.bytes_stream();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            dest_file.write_all(&chunk)?;
        }

        info!("downloaded: {:?}", dest_path);
    }

    Ok(model_dir.join(filename))
}

// ============================================================================
// Router
// ============================================================================

fn router(state: AppState) -> Router {
    // Allow all origins for local development (Tauri uses tauri://localhost)
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/", get(index_handler))
        .route("/health", get(health_handler))
        .route("/api/settings", get(get_settings_handler))
        .route("/api/settings", post(post_settings_handler))
        .route("/api/models", get(models_handler))
        .route("/api/models/:name", axum::routing::delete(delete_model_handler))
        .route("/api/popular-models", get(popular_models_handler))
        .route("/api/templates", get(get_templates_handler))
        .route("/api/custom-models", get(list_custom_models_handler))
        .route("/api/custom-models", post(create_custom_model_handler))
        .route("/api/custom-models/:name", get(get_custom_model_handler))
        .route("/api/custom-models/:name", axum::routing::delete(delete_custom_model_handler))
        .route("/api/chat", post(chat_handler))
        .route("/api/generate", post(generate_handler))
        .route("/api/pull", post(pull_handler))
        .route("/api/log", post(frontend_log_handler))
        .route("/api/logs", get(logs_handler))
        .route("/api/logs/stream", get(logs_stream_handler))
        .layer(cors)
        .with_state(state)
}

// ============================================================================
// Server spawn
// ============================================================================

async fn spawn_server(state: AppState) -> anyhow::Result<(SocketAddr, JoinHandle<()>)> {
    let port = state.config.read().port;
    let app = router(state.clone());
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?;
    let addr = listener.local_addr()?;
    info!("Aurora backend starting on {}", addr);
    state.log(format!("Aurora backend starting on {}", addr));

    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Ok((addr, handle))
}

// ============================================================================
// Tauri commands
// ============================================================================

#[derive(Deserialize, Default)]
struct StartRequest {
    model: Option<String>,
    storage_dir: Option<String>,
}

#[tauri::command]
async fn start_sidecar(
    log_tx: tauri::State<'_, LogTx>,
    log_buffer: tauri::State<'_, LogBuffer>,
    req: Option<StartRequest>,
) -> Result<String, String> {
    let tx = log_tx.inner().clone();
    let buffer = log_buffer.inner().clone();

    let config_path = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("aurora")
        .join("config.json");

    let mut config = load_config(&config_path);

    if let Some(ref r) = req {
        if let Some(ref sd) = r.storage_dir {
            config.storage_dir = PathBuf::from(sd);
        }
        if let Some(ref m) = r.model {
            config.default_model = m.clone();
        }
    }

    std::fs::create_dir_all(&config.storage_dir).ok();

    let app_state = AppState {
        logs: tx,
        log_buffer: buffer,
        inference: Arc::new(RwLock::new(None)),
        config: Arc::new(RwLock::new(config)),
        config_path,
    };

    match spawn_server(app_state).await {
        Ok((addr, _)) => {
            let msg = format!("Aurora backend listening at {}", addr);
            info!("{}", msg);
            Ok(msg)
        }
        Err(e) => Err(e.to_string()),
    }
}

// ============================================================================
// Main
// ============================================================================

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let (log_tx, _rx) = broadcast::channel::<String>(1000);
    let log_state = LogTx(Arc::new(log_tx.clone()));
    let log_buffer = LogBuffer::new(500);

    // Pre-create app state for auto-start
    let config_path = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("aurora")
        .join("config.json");
    let config = load_config(&config_path);
    std::fs::create_dir_all(&config.storage_dir).ok();

    let auto_start_state = AppState {
        logs: LogTx(Arc::new(log_tx)),
        log_buffer: log_buffer.clone(),
        inference: Arc::new(RwLock::new(None)),
        config: Arc::new(RwLock::new(config)),
        config_path,
    };

    tauri::Builder::default()
        .manage(log_state)
        .manage(log_buffer)
        .invoke_handler(tauri::generate_handler![start_sidecar])
        .setup(move |_app| {
            // Auto-start the backend server
            let state = auto_start_state.clone();
            tauri::async_runtime::spawn(async move {
                match spawn_server(state).await {
                    Ok((addr, _)) => info!("Aurora backend auto-started on {}", addr),
                    Err(e) => warn!("Failed to auto-start backend: {}", e),
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
