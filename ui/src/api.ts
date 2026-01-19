const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? "http://127.0.0.1:11435";

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function listModels() {
  return handle<{ models: Array<Record<string, string>> }>(await fetch(`${API_BASE}/api/models`));
}

export async function removeModel(name: string) {
  return handle<{ status: string; name: string }>(
    await fetch(`${API_BASE}/api/models/${encodeURIComponent(name)}`, { method: "DELETE" })
  );
}

export async function getSettings() {
  return handle<Record<string, string | number>>(await fetch(`${API_BASE}/api/settings`));
}

export async function saveSettings(payload: Record<string, unknown>) {
  return handle<{ status: string }>(
    await fetch(`${API_BASE}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
}

export async function pullModel(payload: Record<string, unknown>) {
  return handle<{ status: string; name: string }>(
    await fetch(`${API_BASE}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
}

// Send a log line to the backend log stream (for frontend errors)
export async function logToBackend(message: string) {
  try {
    await fetch(`${API_BASE}/api/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
  } catch {
    // Silently ignore if backend is down
  }
}

export async function detectGgufFromRepo(repo: string) {
  // Parse Ollama-style syntax: "provider/input:tag" -> { provider, input, tag }
  const raw = repo.trim();
  let tag: string | undefined;
  let provider: "hf" | "civitai" = /civitai/i.test(raw) ? "civitai" : "hf";
  let input = raw;

  // Check for Ollama-style tag (e.g., :7b, :latest, :Q4_K_M)
  const colonIdx = input.lastIndexOf(":");
  if (colonIdx > 0 && !input.substring(colonIdx).includes("/")) {
    tag = input.substring(colonIdx + 1).toLowerCase();
    input = input.substring(0, colonIdx);
  }

  if (provider === "civitai") {
    // Accept civitai URLs or shorthand: civitai:<id>, civitai.com/models/<id>, /modelversions/<id>
    const idMatch = input.match(/(\d+)(?!.*\d)/);
    const modelId = idMatch ? idMatch[1] : null;
    if (!modelId) {
      await logToBackend(`✗ [DETECT] Could not parse Civitai model id from '${repo}'`);
      throw new Error("Could not parse Civitai model id");
    }

    const inspectUrl = `https://civitai.com/api/v1/models/${modelId}`;
    await logToBackend(`→ [DETECT] GET ${inspectUrl}`);
    const res = await fetch(inspectUrl);
    if (!res.ok) {
      const body = await res.text();
      const errMsg = `Failed to inspect Civitai model ${modelId}: HTTP ${res.status}`;
      await logToBackend(`✗ [DETECT] ${errMsg}; url=${inspectUrl}; response="${(body || "").slice(0, 400)}"`);
      throw new Error(errMsg);
    }

    const data = (await res.json()) as any;
    const versions = (data?.modelVersions || []) as Array<any>;
    if (!versions.length) {
      const errMsg = `No versions found for Civitai model ${modelId}`;
      await logToBackend(`✗ [DETECT] ${errMsg}`);
      throw new Error(errMsg);
    }

    const version = [...versions].sort((a, b) => (b?.id || 0) - (a?.id || 0))[0];
    const files = ((version?.files as Array<any>) || []).filter(
      (f) => (f?.name || f?.fileName || "").toLowerCase().endsWith(".gguf") || String(f?.type || "").toLowerCase() === "gguf"
    );

    if (!files.length) {
      const errMsg = `No GGUF files found in Civitai model ${modelId}`;
      await logToBackend(`✗ [DETECT] ${errMsg}`);
      throw new Error(errMsg);
    }

    await logToBackend(
      `← [DETECT] Found ${files.length} Civitai GGUF file(s): ${files
        .slice(0, 5)
        .map((f) => f.name || f.fileName)
        .join(", ")}${files.length > 5 ? "..." : ""}`
    );

    let picked = files[0];
    if (tag) {
      const tagLower = tag.toLowerCase();
      const match = files.find((f) => {
        const name = ((f.name || f.fileName || "") as string).toLowerCase();
        if (name.includes(tagLower)) return true;
        if (/^\d+b$/.test(tagLower) && name.includes(tagLower)) return true;
        return false;
      });
      if (match) {
        picked = match;
        await logToBackend(`→ [DETECT] Tag '${tag}' matched Civitai file: ${picked.name || picked.fileName || "unknown"}`);
      } else {
        await logToBackend(`→ [DETECT] Tag '${tag}' not found on Civitai; using default`);
      }
    }

    const downloadUrl = picked.downloadUrl as string;
    const filename =
      picked.name ||
      picked.fileName ||
      (downloadUrl ? downloadUrl.split("/").pop() : `civitai-${modelId}.gguf`) ||
      `civitai-${modelId}.gguf`;
    const name = (data?.name as string) || `civitai-${modelId}`;

    await logToBackend(`✓ [DETECT] Selected Civitai file: ${filename}`);

    return {
      repo_id: `civitai-${modelId}`,
      filename,
      subfolder: undefined,
      name,
      direct_url: downloadUrl,
      source: "civitai",
    };
  }

  // Default: Hugging Face
  let repoId = input;
  await logToBackend(`→ [DETECT] Inspecting HuggingFace repo: ${repoId}${tag ? ` (tag: ${tag})` : ""}`);

  const inspectUrl = `https://huggingface.co/api/models/${repoId}`;
  await logToBackend(`→ [DETECT] GET ${inspectUrl}`);

  const res = await fetch(inspectUrl);
  if (!res.ok) {
    const body = await res.text();
    const errMsg = `Failed to inspect repo ${repoId}: HTTP ${res.status}${res.status === 401 ? " (repo may be private or not found)" : ""}`;
    await logToBackend(`✗ [DETECT] ${errMsg}; url=${inspectUrl}; response="${(body || "").slice(0, 400)}"`);
    throw new Error(errMsg);
  }

  const data = (await res.json()) as { siblings?: Array<{ rfilename?: string }> };
  const ggufs = (data.siblings || [])
    .map((s) => s.rfilename || "")
    .filter((f) => f.toLowerCase().endsWith(".gguf"));

  if (!ggufs.length) {
    const errMsg = `No GGUF files found in ${repoId}`;
    await logToBackend(`✗ [DETECT] ${errMsg}`);
    throw new Error(errMsg);
  }

  await logToBackend(`← [DETECT] Found ${ggufs.length} GGUF file(s): ${ggufs.slice(0, 5).join(", ")}${ggufs.length > 5 ? "..." : ""}`);

  // If tag provided, try to match it to a GGUF file
  let picked: string;
  if (tag) {
    // Common tag mappings: 7b -> Q4_K_M-7B, latest -> smallest file, Q4_K_M -> exact match
    const tagLower = tag.toLowerCase();
    const matched = ggufs.find((f) => {
      const fLower = f.toLowerCase();
      // Try exact quant match (e.g., q4_k_m, q8_0)
      if (fLower.includes(tagLower)) return true;
      // Try size match (e.g., 7b, 13b, 70b)
      if (/^\d+b$/.test(tagLower) && fLower.includes(tagLower)) return true;
      return false;
    });
    picked = matched || ggufs[0];
    if (matched) {
      await logToBackend(`→ [DETECT] Tag '${tag}' matched: ${picked}`);
    } else {
      await logToBackend(`→ [DETECT] Tag '${tag}' not found, using default: ${picked}`);
    }
  } else {
    // Default: pick smallest file (often the most quantized/fastest)
    ggufs.sort((a, b) => a.length - b.length);
    picked = ggufs[0];
  }

  const parts = picked.split("/");
  const filename = parts.pop() || picked;
  const subfolder = parts.length ? parts.join("/") : undefined;
  const name = repoId.split("/").pop() || repoId;

  await logToBackend(`✓ [DETECT] Selected: ${filename}${subfolder ? ` (subfolder: ${subfolder})` : ""}`);

  return { repo_id: repoId, filename, subfolder, name };
}

// Fetch popular models from local configuration
export async function listAiWikiModels() {
  const res = await fetch(`${API_BASE}/api/popular-models`);
  if (!res.ok) throw new Error(`Popular models fetch failed: ${res.status}`);
  return (await res.json()) as Array<{ id: string; title?: string; description?: string; gguf?: string; recommended_quant?: string }>;
}

// Custom model types
export interface CustomModelParameters {
  temperature: number;
  top_p: number;
  top_k?: number;
  repeat_penalty?: number;
  context_length?: number;
  max_tokens: number;
  stop_sequences: string[];
}

export interface CustomModelConfig {
  name: string;
  base_model: string;
  system_prompt?: string;
  template?: string;
  parameters: CustomModelParameters;
  description?: string;
}

export interface ModelTemplate {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  template: string;
  parameters: CustomModelParameters;
}

// Get available templates for creating custom models
export async function getTemplates() {
  return handle<ModelTemplate[]>(await fetch(`${API_BASE}/api/templates`));
}

// List all custom models
export async function listCustomModels() {
  return handle<{ models: CustomModelConfig[] }>(await fetch(`${API_BASE}/api/custom-models`));
}

// Create a new custom model
export async function createCustomModel(config: CustomModelConfig) {
  return handle<{ status: string; name: string }>(
    await fetch(`${API_BASE}/api/custom-models`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    })
  );
}

// Get a specific custom model
export async function getCustomModel(name: string) {
  return handle<CustomModelConfig>(
    await fetch(`${API_BASE}/api/custom-models/${encodeURIComponent(name)}`)
  );
}

// Delete a custom model
export async function deleteCustomModel(name: string) {
  return handle<{ status: string; name: string }>(
    await fetch(`${API_BASE}/api/custom-models/${encodeURIComponent(name)}`, { method: "DELETE" })
  );
}

export async function chatOnce(payload: Record<string, unknown>) {
  return handle<{ message: { content: string } }>(
    await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
}

export async function generate(payload: Record<string, unknown>) {
  return handle<{ response: string }>(
    await fetch(`${API_BASE}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
}

export async function health() {
  try {
    return handle<{ status: string }>(await fetch(`${API_BASE}/health`, { cache: "no-store" }));
  } catch {
    return { status: "down" } as { status: string };
  }
}

export async function searchHuggingFace(term: string) {
  if (!term.trim()) return [];
  const url = `https://huggingface.co/api/models?search=${encodeURIComponent(term)}&filter=gguf`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HF search failed: ${res.status}`);
  const data = (await res.json()) as Array<Record<string, any>>;
  return data
    .filter((m) => (m.tags || []).includes("gguf"))
    .slice(0, 15)
    .map((m) => ({
      id: m.id,
      likes: m.likes,
      downloads: m.downloads,
      lastModified: m.lastModified,
      private: m.private,
      cardData: m.cardData || {},
    }));
}

export function logsStream(onLine: (line: string) => void, onError?: (err: string) => void) {
  const source = new EventSource(`${API_BASE}/api/logs/stream`);
  source.onmessage = (e) => {
    onLine(e.data);
  };
  source.onerror = () => {
    onError?.("Log stream disconnected; backend may be offline.");
    source.close();
  };
  return () => source.close();
}

export async function fetchModelInfo(repoId: string) {
  const res = await fetch(`https://huggingface.co/api/models/${repoId}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HF model fetch failed: ${res.status}`);
  }
  return res.json() as Promise<{
    pipeline_tag?: string;
    tags?: string[];
    modelId?: string;
  }>;
}

// ============================================================================
// Session & Memory Management APIs
// ============================================================================

export interface Session {
  id: string;
  created_at: string;
  updated_at: string;
  model?: string;
  title?: string;
  message_count: number;
}

export interface SessionMessage {
  id: number;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
  metadata?: string;
}

export interface EpisodicMemory {
  id: number;
  event_type: string;
  summary: string;
  session_id?: string;
  created_at: string;
  metadata?: string;
}

export interface SessionContext {
  session: Session;
  messages: SessionMessage[];
  recent_memory: EpisodicMemory[];
}

// Create a new chat session
export async function createSession(model?: string, title?: string) {
  return handle<{ session: Session }>(
    await fetch(`${API_BASE}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, title }),
    })
  );
}

// List all sessions
export async function listSessions() {
  return handle<{ sessions: Session[]; current_session_id?: string }>(
    await fetch(`${API_BASE}/api/sessions`)
  );
}

// Get session with full context
export async function getSession(sessionId: string) {
  return handle<{ context: SessionContext }>(
    await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}`)
  );
}

// Delete a session (clear its context)
export async function deleteSession(sessionId: string) {
  return handle<{ status: string; session_id: string }>(
    await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    })
  );
}

// Clear ALL sessions (full context reset)
export async function clearAllSessions() {
  return handle<{ status: string; message: string }>(
    await fetch(`${API_BASE}/api/sessions/clear`, {
      method: "POST",
    })
  );
}

// Get messages for a specific session
export async function getSessionMessages(sessionId: string) {
  return handle<{ messages: SessionMessage[] }>(
    await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/messages`)
  );
}

// Chat with session context (auto-persists messages)
export async function chatWithSession(payload: {
  session_id?: string;
  model?: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  options?: { max_tokens?: number; temperature?: number; top_p?: number };
  persist?: boolean;
}) {
  return handle<{
    model: string;
    message: { role: string; content: string };
    done: boolean;
    session_id: string;
    message_count: number;
  }>(
    await fetch(`${API_BASE}/api/chat/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
}

// Get episodic memories
export async function getMemories(limit?: number, type?: string) {
  const params = new URLSearchParams();
  if (limit) params.set("limit", String(limit));
  if (type) params.set("type", type);
  const query = params.toString() ? `?${params.toString()}` : "";
  return handle<{ memories: EpisodicMemory[] }>(
    await fetch(`${API_BASE}/api/memory${query}`)
  );
}

// Record an episodic memory
export async function recordMemory(
  event_type: string,
  summary: string,
  session_id?: string,
  metadata?: string
) {
  return handle<EpisodicMemory>(
    await fetch(`${API_BASE}/api/memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_type, summary, session_id, metadata }),
    })
  );
}

// Clear all episodic memory
export async function clearMemory() {
  return handle<{ status: string; message: string }>(
    await fetch(`${API_BASE}/api/memory/clear`, {
      method: "POST",
    })
  );
}

export { API_BASE };
