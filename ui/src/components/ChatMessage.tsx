import { useMemo, useState } from "react";
import CopyIcon from "./icons/CopyIcon";
import CheckIcon from "./icons/CheckIcon";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
}

// Simple markdown-like formatter for chat responses
function formatContent(content: string): JSX.Element[] {
  const elements: JSX.Element[] = [];
  const lines = content.split("\n");
  let inCodeBlock = false;
  let codeContent = "";
  let codeLanguage = "";
  let listItems: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const flushList = () => {
    if (listItems.length > 0) {
      const key = `list-${elements.length}`;
      if (listType === "ol") {
        elements.push(
          <ol key={key} className="chat-list chat-ol">
            {listItems.map((item, i) => (
              <li key={i}>{formatInline(item)}</li>
            ))}
          </ol>
        );
      } else {
        elements.push(
          <ul key={key} className="chat-list chat-ul">
            {listItems.map((item, i) => (
              <li key={i}>{formatInline(item)}</li>
            ))}
          </ul>
        );
      }
      listItems = [];
      listType = null;
    }
  };

  const formatInline = (text: string): JSX.Element => {
    // Bold: **text** or __text__
    // Italic: *text* or _text_
    // Code: `text`
    // Links: [text](url)
    const parts: (string | JSX.Element)[] = [];
    let remaining = text;
    let keyIdx = 0;

    const patterns = [
      { regex: /\*\*(.+?)\*\*/g, render: (match: string, p1: string) => <strong key={keyIdx++}>{p1}</strong> },
      { regex: /__(.+?)__/g, render: (match: string, p1: string) => <strong key={keyIdx++}>{p1}</strong> },
      { regex: /\*(.+?)\*/g, render: (match: string, p1: string) => <em key={keyIdx++}>{p1}</em> },
      { regex: /_(.+?)_/g, render: (match: string, p1: string) => <em key={keyIdx++}>{p1}</em> },
      { regex: /`([^`]+)`/g, render: (match: string, p1: string) => <code key={keyIdx++} className="chat-inline-code">{p1}</code> },
      { regex: /\[([^\]]+)\]\(([^)]+)\)/g, render: (match: string, text: string, url: string) => <a key={keyIdx++} href={url} target="_blank" rel="noopener noreferrer" className="chat-link">{text}</a> },
    ];

    // Apply patterns in order
    let processedText = remaining;
    patterns.forEach(({ regex, render }) => {
      processedText = processedText.replace(regex, (match, ...args) => {
        const element = render(match, ...args);
        const placeholder = `\x00${parts.length}\x00`;
        parts.push(element);
        return placeholder;
      });
    });

    // Split by placeholders and reconstruct
    const finalParts: (string | JSX.Element)[] = [];
    const segments = processedText.split(/\x00(\d+)\x00/);
    segments.forEach((segment, i) => {
      if (i % 2 === 0) {
        if (segment) finalParts.push(segment);
      } else {
        const idx = parseInt(segment, 10);
        if (parts[idx]) finalParts.push(parts[idx]);
      }
    });

    return <>{finalParts}</>;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Code block start/end
    if (trimmedLine.startsWith("```")) {
      if (!inCodeBlock) {
        flushList();
        inCodeBlock = true;
        codeLanguage = trimmedLine.slice(3).trim();
        codeContent = "";
      } else {
        elements.push(
          <div key={`code-${elements.length}`} className="chat-code-block">
            {codeLanguage && <div className="chat-code-lang">{codeLanguage}</div>}
            <pre><code>{codeContent.trim()}</code></pre>
          </div>
        );
        inCodeBlock = false;
        codeContent = "";
        codeLanguage = "";
      }
      continue;
    }

    if (inCodeBlock) {
      codeContent += line + "\n";
      continue;
    }

    // Headers
    if (trimmedLine.startsWith("### ")) {
      flushList();
      elements.push(
        <h4 key={`h4-${elements.length}`} className="chat-heading chat-h4">
          {formatInline(trimmedLine.slice(4))}
        </h4>
      );
      continue;
    }
    if (trimmedLine.startsWith("## ")) {
      flushList();
      elements.push(
        <h3 key={`h3-${elements.length}`} className="chat-heading chat-h3">
          {formatInline(trimmedLine.slice(3))}
        </h3>
      );
      continue;
    }
    if (trimmedLine.startsWith("# ")) {
      flushList();
      elements.push(
        <h2 key={`h2-${elements.length}`} className="chat-heading chat-h2">
          {formatInline(trimmedLine.slice(2))}
        </h2>
      );
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(trimmedLine)) {
      flushList();
      elements.push(<hr key={`hr-${elements.length}`} className="chat-hr" />);
      continue;
    }

    // Blockquote
    if (trimmedLine.startsWith("> ")) {
      flushList();
      elements.push(
        <blockquote key={`bq-${elements.length}`} className="chat-blockquote">
          {formatInline(trimmedLine.slice(2))}
        </blockquote>
      );
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(trimmedLine)) {
      if (listType !== "ul") {
        flushList();
        listType = "ul";
      }
      listItems.push(trimmedLine.slice(2));
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(trimmedLine)) {
      if (listType !== "ol") {
        flushList();
        listType = "ol";
      }
      listItems.push(trimmedLine.replace(/^\d+\.\s/, ""));
      continue;
    }

    // Empty line
    if (!trimmedLine) {
      flushList();
      continue;
    }

    // Regular paragraph
    flushList();
    elements.push(
      <p key={`p-${elements.length}`} className="chat-paragraph">
        {formatInline(line)}
      </p>
    );
  }

  // Flush any remaining code block
  if (inCodeBlock && codeContent) {
    elements.push(
      <div key={`code-${elements.length}`} className="chat-code-block">
        {codeLanguage && <div className="chat-code-lang">{codeLanguage}</div>}
        <pre><code>{codeContent.trim()}</code></pre>
      </div>
    );
  }

  // Flush any remaining list
  flushList();

  return elements;
}

export default function ChatMessage({ role, content }: ChatMessageProps) {
  const formatted = useMemo(() => formatContent(content), [content]);
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState<"up" | "down" | null>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className={`message ${role}`}>
      <div className="message-header">
        <strong className="message-role">{role === "user" ? "You" : "Assistant"}</strong>
        {role === "assistant" && (
          <div className="message-actions">
            <button
              className={`message-copy-btn ${copied ? "copied" : ""}`}
              onClick={handleCopy}
              title={copied ? "Copied!" : "Copy message"}
              aria-label={copied ? "Copied!" : "Copy message"}
            >
              {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
              <span className="copy-label">{copied ? "Copied" : "Copy"}</span>
            </button>
            <button
              className={`message-action-btn ${rating === "up" ? "active" : ""}`}
              onClick={() => setRating((current) => (current === "up" ? null : "up"))}
              title="Thumbs up"
              aria-label="Thumbs up"
              aria-pressed={rating === "up"}
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 9V5a3 3 0 0 0-6 0v4" />
                <path d="M7 9h11a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2H9l1 7H7l-2-9" />
              </svg>
            </button>
            <button
              className={`message-action-btn ${rating === "down" ? "active" : ""}`}
              onClick={() => setRating((current) => (current === "down" ? null : "down"))}
              title="Thumbs down"
              aria-label="Thumbs down"
              aria-pressed={rating === "down"}
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 15v4a3 3 0 0 0 6 0v-4" />
                <path d="M17 15H6a2 2 0 0 1-2-2v-1a2 2 0 0 1 2-2h9l-1-7h3l2 9" />
              </svg>
            </button>
          </div>
        )}
      </div>
      <div className="message-content">{formatted}</div>
    </div>
  );
}
