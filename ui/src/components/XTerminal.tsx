import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import {
  listModels,
  pullModel,
  chatOnce,
  detectGgufFromRepo,
  logToBackend,
} from "../api";

interface XTerminalProps {
  onLog?: (msg: string) => void;
}

const HELP_TEXT = `
Aurora CLI - Local LLM Interface

Commands:
  help                    Show this help message
  clear                   Clear the terminal
  list                    List installed models
  pull <repo>             Pull model from HuggingFace (auto-detects GGUF)
  pull <repo>:<tag>       Pull with specific tag (e.g., :Q4_K_M, :7b)
  pull:tiny               Quick pull TinyLlama-1.1B for testing
  run <model>             Load a model
  chat <message>          Send a chat message to loaded model
  info                    Show system information

Examples:
  pull TheBloke/Llama-2-7B-GGUF
  pull TheBloke/Mistral-7B-Instruct-v0.2-GGUF:Q4_K_M
  chat Hello, how are you?
`;

export default function XTerminal({ onLog }: XTerminalProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [currentModel, setCurrentModel] = useState<string>("");
  const commandBuffer = useRef<string>("");
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);

  const log = useCallback(
    (msg: string) => {
      onLog?.(msg);
      logToBackend(msg).catch(() => {});
    },
    [onLog]
  );

  const writeOutput = useCallback((term: Terminal, text: string, color?: string) => {
    const lines = text.split("\n");
    lines.forEach((line, idx) => {
      if (color) {
        term.write(`\x1b[${color}m${line}\x1b[0m`);
      } else {
        term.write(line);
      }
      if (idx < lines.length - 1) {
        term.write("\r\n");
      }
    });
  }, []);

  const writePrompt = useCallback((term: Terminal) => {
    term.write("\r\n\x1b[36maurora\x1b[0m \x1b[33m>\x1b[0m ");
  }, []);

  const executeCommand = useCallback(
    async (term: Terminal, input: string) => {
      const trimmed = input.trim();
      if (!trimmed) {
        writePrompt(term);
        return;
      }

      // Add to history
      historyRef.current.push(trimmed);
      if (historyRef.current.length > 100) {
        historyRef.current.shift();
      }
      historyIndexRef.current = historyRef.current.length;

      const parts = trimmed.split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1);

      log(`→ [CLI] Executing: ${trimmed}`);

      try {
        if (cmd === "help" || cmd === "-h" || cmd === "--help") {
          writeOutput(term, HELP_TEXT, "37");
        } else if (cmd === "clear" || cmd === "cls") {
          term.clear();
          term.write("\x1b[2J\x1b[H"); // Clear and move cursor to top
          writeOutput(term, "\x1b[36mAurora CLI\x1b[0m - Type 'help' for commands\r\n");
        } else if (cmd === "list" || cmd === "models") {
          writeOutput(term, "\n\x1b[90mFetching models...\x1b[0m", "90");
          const data = await listModels();
          const models = data.models || [];
          term.write("\r\n");
          if (models.length === 0) {
            writeOutput(term, "No models installed. Use 'pull <repo>' to download one.", "33");
          } else {
            writeOutput(term, `\x1b[32m${models.length} model(s) installed:\x1b[0m\r\n`);
            models.forEach((m: any) => {
              const name = m.name || "unknown";
              const source = m.source || "config";
              term.write(`  \x1b[97m${name}\x1b[0m \x1b[90m(${source})\x1b[0m\r\n`);
            });
          }
          log(`← [CLI] Listed ${models.length} models`);
        } else if (cmd === "pull:tiny" || (cmd === "pull" && args[0] === "tiny")) {
          writeOutput(term, "\n\x1b[36mPulling TinyLlama-1.1B (test model)...\x1b[0m");
          log("→ [CLI] Pulling TinyLlama-1.1B");
          const res = await pullModel({
            name: "tinyllama",
            repo_id: "TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF",
            filename: "tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf",
          });
          term.write("\r\n");
          writeOutput(term, `\x1b[32m✓ Pulled: ${res.name}\x1b[0m`);
          log(`← [CLI] Pull complete: ${res.name}`);
        } else if (cmd === "pull") {
          if (!args[0]) {
            writeOutput(term, "\x1b[31mUsage: pull <repo> or pull <repo>:<tag>\x1b[0m", "31");
          } else {
            const repo = args.join(" ");
            writeOutput(term, `\n\x1b[36mDetecting GGUF files from ${repo}...\x1b[0m`);
            log(`→ [CLI] Detecting GGUF from: ${repo}`);

            try {
              const detected = await detectGgufFromRepo(repo);
              term.write("\r\n");
              writeOutput(term, `\x1b[90mFound: ${detected.filename}\x1b[0m`);
              term.write("\r\n");
              writeOutput(term, `\x1b[36mPulling ${detected.name}...\x1b[0m`);
              log(`→ [CLI] Pulling: ${detected.filename}`);

              const res = await pullModel({
                name: detected.name,
                repo_id: detected.repo_id,
                filename: detected.filename,
                subfolder: detected.subfolder,
                direct_url: (detected as any).direct_url,
                source: (detected as any).source,
              });
              term.write("\r\n");
              writeOutput(term, `\x1b[32m✓ Pull started: ${res.name}\x1b[0m`);
              writeOutput(term, `\n\x1b[90mCheck logs panel for download progress\x1b[0m`);
              log(`← [CLI] Pull initiated: ${res.name}`);
            } catch (e: any) {
              term.write("\r\n");
              writeOutput(term, `\x1b[31m✗ ${e.message || String(e)}\x1b[0m`);
              log(`✗ [CLI] Pull failed: ${e.message}`);
            }
          }
        } else if (cmd === "run" || cmd === "load") {
          if (!args[0]) {
            writeOutput(term, "\x1b[31mUsage: run <model-name>\x1b[0m");
          } else {
            const modelName = args.join(" ");
            writeOutput(term, `\n\x1b[36mLoading model: ${modelName}...\x1b[0m`);
            log(`→ [CLI] Loading model: ${modelName}`);

            try {
              await chatOnce({ model: modelName, messages: [{ role: "user", content: "" }], stream: false });
              setCurrentModel(modelName);
              term.write("\r\n");
              writeOutput(term, `\x1b[32m✓ Model loaded: ${modelName}\x1b[0m`);
              log(`← [CLI] Model loaded: ${modelName}`);
            } catch (e: any) {
              term.write("\r\n");
              writeOutput(term, `\x1b[31m✗ ${e.message || String(e)}\x1b[0m`);
              log(`✗ [CLI] Load failed: ${e.message}`);
            }
          }
        } else if (cmd === "chat") {
          if (!args.length) {
            writeOutput(term, "\x1b[31mUsage: chat <message>\x1b[0m");
          } else if (!currentModel) {
            writeOutput(term, "\x1b[33mNo model loaded. Use 'run <model>' first or specify model.\x1b[0m");
          } else {
            const message = args.join(" ");
            writeOutput(term, `\n\x1b[90mSending to ${currentModel}...\x1b[0m`);
            log(`→ [CLI] Chat: "${message.slice(0, 50)}${message.length > 50 ? "..." : ""}"`);

            try {
              const res = await chatOnce({
                model: currentModel,
                messages: [{ role: "user", content: message }],
                stream: false,
              });
              const content = res.message?.content || "(no response)";
              term.write("\r\n\r\n");
              writeOutput(term, `\x1b[97m${content}\x1b[0m`);
              log(`← [CLI] Response received (${content.length} chars)`);
            } catch (e: any) {
              term.write("\r\n");
              writeOutput(term, `\x1b[31m✗ ${e.message || String(e)}\x1b[0m`);
              log(`✗ [CLI] Chat failed: ${e.message}`);
            }
          }
        } else if (cmd === "info") {
          writeOutput(term, "\n\x1b[36mAurora System Info\x1b[0m\r\n");
          writeOutput(term, `  Version: 0.1.0\r\n`);
          writeOutput(term, `  Current model: ${currentModel || "(none loaded)"}\r\n`);
          writeOutput(term, `  Platform: ${navigator.platform}\r\n`);
          writeOutput(term, `  User Agent: ${navigator.userAgent.slice(0, 60)}...\r\n`);
        } else {
          writeOutput(term, `\x1b[31mUnknown command: ${cmd}\x1b[0m\r\n`);
          writeOutput(term, `Type 'help' for available commands.`);
        }
      } catch (e: any) {
        term.write("\r\n");
        writeOutput(term, `\x1b[31mError: ${e.message || String(e)}\x1b[0m`);
        log(`✗ [CLI] Error: ${e.message}`);
      }

      writePrompt(term);
    },
    [writeOutput, writePrompt, log, currentModel]
  );

  useEffect(() => {
    if (!termRef.current || xtermRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: 14,
      fontFamily: '"SFMono-Regular", "Menlo", "Monaco", "Consolas", monospace',
      theme: {
        background: "#0b1220",
        foreground: "#e5e7eb",
        cursor: "#60a5fa",
        cursorAccent: "#0b1220",
        selectionBackground: "rgba(96, 165, 250, 0.3)",
        black: "#1e293b",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e5e7eb",
        brightBlack: "#475569",
        brightRed: "#fca5a5",
        brightGreen: "#86efac",
        brightYellow: "#fde047",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#f8fafc",
      },
      scrollback: 1000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(termRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Welcome message
    term.writeln("\x1b[36m╔══════════════════════════════════════════╗\x1b[0m");
    term.writeln("\x1b[36m║\x1b[0m   \x1b[97mAurora CLI\x1b[0m - Local LLM Interface       \x1b[36m║\x1b[0m");
    term.writeln("\x1b[36m╚══════════════════════════════════════════╝\x1b[0m");
    term.writeln("");
    term.writeln("\x1b[90mType 'help' for available commands\x1b[0m");
    term.write("\r\n\x1b[36maurora\x1b[0m \x1b[33m>\x1b[0m ");

    // Handle input
    term.onData((data) => {
      const code = data.charCodeAt(0);

      if (code === 13) {
        // Enter
        term.write("\r\n");
        executeCommand(term, commandBuffer.current);
        commandBuffer.current = "";
      } else if (code === 127 || code === 8) {
        // Backspace
        if (commandBuffer.current.length > 0) {
          commandBuffer.current = commandBuffer.current.slice(0, -1);
          term.write("\b \b");
        }
      } else if (code === 27) {
        // Escape sequences (arrows, etc.)
        if (data === "\x1b[A") {
          // Up arrow - history
          if (historyIndexRef.current > 0) {
            historyIndexRef.current--;
            const historyCmd = historyRef.current[historyIndexRef.current] || "";
            // Clear current line
            term.write("\r\x1b[K\x1b[36maurora\x1b[0m \x1b[33m>\x1b[0m " + historyCmd);
            commandBuffer.current = historyCmd;
          }
        } else if (data === "\x1b[B") {
          // Down arrow - history
          if (historyIndexRef.current < historyRef.current.length - 1) {
            historyIndexRef.current++;
            const historyCmd = historyRef.current[historyIndexRef.current] || "";
            term.write("\r\x1b[K\x1b[36maurora\x1b[0m \x1b[33m>\x1b[0m " + historyCmd);
            commandBuffer.current = historyCmd;
          } else {
            historyIndexRef.current = historyRef.current.length;
            term.write("\r\x1b[K\x1b[36maurora\x1b[0m \x1b[33m>\x1b[0m ");
            commandBuffer.current = "";
          }
        }
      } else if (code === 3) {
        // Ctrl+C
        term.write("^C");
        commandBuffer.current = "";
        writePrompt(term);
      } else if (code === 12) {
        // Ctrl+L (clear)
        term.clear();
        term.write("\x1b[2J\x1b[H");
        writeOutput(term, "\x1b[36mAurora CLI\x1b[0m - Type 'help' for commands\r\n");
        writePrompt(term);
      } else if (code >= 32) {
        // Printable characters
        commandBuffer.current += data;
        term.write(data);
      }
    });

    // Handle resize
    const handleResize = () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [executeCommand, writeOutput, writePrompt]);

  return (
    <div
      ref={termRef}
      className="xterm-container"
      style={{
        width: "100%",
        height: "100%",
        minHeight: "400px",
        borderRadius: "12px",
        overflow: "hidden",
      }}
    />
  );
}
