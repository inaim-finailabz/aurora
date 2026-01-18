import { useEffect, useMemo, useState, useRef } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  API_BASE,
  chatOnce,
  generate,
  getSettings,
  health,
  listModels,
  logsStream,
  removeModel,
  pullModel,
  saveSettings,
  detectGgufFromRepo,
  listAiWikiModels,
} from "./api";
import "./style.css";
import { useI18n } from "./i18n";
import logo from "./assets/logo.svg";
import { open } from "@tauri-apps/api/dialog";
import AuroraIcon from "./components/icons/AuroraIcon";
import ThemeToggle from "./components/ThemeToggle";
import AboutModal from "./components/AboutModal";
import HomeIcon from "./components/icons/HomeIcon";
import ModelsIcon from "./components/icons/ModelsIcon";
import SettingsIcon from "./components/icons/SettingsIcon";
import LogsIcon from "./components/icons/LogsIcon";
import HelpIcon from "./components/icons/HelpIcon";
import TerminalIcon from "./components/icons/TerminalIcon";
import { invoke } from "@tauri-apps/api/tauri";

const navIcons: Record<string, any> = {
  home: HomeIcon,
  models: ModelsIcon,
  settings: SettingsIcon,
  logs: LogsIcon,
  help: HelpIcon,
  terminal: TerminalIcon,
};

type Message = { role: "user" | "assistant"; content: string };

const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ChatPanel({ defaultModel }: { defaultModel: string | undefined }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [promptName, setPromptName] = useState("");
  const [saved, setSaved] = useState<{ name: string; prompt: string }[]>(() => {
    try {
      const raw = localStorage.getItem("aurora_saved_prompts");
      return raw ? (JSON.parse(raw) as { name: string; prompt: string }[]) : [];
    } catch {
      return [];
    }
  });
  const [improved, setImproved] = useState<string>("");
  const [model, setModel] = useState(defaultModel || "");
  const models = useQuery({ queryKey: ["models"], queryFn: listModels });
  const { t } = useI18n();
  const chat = useMutation({
    mutationFn: chatOnce,
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: "assistant", content: data.message?.content || "" }]);
    },
  });

  useEffect(() => {
    if (!model && models.data?.models?.length) {
      setModel(models.data.models[0].name);
    }
  }, [models.data, model]);

  const sendPrompt = () => {
    if (!prompt.trim()) return;
    const newMessages: Message[] = [...messages, { role: "user" as const, content: prompt }];
    setMessages(newMessages);
    setPrompt("");
    chat.mutate({
      model: model || defaultModel,
      messages: newMessages,
      stream: false,
    });
  };

  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [sideWidth, setSideWidth] = useState<number>(() => {
    const fromStorage = localStorage.getItem("aurora_side_width");
    const n = parseInt(String(fromStorage || "320"), 10);
    return isNaN(n) ? 320 : n;
  });
  const [resizing, setResizing] = useState(false);
  const startXRef = useRef<number | null>(null);
  const startWidthRef = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSideCollapsed((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!resizing) localStorage.setItem("aurora_side_width", String(sideWidth));
  }, [sideWidth, resizing]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizing || startXRef.current === null || startWidthRef.current === null) return;
      const delta = startXRef.current - e.clientX;
      const newWidth = Math.min(640, Math.max(180, startWidthRef.current + delta));
      setSideWidth(newWidth);
    };
    const onUp = () => {
      if (!resizing) return;
      setResizing(false);
      startXRef.current = null;
      startWidthRef.current = null;
      localStorage.setItem("aurora_side_width", String(sideWidth));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizing, sideWidth]);

  const onSeparatorMouseDown = (e: React.MouseEvent) => {
    startXRef.current = e.clientX;
    startWidthRef.current = sideWidth;
    setResizing(true);
  };

  return (
    <div className="panel chat-panel">
      <div className="chat-panel-header">
        <h2>{t("chatTitle")}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="model-select">
            <label>{t("modelLabel")}</label>
            <select className="model-select-select" value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">— choose model —</option>
              {(models.data?.models || []).map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <ThemeToggle defaultTheme="light" />
        </div>
      </div>

      <div className="chat-layout">
        <main className="chat-main">
          <div className="chat-window">
            {messages.map((m, idx) => (
              <div key={idx} className={`message ${m.role}`}>
                <strong>{m.role === "user" ? "You" : "Assistant"}:</strong> {m.content}
              </div>
            ))}
          </div>

          <label>{t("promptLabel")}</label>
          <textarea
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("promptPlaceholder")}
          />

          <div className="input-row">
            <input
              value={promptName}
              onChange={(e) => setPromptName(e.target.value)}
              placeholder={t("promptName")}
            />
            <button
              type="button"
              className="pick-btn"
              onClick={() => {
                if (!prompt.trim()) return;
                const entry = { name: promptName || `Prompt ${saved.length + 1}`, prompt };
                const next = [...saved, entry];
                setSaved(next);
                localStorage.setItem("aurora_saved_prompts", JSON.stringify(next));
              }}
              disabled={!prompt.trim()}
            >
              {t("savePrompt")}
            </button>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button className="primary" onClick={sendPrompt} disabled={chat.isPending}>
              {chat.isPending ? t("thinking") : t("send")}
            </button>
            <p className="status">{chat.isError ? (chat.error as Error).message : ""}</p>
          </div>
        </main>

        <div
          className={`side-separator ${resizing ? "resizing" : ""}`}
          onMouseDown={onSeparatorMouseDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize side panel"
        />

        <aside
          className={`chat-side ${sideCollapsed ? "collapsed" : ""}`} 
          aria-hidden={sideCollapsed}
          style={{ width: sideCollapsed ? 44 : sideWidth }}
        >
          <button className="side-toggle icon-btn" aria-label={sideCollapsed ? "Expand" : "Collapse"} onClick={() => setSideCollapsed((v) => !v)}>
            {sideCollapsed ? "›" : "‹"}
          </button>
          <div className="side-content">
            <div className="panel">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 600 }}>{t("favoritesTitle")}</div>
                <button
                  className="pick-btn"
                  onClick={() => {
                    setSaved([]);
                    localStorage.removeItem("aurora_saved_prompts");
                  }}
                >
                  Clear
                </button>
              </div>

              {saved.length === 0 && <div className="status">{t("noSaved") || "No saved prompts"}</div>}
              {saved.map((s, idx) => (
                <div key={idx} className="list-item">
                  <div>
                    <div style={{ fontWeight: 700 }}>{s.name}</div>
                    <div className="status">{s.prompt.slice(0, 80)}</div>
                  </div>
                  <div className="input-row" style={{ width: 220 }}>
                    <button
                      type="button"
                      className="pick-btn"
                      onClick={() => {
                        setPrompt(s.prompt);
                      }}
                    >
                      {t("promptLabel")}
                    </button>
                    <button
                      type="button"
                      className="pick-btn"
                      onClick={() => {
                        const next = saved.filter((_, i) => i !== idx);
                        setSaved(next);
                        localStorage.setItem("aurora_saved_prompts", JSON.stringify(next));
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="panel">
              <div className="input-row">
                <button
                  type="button"
                  className="pick-btn"
                  onClick={() => {
                    if (!prompt.trim()) return;
                    setImproved(prompt + " (improved)");
                  }}
                  disabled={!prompt.trim()}
                >
                  {t("improvePrompt")}
                </button>
                {improved && <span className="status">{t("improved")}</span>}
              </div>
              {improved && <div className="message assistant">{improved}</div>}
            </div>

            <div className="panel">
              <h3>{t("completionTitle")}</h3>
              <CompletionPanel model={model || defaultModel || ""} />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function CompletionPanel({ model }: { model: string }) {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState("");
  const { t } = useI18n();
  const mutation = useMutation({
    mutationFn: generate,
    onSuccess: (data) => setResult(data.response || ""),
  });
  return (
    <div>
      <label>{t("promptLabel")}</label>
      <textarea rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      <button
        className="primary"
        onClick={() =>
          mutation.mutate({
            model,
            prompt,
            stream: false,
          })
        }
        disabled={!prompt.trim() || mutation.isPending}
      >
        {mutation.isPending ? t("generating") : t("generate")}
      </button>
      <div className="panel" style={{ marginTop: 12 }}>
        <h4>{t("output")}</h4>
        <div style={{ whiteSpace: "pre-wrap" }}>{result}</div>
      </div>
    </div>
  );
}

function ModelsPanel() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const models = useQuery({ queryKey: ["models"], queryFn: listModels });
  const [pullInput, setPullInput] = useState("");
  const [pullStatus, setPullStatus] = useState<{ type: "idle" | "detecting" | "pulling" | "success" | "error"; message: string }>({ type: "idle", message: "" });
  const [searchTerm, setSearchTerm] = useState("");
  const [lastRemoved, setLastRemoved] = useState("");

  const pull = useMutation({
    mutationFn: pullModel,
    onSuccess: (data) => {
      setPullStatus({ type: "success", message: `Pulling ${data.name}...` });
      queryClient.invalidateQueries({ queryKey: ["models"] });
    },
    onError: (err: Error) => {
      setPullStatus({ type: "error", message: err.message });
    },
  });
  const remove = useMutation({
    mutationFn: removeModel,
    onSuccess: (_, removedName) => {
      setLastRemoved(String(removedName || ""));
      queryClient.invalidateQueries({ queryKey: ["models"] });
    },
  });
  const aiWiki = useQuery({ queryKey: ["ai-wiki"], queryFn: listAiWikiModels, refetchInterval: 120000 });
  const filteredCatalog = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const list = aiWiki.data || [];
    if (!term) return list.slice(0, 30);
    return list
      .filter((m) => {
        const haystack = `${m.title || ""} ${m.id} ${m.description || ""}`.toLowerCase();
        return haystack.includes(term);
      })
      .slice(0, 30);
  }, [aiWiki.data, searchTerm]);

  // Ollama-style pull: just enter repo name, auto-detect everything
  const handlePull = async () => {
    const input = pullInput.trim();
    if (!input) return;

    setPullStatus({ type: "detecting", message: "Detecting GGUF files..." });

    try {
      const detected = await detectGgufFromRepo(input);
      setPullStatus({ type: "pulling", message: `Found ${detected.filename}, pulling...` });
      pull.mutate({
        name: detected.name,
        repo_id: detected.repo_id,
        filename: detected.filename,
        subfolder: detected.subfolder,
        direct_url: (detected as any).direct_url,
        source: (detected as any).source,
      });
    } catch (e: any) {
      setPullStatus({ type: "error", message: e.message || String(e) });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !pull.isPending && pullStatus.type !== "detecting") {
      handlePull();
    }
  };

  const quickPullFromCatalog = async (m: any) => {
    const repoId = m.id;
    setPullInput(repoId);
    setPullStatus({ type: "detecting", message: "Detecting GGUF files..." });

    try {
      // If catalog has gguf info, use it directly
      const gguf = m.gguf || m.cardData?.gguf;
      if (gguf) {
        const name = m.title || repoId.split("/").pop() || repoId;
        setPullStatus({ type: "pulling", message: `Pulling ${name}...` });
        pull.mutate({ name, repo_id: repoId, filename: gguf });
      } else {
        const detected = await detectGgufFromRepo(repoId);
        setPullStatus({ type: "pulling", message: `Found ${detected.filename}, pulling...` });
        pull.mutate({
          name: detected.name,
          repo_id: detected.repo_id,
          filename: detected.filename,
          subfolder: detected.subfolder,
          direct_url: (detected as any).direct_url,
          source: (detected as any).source,
        });
      }
    } catch (e: any) {
      setPullStatus({ type: "error", message: e.message || String(e) });
    }
  };

  const removeModelEntry = (modelName: string) => {
    if (!modelName) return;
    remove.mutate(modelName);
  };

  const isPulling = pull.isPending || pullStatus.type === "detecting" || pullStatus.type === "pulling";

  return (
    <div className="panel">
      <h2>{t("modelsHubTitle")}</h2>

      {/* Simple Ollama-style pull input */}
      <div className="pull-section">
        <label>Pull a model</label>
        <div className="pull-input-row">
          <input
            value={pullInput}
            onChange={(e) => setPullInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter HuggingFace repo (e.g., TheBloke/Llama-2-7B-GGUF)"
            disabled={isPulling}
            className="pull-input"
          />
          <button
            className="primary"
            onClick={handlePull}
            disabled={isPulling || !pullInput.trim()}
          >
            {isPulling ? "Pulling..." : "Pull"}
          </button>
        </div>
        {pullStatus.message && (
          <p className={`pull-status ${pullStatus.type}`}>
            {pullStatus.type === "detecting" && "🔍 "}
            {pullStatus.type === "pulling" && "⬇️ "}
            {pullStatus.type === "success" && "✓ "}
            {pullStatus.type === "error" && "✗ "}
            {pullStatus.message}
          </p>
        )}
        <p className="status" style={{ marginTop: 8 }}>
          Auto-detects the best GGUF file from the repository
        </p>
      </div>

      <div className="two-col" style={{ marginTop: 20 }}>
        <div>
          <h3>{t("installedModels")}</h3>
          <div className="list">
            {(models.data?.models || []).map((m) => (
              <div key={m.name} className="list-item">
                <div>
                  <div style={{ fontWeight: 700 }}>{m.name}</div>
                  <div className="status">{m.path}</div>
                </div>
                <div className="input-row" style={{ width: 180 }}>
                  <span className="badge">{m.source}</span>
                  <button
                    className="pick-btn"
                    onClick={() => removeModelEntry(m.name)}
                    disabled={remove.isPending && remove.variables === m.name}
                  >
                    {remove.isPending && remove.variables === m.name ? t("removing") : t("remove")}
                  </button>
                </div>
              </div>
            ))}
            {!models.data?.models?.length && <div className="status">{t("noModels")}</div>}
          </div>
          {remove.isSuccess && lastRemoved && (
            <p className="status">{t("removed")} {lastRemoved}</p>
          )}
          {remove.isError && <p className="status">{(remove.error as Error).message}</p>}
        </div>
        <div>
          <h3>Popular Models</h3>
          <input
            placeholder="Search models..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {aiWiki.isFetching && <p className="status">{t("searching")}</p>}
          {aiWiki.isError && <p className="status">{(aiWiki.error as Error).message}</p>}
          <div className="list">
            {filteredCatalog.map((m) => (
              <div key={m.id} className="list-item">
                <div>
                  <div style={{ fontWeight: 700 }}>{m.title || m.id}</div>
                  <div className="status">{m.description || m.id}</div>
                </div>
                <button
                  className="pick-btn"
                  onClick={() => quickPullFromCatalog(m)}
                  disabled={isPulling}
                >
                  Pull
                </button>
              </div>
            ))}
            {!filteredCatalog.length && !aiWiki.isFetching && <div className="status">{t("noResults")}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({ defaults }: { defaults: any }) {
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const mutation = useMutation({
    mutationFn: saveSettings,
    onSuccess: () => settings.refetch(),
  });
  const [form, setForm] = useState<Record<string, string | number>>({});
  const { t } = useI18n();
  const isTauri = typeof window !== "undefined" && Boolean((window as any).__TAURI_IPC__);
  useEffect(() => {
    if (settings.data) setForm(settings.data);
    else if (defaults) setForm(defaults);
  }, [settings.data, defaults]);

  const update = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const pickDir = async () => {
    if (!isTauri) {
      const val = window.prompt("Set storage directory", String(form.storage_dir || ""));
      if (val) update("storage_dir", val);
      return;
    }
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: String(form.storage_dir || "") || undefined,
      title: "Select model storage folder",
    });
    if (typeof selected === "string") {
      update("storage_dir", selected);
    }
  };

  const pickFile = async () => {
    if (!isTauri) {
      const val = window.prompt("Set llama-server path", String(form.llama_server_path || ""));
      if (val) update("llama_server_path", val);
      return;
    }
    const selected = await open({
      directory: false,
      multiple: false,
      defaultPath: String(form.llama_server_path || "") || undefined,
      filters: [{ name: "llama-server", extensions: ["exe", "bin", ""] }],
      title: "Select llama-server binary",
    });
    if (typeof selected === "string") {
      update("llama_server_path", selected);
    }
  };

  return (
    <div className="panel">
      <h2>{t("settingsTitle")}</h2>
      <div className="two-col">
        <div>
          <label>{t("storageDir")}</label>
          <div className="input-row">
            <input
              value={form.storage_dir || defaults?.storage_dir || ""}
              placeholder={String(defaults?.storage_dir || "./models")}
              onChange={(e) => update("storage_dir", e.target.value)}
            />
            <button type="button" className="pick-btn" onClick={pickDir}>
              Browse
            </button>
          </div>
          <label>{t("llamaPath")}</label>
          <div className="input-row">
            <input
              value={form.llama_server_path || defaults?.llama_server_path || ""}
              placeholder={String(defaults?.llama_server_path || "./llama-server")}
              onChange={(e) => update("llama_server_path", e.target.value)}
            />
            <button type="button" className="pick-btn" onClick={pickFile}>
              Browse
            </button>
          </div>
          <label>{t("llamaArgs")}</label>
          <input
            value={form.llama_server_args || defaults?.llama_server_args || ""}
            placeholder={String(defaults?.llama_server_args || "")}
            onChange={(e) => update("llama_server_args", e.target.value)}
          />
        </div>
        <div>
          <label>{t("llamaHost")}</label>
          <input
            value={form.llama_server_host || defaults?.llama_server_host || ""}
            placeholder={String(defaults?.llama_server_host || "127.0.0.1")}
            onChange={(e) => update("llama_server_host", e.target.value)}
          />
          <label>{t("llamaPort")}</label>
          <input
            value={form.llama_server_port || defaults?.llama_server_port || ""}
            placeholder={String(defaults?.llama_server_port || "11436")}
            onChange={(e) => update("llama_server_port", e.target.value)}
          />
          <label>{t("defaultModel")}</label>
          <input
            value={form.default_model || defaults?.default_model || ""}
            placeholder={String(defaults?.default_model || "" )}
            onChange={(e) => update("default_model", e.target.value)}
          />
        </div>
      </div>
      <button onClick={() => mutation.mutate(form)} disabled={mutation.isPending}>
        {mutation.isPending ? t("saving") : t("save")}
      </button>
      <p className="status">
        {mutation.isSuccess ? t("saved") : ""}
        {mutation.isError ? (mutation.error as Error).message : ""}
      </p>
    </div>
  );
}

function BottomLogsPanel({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [streamError, setStreamError] = useState<string>("");
  const [filter, setFilter] = useState<"all" | "request" | "response" | "error">("all");
  const { t } = useI18n();
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const stop = logsStream(
      (line) => {
        setLines((prev) => [...prev.slice(-500), line]);
        setStreamError("");
      },
      (err) => {
        setStreamError(err);
      }
    );
    return stop;
  }, []);

  useEffect(() => {
    if (logsEndRef.current && !collapsed) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines, collapsed]);

  const filteredLines = useMemo(() => {
    if (filter === "all") return lines;
    return lines.filter((line) => {
      const lower = line.toLowerCase();
      if (filter === "request") return lower.includes("request") || lower.includes("→") || lower.includes("sending");
      if (filter === "response") return lower.includes("response") || lower.includes("←") || lower.includes("received");
      if (filter === "error") return lower.includes("error") || lower.includes("failed") || lower.includes("warn");
      return true;
    });
  }, [lines, filter]);

  const clearLogs = () => setLines([]);

  return (
    <div className={`bottom-logs-panel ${collapsed ? "collapsed" : ""}`}>
      <div className="bottom-logs-header" onClick={onToggle}>
        <div className="bottom-logs-title">
          <LogsIcon className="bottom-logs-icon" />
          <span>{t("logsTitle")}</span>
          <span className="bottom-logs-count">{lines.length}</span>
        </div>
        <div className="bottom-logs-actions" onClick={(e) => e.stopPropagation()}>
          {!collapsed && (
            <>
              <select
                className="logs-filter-select"
                value={filter}
                onChange={(e) => setFilter(e.target.value as any)}
              >
                <option value="all">All</option>
                <option value="request">Requests</option>
                <option value="response">Responses</option>
                <option value="error">Errors</option>
              </select>
              <button className="logs-action-btn" onClick={clearLogs} title="Clear logs">
                Clear
              </button>
            </>
          )}
          <button className="logs-toggle-btn" onClick={onToggle}>
            {collapsed ? "▲" : "▼"}
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="bottom-logs-content">
          {streamError && <div className="logs-stream-error">{streamError}</div>}
          <div className="bottom-logs-output">
            {filteredLines.map((line, idx) => {
              const isError = line.toLowerCase().includes("error") || line.toLowerCase().includes("failed");
              const isRequest = line.includes("→") || line.toLowerCase().includes("request");
              const isResponse = line.includes("←") || line.toLowerCase().includes("response");
              return (
                <div
                  key={idx}
                  className={`log-line ${isError ? "log-error" : ""} ${isRequest ? "log-request" : ""} ${isResponse ? "log-response" : ""}`}
                >
                  {line}
                </div>
              );
            })}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}

function TerminalPanel() {
  const { t } = useI18n();
  const [output, setOutput] = useState<Array<{ prompt: string; result: string }>>([]);
  const [cmd, setCmd] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  const runCmd = async () => {
    const val = cmd.trim();
    if (!val) return;
    let parts = val.split(/\s+/);
    if (parts[0] === "aurora") {
      parts = parts.slice(1);
    }
    if (!parts.length || !parts[0]) {
      setOutput((prev) => [...prev.slice(-200), { prompt: `$ ${val}`, result: t("terminalHelp") }]);
      setCmd("");
      return;
    }
    const [verb, ...rest] = parts;
    let line = "";
    try {
      if (verb === "help" || verb === "-h" || verb === "--help") {
        line = `Commands:
  list              - List available models
  pull <name> <repo> <filename> [subfolder]
                    - Pull model from HuggingFace
  pull:tiny         - Pull TinyLlama-1.1B (quick test model)
  run <name>        - Load and run a model
  help              - Show this help`;
      } else if (verb === "list") {
        const data = await listModels();
        line = JSON.stringify(data.models || [], null, 2);
      } else if (verb === "pull:tiny" || (verb === "pull" && rest[0] === "tiny")) {
        // Quick pull for TinyLlama (great for testing)
        const res = await pullModel({
          name: "tinyllama",
          repo_id: "TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF",
          filename: "tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf",
        });
        line = JSON.stringify(res);
      } else if (verb === "pull") {
        if (rest.length === 1) {
          const repo = rest[0];
          const detected = await detectGgufFromRepo(repo);
          const res = await pullModel({
            name: detected.name,
            repo_id: detected.repo_id,
            filename: detected.filename,
            subfolder: detected.subfolder,
          });
          line = JSON.stringify({ ...res, selected: detected.filename, note: "auto-picked smallest GGUF" }, null, 2);
        } else {
          const [name, repo, filename, subfolder] = rest;
          if (!name || !repo || !filename) {
            throw new Error("Usage: pull <repo>  OR pull <name> <repo> <filename> [subfolder]\n  or: pull:tiny (for quick test)");
          }
          const res = await pullModel({ name, repo_id: repo, filename, subfolder });
          line = JSON.stringify(res);
        }
      } else if (verb === "run") {
        const [name] = rest;
        if (!name) throw new Error("Usage: run <name>");
        // Trigger a lightweight chat to ensure load
        await chatOnce({ model: name, messages: [{ role: "user", content: "" }], stream: false });
        line = JSON.stringify({ status: "ok", model: name });
      } else {
        throw new Error(`Unknown command: ${verb}\nType 'help' for available commands`);
      }
    } catch (e: any) {
      line = e.message || String(e);
    }
    setOutput((prev) => [...prev.slice(-200), { prompt: `$ ${val}`, result: line }]);
    setCmd("");
  };

  useEffect(() => {
    if (endRef.current) {
      endRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [output]);

  return (
    <div className="panel">
      <h2>{t("terminalTitle")}</h2>
      <p className="status">{t("terminalHelp")}</p>
      <div className="terminal-shell">
        <div className="terminal-output">
          {output.map((entry, idx) => (
            <div key={idx} className="terminal-block">
              <pre className="terminal-prompt">{entry.prompt}</pre>
              <pre className="terminal-result">{entry.result}</pre>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <div className="terminal-divider" />
        <div className="terminal-input-row">
          <input
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            placeholder={t("terminalPlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter") runCmd();
            }}
          />
          <button className="pick-btn" onClick={runCmd}>
            Run
          </button>
        </div>
      </div>
    </div>
  );
}

function HelpPanel() {
  const { t } = useI18n();
  const plansUrl = "https://subscription-portal.finailabz.com";
  return ( 
    <div className="panel">
      <h2>{t("helpTitle")}</h2>
      <div className="list">
        <div className="list-item">
          <div>
            <div style={{ fontWeight: 700 }}>{t("helpShortcuts")}</div>
            <div className="status">{t("helpSend")}</div>
            <div className="status">{t("helpPull")}</div>
            <div className="status">{t("helpSettings")}</div>
            <div className="status">{t("helpLogs")}</div>
            <div className="status">{t("helpCli")}</div>
          </div>
        </div>
        <div className="list-item">
          <div>
            <div style={{ fontWeight: 700 }}>{t("plansTitle")}</div>
            <div className="status">{t("planBasic")}</div>
            <div className="status">{t("planPro")}</div>
            <div className="status">{t("planEnterprise")}</div>
          </div>
          <a className="pick-btn" href={plansUrl} target="_blank" rel="noreferrer">
            {t("planCta")}
          </a>
        </div>
      </div>
    </div>
  );
}

function Layout() {
  const [tab, setTab] = useState<"home" | "models" | "settings" | "help" | "terminal">("home");
  const [collapsed, setCollapsed] = useState(false);
  const [logsCollapsed, setLogsCollapsed] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const fromStorage = localStorage.getItem("aurora_sidebar_width");
    const n = parseInt(String(fromStorage || "240"), 10);
    return isNaN(n) ? 240 : n;
  });
  const [dragging, setDragging] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const { t, locale, setLocale } = useI18n();
  const queryClient = useQueryClient();
  const defaultModel = useMemo(() => (settings.data as any)?.default_model as string | undefined, [settings.data]);
  const healthQuery = useQuery({ queryKey: ["health"], queryFn: health, refetchInterval: 3000, retry: false });
  const isOnline = healthQuery.status === "pending" ? null : Boolean(healthQuery.data?.status === "ok");
  const offlineMessage = healthQuery.isError ? (healthQuery.error as any)?.message || "Backend unreachable" : "";
  const modelName = (healthQuery.data as any)?.default_model || defaultModel || "";

  // Auto-start backend on app launch
  useEffect(() => {
    invoke("start_sidecar").catch((err) => {
      console.warn("Failed to start backend:", err);
    });
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const next = Math.min(360, Math.max(180, e.clientX));
      setSidebarWidth(next);
    };
    const onUp = () => {
      setDragging(false);
      localStorage.setItem("aurora_sidebar_width", String(sidebarWidth));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  return (
    <div className="shell">
      <aside
        className={`sidebar ${collapsed ? "collapsed" : ""}`}
        style={{ width: collapsed ? 72 : sidebarWidth }}
      >
        <button
          className={`collapse-btn icon-btn ${collapsed ? 'collapsed-btn' : ''}`}
          onClick={() => {
            setCollapsed((v) => {
              const next = !v;
              if (!next) {
                // expanded now — ensure minimum width so flags are visible
                setSidebarWidth((cur) => Math.max(cur, 320));
              }
              return next;
            });
          }}
          onDoubleClick={() => setDragging(true)}
          aria-label="Toggle sidebar (double-click to resize)"
          title="Toggle sidebar (double-click to start resizing)"
        >
          ≡
        </button>
        <div className="brand">
          <div className="brand-logo-badge">A</div>
          {!collapsed && <div className="brand-text">{t("brand")}</div>}
        </div>
        {[
          ["home", t("navChat")],
          ["models", t("navModels")],
          ["settings", t("navSettings")],
          ["terminal", t("navTerminal")],
          ["help", t("navHelp")],
        ].map(([id, label]) => {
          const Icon = navIcons[id];
          return (
            <div
              key={id}
              className={`nav-item ${tab === id ? "active" : ""}`}
              onClick={() => setTab(id as any)}
              title={label}
              data-label={label}
              role="button"
              aria-label={String(label)}
            >
              {collapsed ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {Icon ? <Icon className="nav-icon" /> : <AuroraIcon className="nav-icon" />}
                </div>
              ) : (
                label
              )}
            </div>
          );
        })}
        <div>
          {!collapsed ? (
            <>
              <label style={{ color: "#e2e8f0", fontSize: 12 }}>{t("language")}</label>
              <select value={locale} onChange={(e) => setLocale(e.target.value as any)} style={{ width: "100%" }}>
                <option value="en">🇺🇸 English</option>
                <option value="es">🇪🇸 Español</option>
                <option value="fr">🇫🇷 Français</option>
                <option value="de">🇩🇪 Deutsch</option>
                <option value="ar">🇸🇦 العربية</option>
                <option value="tr">🇹🇷 Türkçe</option>
                <option value="fa">🇮🇷 فارسی</option>
                <option value="zh">🇨🇳 中文</option>
              </select>
            </>
          ) : (
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as any)}
              className="flag-select"
              aria-label={t("language")}
            >
              <option value="en">🇺🇸</option>
              <option value="es">🇪🇸</option>
              <option value="fr">🇫🇷</option>
              <option value="de">🇩🇪</option>
              <option value="ar">🇸🇦</option>
              <option value="tr">🇹🇷</option>
              <option value="fa">🇮🇷</option>
              <option value="zh">🇨🇳</option>
            </select>
          )}
        </div>

        <div className="sidebar-footer">
          {collapsed ? null : (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>© 2026 FinAI Labz</div>
              <button className="pick-btn" onClick={() => setShowAbout(true)}>
                About
              </button>
            </div>
          )}
        </div>

        <div
          className="resize-handle"
          onMouseDown={() => setDragging(true)}
          role="separator"
          title="Drag to resize sidebar"
          aria-label="Resize sidebar"
        />
      </aside>
      <main className={`content ${logsCollapsed ? "logs-collapsed" : "logs-expanded"}`}>
        <button
          className="hamburger-btn"
          aria-label="Toggle navigation"
          onClick={() => setCollapsed((v) => !v)}
        >
          ☰
        </button>
        {healthQuery.isError && (
          <div className="offline-banner">
            <strong>Backend not reachable.</strong> {offlineMessage || "Cannot reach API"} at {API_BASE}. Ensure it is running, or pick a free port.
            <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
              <button className="pick-btn" onClick={() => queryClient.invalidateQueries({ queryKey: ["health"] })}>
                Retry health
              </button>
              <button className="pick-btn" onClick={() => invoke("start_sidecar").catch(() => {})}>
                Start built-in backend
              </button>
              <a className="pick-btn" href="" onClick={(e) => { e.preventDefault(); window.location.reload(); }}>
                Reload UI
              </a>
            </div>
          </div>
        )}
        {tab === "home" && <ChatPanel defaultModel={defaultModel} />}
        {tab === "models" && <ModelsPanel />}
        {tab === "settings" && <SettingsPanel defaults={settings.data} />}
        {tab === "help" && <HelpPanel />}
        {tab === "terminal" && <TerminalPanel />}
        <BottomLogsPanel collapsed={logsCollapsed} onToggle={() => setLogsCollapsed((v) => !v)} />
      </main>
      <div className="status-bar-fixed">
        <div className="status-brand">
          <img src={logo} alt="Aurora" className="status-logo" />
          <span className="status-app-name">Aurora</span>
        </div>
        <div className={`status-dot ${isOnline === null ? "amber" : isOnline ? "green" : "red"}`} />
        <span className="status-text">
          {isOnline === null ? t("connecting") : isOnline ? t("online") : t("offline")}
        </span>
        <span className="status-sep">·</span>
        <span className="status-text">{t("modelLabel")}: {modelName || t("none")}</span>
        <span className="status-sep">·</span>
        <span className="status-text">{t("tokens") || "Tokens"}: {(healthQuery.data as any)?.tokens ?? "--"}</span>
        {(healthQuery.data as any)?.llama === false && <span className="status-info">No model loaded</span>}
        <span className="status-sep">·</span>
        <span className="status-text">© 2026 FinAI Labz</span>
      </div>
      <AboutModal open={showAbout} onClose={() => setShowAbout(false)} />
    </div>
  );
}

export default function App() {
  useEffect(() => {
    // set default theme to light on first run
    const stored = localStorage.getItem("aurora_theme");
    if (!stored) {
      document.documentElement.classList.add("theme-light");
      localStorage.setItem("aurora_theme", "light");
    }
  }, []);

  return (
    <QueryClientProvider client={client}>
      <Layout />
    </QueryClientProvider>
  );
}
