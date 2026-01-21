import { useRef, useState, useCallback } from "react";

export interface Attachment {
  type: "image" | "file";
  name: string;
  data_url: string;
  size: number;
  mime_type: string;
  text?: string;
}

export interface AttachmentCapabilities {
  text: boolean;
  images: boolean;
  audio: boolean;
  documents: boolean;
}

interface FileUploadProps {
  onFilesSelected: (files: Attachment[]) => void;
  attachments: Attachment[];
  onRemoveAttachment: (index: number) => void;
  accept?: string;
  maxSizeMB?: number;
  capabilities?: AttachmentCapabilities;
  showAttachmentsInline?: boolean;
}

export default function FileUpload({
  onFilesSelected,
  attachments,
  onRemoveAttachment,
  accept = "image/*,.txt,.md,.json,.csv",
  maxSizeMB = 10,
  capabilities = { text: true, images: true, audio: false, documents: false },
  showAttachmentsInline = true,
}: FileUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string>("");

  const classifyFile = (file: File) => {
    const name = file.name.toLowerCase();
    const type = file.type.toLowerCase();
    if (type.startsWith("image/")) return "image";
    if (type.startsWith("audio/") || name.match(/\.(mp3|wav|m4a|aac|flac|ogg)$/)) return "audio";
    if (
      type.startsWith("text/") ||
      ["application/json", "text/csv", "application/csv", "application/xml"].includes(type) ||
      name.match(/\.(txt|md|markdown|json|csv|log|yaml|yml)$/)
    )
      return "text";
    if (
      type === "application/pdf" ||
      type === "application/msword" ||
      type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      name.match(/\.(pdf|doc|docx)$/)
    )
      return "document";
    return "other";
  };

  const isAllowed = (kind: string) => {
    if (kind === "image") return capabilities.images;
    if (kind === "audio") return capabilities.audio;
    if (kind === "document") return capabilities.documents;
    if (kind === "text") return capabilities.text;
    return false;
  };

  const processFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      setError("");

      const newAttachments: Attachment[] = [];
      const maxSize = maxSizeMB * 1024 * 1024;

      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];

        if (file.size > maxSize) {
          setError(`File "${file.name}" exceeds ${maxSizeMB}MB limit`);
          continue;
        }

        const kind = classifyFile(file);
        if (!isAllowed(kind)) {
          setError(`"${file.name}" isn't supported by the current model.`);
          continue;
        }

        try {
          if (kind === "text") {
            const text = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result || ""));
              reader.onerror = reject;
              reader.readAsText(file);
            });
            newAttachments.push({
              type: "file",
              name: file.name,
              data_url: "",
              size: file.size,
              mime_type: file.type,
              text,
            });
            continue;
          }

          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          const isImage = kind === "image";
          newAttachments.push({
            type: isImage ? "image" : "file",
            name: file.name,
            data_url: dataUrl,
            size: file.size,
            mime_type: file.type,
          });
        } catch (e) {
          setError(`Failed to read file "${file.name}"`);
        }
      }

      if (newAttachments.length > 0) {
        onFilesSelected(newAttachments);
      }
    },
    [maxSizeMB, onFilesSelected]
  );

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(e.target.files);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    processFiles(e.dataTransfer.files);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div
      className={`file-upload-inline ${dragOver ? "drag-over" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleChange}
        accept={accept}
        multiple
        style={{ display: "none" }}
      />

      <button
        type="button"
        className="file-upload-btn"
        onClick={handleClick}
        title="Attach files"
        aria-label="Attach files"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
        <span className="file-upload-label">Attach</span>
      </button>

      {showAttachmentsInline && (
        <AttachmentChips attachments={attachments} onRemoveAttachment={onRemoveAttachment} />
      )}

      {error && <div className="file-upload-error-inline">{error}</div>}
    </div>
  );
}

export function AttachmentChips({
  attachments,
  onRemoveAttachment,
}: {
  attachments: Attachment[];
  onRemoveAttachment: (index: number) => void;
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="file-upload-attachments-inline">
      {attachments.map((att, idx) => (
        <div key={idx} className="attachment-chip">
          {att.type === "image" && att.data_url ? (
            <img src={att.data_url} alt={att.name} className="attachment-chip-preview" />
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14,2 14,8 20,8" />
            </svg>
          )}
          <span className="attachment-chip-name">{att.name}</span>
          <button
            type="button"
            className="attachment-chip-remove"
            onClick={(e) => {
              e.stopPropagation();
              onRemoveAttachment(idx);
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
