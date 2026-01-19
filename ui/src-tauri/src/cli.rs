//! Aurora CLI - Command-line interface for Aurora LLM inference
//!
//! Usage:
//!   aurora list                    - List installed models
//!   aurora pull <repo>             - Pull a model from HuggingFace
//!   aurora search <term>           - Search for GGUF models
//!   aurora run <model>             - Load a model for inference
//!   aurora chat <model> "<prompt>" - Send a chat message
//!   aurora status                  - Check backend status

use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use std::process::ExitCode;

const DEFAULT_API_BASE: &str = "http://127.0.0.1:11435";

#[derive(Parser)]
#[command(name = "aurora")]
#[command(author = "FinAI Labz")]
#[command(version = "0.1.0")]
#[command(about = "Aurora CLI - Local LLM inference with GGUF models", long_about = None)]
struct Cli {
    /// API base URL (default: http://127.0.0.1:11435)
    #[arg(short, long, global = true, default_value = DEFAULT_API_BASE)]
    api: String,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// List installed models
    List,
    
    /// Pull a model from HuggingFace or Civitai
    Pull {
        /// Repository ID (e.g., TheBloke/Llama-2-7B-GGUF or TheBloke/Llama-2-7B-GGUF:Q4_K_M)
        repo: String,
    },
    
    /// Search for GGUF models on HuggingFace
    Search {
        /// Search term
        term: String,
    },
    
    /// Check backend status
    Status,
    
    /// Send a chat message to a model
    Chat {
        /// Model name
        #[arg(short, long)]
        model: Option<String>,
        
        /// Chat prompt
        prompt: String,
    },
    
    /// Generate text (completion mode)
    Generate {
        /// Model name
        #[arg(short, long)]
        model: Option<String>,
        
        /// Prompt text
        prompt: String,
    },
    
    /// Show available model templates
    Templates,
    
    /// List custom models
    CustomModels,
}

#[derive(Debug, Deserialize)]
struct HealthResponse {
    status: String,
    llama: Option<bool>,
    default_model: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Model {
    name: String,
    path: String,
    source: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    models: Vec<Model>,
}

#[derive(Debug, Deserialize)]
struct HfModel {
    id: String,
    likes: Option<i64>,
    downloads: Option<i64>,
}

#[derive(Debug, Serialize)]
struct PullRequest {
    name: String,
    repo_id: String,
    filename: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    subfolder: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PullResponse {
    status: String,
    name: Option<String>,
}

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
}

#[derive(Debug, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    message: ChatMessageResponse,
}

#[derive(Debug, Deserialize)]
struct ChatMessageResponse {
    content: String,
}

#[derive(Debug, Serialize)]
struct GenerateRequest {
    model: String,
    prompt: String,
}

#[derive(Debug, Deserialize)]
struct GenerateResponse {
    response: String,
}

#[derive(Debug, Deserialize)]
struct Template {
    id: String,
    name: String,
    description: String,
}

#[derive(Debug, Deserialize)]
struct CustomModel {
    name: String,
    base_model: String,
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CustomModelsResponse {
    models: Vec<CustomModel>,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let api_base = cli.api;

    let rt = tokio::runtime::Runtime::new().expect("Failed to create runtime");
    
    match rt.block_on(run_command(cli.command, &api_base)) {
        Ok(_) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("Error: {}", e);
            ExitCode::FAILURE
        }
    }
}

async fn run_command(cmd: Commands, api_base: &str) -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();

    match cmd {
        Commands::Status => {
            let resp: HealthResponse = client
                .get(format!("{}/health", api_base))
                .send()
                .await?
                .json()
                .await?;
            
            println!("Aurora Backend Status");
            println!("─────────────────────");
            println!("Status: {}", resp.status);
            println!("Model loaded: {}", resp.llama.unwrap_or(false));
            if let Some(model) = resp.default_model {
                println!("Default model: {}", model);
            }
        }

        Commands::List => {
            let resp: ModelsResponse = client
                .get(format!("{}/api/models", api_base))
                .send()
                .await?
                .json()
                .await?;
            
            if resp.models.is_empty() {
                println!("No models installed.");
                println!("Use 'aurora pull <repo>' to download a model.");
            } else {
                println!("Installed Models");
                println!("────────────────");
                for model in resp.models {
                    let source = model.source.unwrap_or_else(|| "local".to_string());
                    println!("  {} [{}]", model.name, source);
                    println!("    Path: {}", model.path);
                }
            }
        }

        Commands::Pull { repo } => {
            println!("Detecting GGUF files from {}...", repo);
            
            // Parse repo and optional tag
            let (repo_id, tag) = if let Some(idx) = repo.rfind(':') {
                let potential_tag = &repo[idx + 1..];
                if !potential_tag.contains('/') {
                    (repo[..idx].to_string(), Some(potential_tag.to_string()))
                } else {
                    (repo.clone(), None)
                }
            } else {
                (repo.clone(), None)
            };

            // Normalize slashes (replace backslash with forward slash)
            let repo_id = repo_id.replace('\\', "/");

            // Validate repo format
            if !repo_id.contains('/') {
                return Err(format!(
                    "Invalid repository format: '{}'\nExpected format: owner/repo (e.g., TinyLlama/TinyLlama-1.1B-Chat-v1.0-GGUF)",
                    repo_id
                ).into());
            }

            // Fetch repo info from HuggingFace
            let hf_url = format!("https://huggingface.co/api/models/{}", repo_id);
            let hf_resp = client.get(&hf_url).send().await?;

            if !hf_resp.status().is_success() {
                return Err(format!(
                    "Repository not found: {}\nMake sure the repository exists on huggingface.co/{}",
                    repo_id, repo_id
                ).into());
            }

            let hf_data: serde_json::Value = hf_resp.json().await?;
            let siblings = hf_data["siblings"].as_array()
                .ok_or("No files found in repository")?;
            
            let gguf_files: Vec<&str> = siblings
                .iter()
                .filter_map(|s| s["rfilename"].as_str())
                .filter(|f| f.to_lowercase().ends_with(".gguf"))
                .collect();

            if gguf_files.is_empty() {
                return Err("No GGUF files found in repository".into());
            }

            // Select file based on tag or default to first
            let selected = if let Some(ref t) = tag {
                let t_lower = t.to_lowercase();
                gguf_files.iter()
                    .find(|f| f.to_lowercase().contains(&t_lower))
                    .copied()
                    .unwrap_or(gguf_files[0])
            } else {
                gguf_files[0]
            };

            println!("Found {} GGUF file(s), pulling: {}", gguf_files.len(), selected);

            let name = repo_id.split('/').last().unwrap_or(&repo_id).to_string();
            
            let pull_req = PullRequest {
                name: name.clone(),
                repo_id: repo_id.clone(),
                filename: selected.to_string(),
                subfolder: None,
            };

            let resp = client
                .post(format!("{}/api/pull", api_base))
                .json(&pull_req)
                .send()
                .await?;

            if resp.status().is_success() {
                let pull_resp: PullResponse = resp.json().await?;
                println!("✓ Pull started: {} ({})", pull_resp.name.unwrap_or(name), pull_resp.status);
                println!("Check the Aurora app or logs for download progress.");
            } else {
                let err_text = resp.text().await?;
                return Err(format!("Pull failed: {}", err_text).into());
            }
        }

        Commands::Search { term } => {
            println!("Searching HuggingFace for GGUF models: {}...", term);
            
            let url = format!(
                "https://huggingface.co/api/models?search={}&filter=gguf",
                urlencoding::encode(&term)
            );
            
            let resp = client.get(&url).send().await?;
            let models: Vec<HfModel> = resp.json().await?;
            
            let gguf_models: Vec<_> = models.into_iter().take(15).collect();
            
            if gguf_models.is_empty() {
                println!("No GGUF models found for '{}'", term);
            } else {
                println!("Found {} GGUF model(s):", gguf_models.len());
                println!("────────────────────────");
                for model in gguf_models {
                    let likes = model.likes.unwrap_or(0);
                    let downloads = model.downloads.unwrap_or(0);
                    println!("  {} ({} ↓, {} ♥)", model.id, downloads, likes);
                }
                println!();
                println!("To pull a model: aurora pull <repo-id>");
            }
        }

        Commands::Chat { model, prompt } => {
            // Get default model if not specified
            let model_name = if let Some(m) = model {
                m
            } else {
                let health: HealthResponse = client
                    .get(format!("{}/health", api_base))
                    .send()
                    .await?
                    .json()
                    .await?;
                health.default_model.unwrap_or_else(|| "default".to_string())
            };

            let chat_req = ChatRequest {
                model: model_name.clone(),
                messages: vec![ChatMessage {
                    role: "user".to_string(),
                    content: prompt,
                }],
            };

            println!("Sending to {}...", model_name);
            
            let resp = client
                .post(format!("{}/api/chat", api_base))
                .json(&chat_req)
                .send()
                .await?;

            if resp.status().is_success() {
                let chat_resp: ChatResponse = resp.json().await?;
                println!();
                println!("{}", chat_resp.message.content);
            } else {
                let err_text = resp.text().await?;
                return Err(format!("Chat failed: {}", err_text).into());
            }
        }

        Commands::Generate { model, prompt } => {
            let model_name = if let Some(m) = model {
                m
            } else {
                let health: HealthResponse = client
                    .get(format!("{}/health", api_base))
                    .send()
                    .await?
                    .json()
                    .await?;
                health.default_model.unwrap_or_else(|| "default".to_string())
            };

            let gen_req = GenerateRequest {
                model: model_name.clone(),
                prompt,
            };

            println!("Generating with {}...", model_name);
            
            let resp = client
                .post(format!("{}/api/generate", api_base))
                .json(&gen_req)
                .send()
                .await?;

            if resp.status().is_success() {
                let gen_resp: GenerateResponse = resp.json().await?;
                println!();
                println!("{}", gen_resp.response);
            } else {
                let err_text = resp.text().await?;
                return Err(format!("Generate failed: {}", err_text).into());
            }
        }

        Commands::Templates => {
            let resp: Vec<Template> = client
                .get(format!("{}/api/templates", api_base))
                .send()
                .await?
                .json()
                .await?;
            
            println!("Available Model Templates");
            println!("─────────────────────────");
            for tpl in resp {
                println!("  {} ({}) - {}", tpl.name, tpl.id, tpl.description);
            }
        }

        Commands::CustomModels => {
            let resp: CustomModelsResponse = client
                .get(format!("{}/api/custom-models", api_base))
                .send()
                .await?
                .json()
                .await?;
            
            if resp.models.is_empty() {
                println!("No custom models defined.");
                println!("Create custom models in the Aurora app under Models > Custom Models.");
            } else {
                println!("Custom Models");
                println!("─────────────");
                for model in resp.models {
                    println!("  {} (base: {})", model.name, model.base_model);
                    if let Some(desc) = model.description {
                        println!("    {}", desc);
                    }
                }
            }
        }
    }

    Ok(())
}
