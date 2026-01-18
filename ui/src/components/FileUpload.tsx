import { useRef, useState, useCallback } from "react";

export interface Attachment {
  type: "image" | "file";
  name: string;
  data_url: string;
  size: number;
  mime_type: string;
}

interface FileUploadProps {
  onFilesSelected: (files: Attachment[]) => void;
  attachments: Attachment[];
  onRemoveAttachment: (index: number) => void;
  accept?: string;
  maxSizeMB?: number;
}

export default function FileUpload({
  onFilesSelected,
  attachments,
  onRemoveAttachment,
  accept = "image/*,.pdf,.txt,.md,.json,.csv",
  maxSizeMB = 10,
}: FileUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string>("");

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

        try {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          const isImage = file.type.startsWith("image/");
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
    <div className="file-upload-container">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleChange}
        accept={accept}
        multiple
        style={{ display: "none" }}
      />

      <div
        className={`file-upload-dropzone ${dragOver ? "drag-over" : ""}`}
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="file-upload-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17,8 12,3 7,8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <div className="file-upload-text">
          <span className="file-upload-primary">Click to upload</span>
          <span className="file-upload-secondary"> or drag and drop</span>
        </div>
        <div className="file-upload-hint">
          Images, PDFs, text files (max {maxSizeMB}MB)
        </div>
      </div>

      {error && <div className="file-upload-error">{error}</div>}

      {attachments.length > 0 && (
        <div className="file-upload-attachments">
          {attachments.map((att, idx) => (
            <div key={idx} className="attachment-item">
              {att.type === "image" ? (
                <img src={att.data_url} alt={att.name} className="attachment-preview" />
              ) : (
                <div className="attachment-file-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14,2 14,8 20,8" />
                  </svg>
                </div>
              )}
              <div className="attachment-info">
                <div className="attachment-name">{att.name}</div>
                <div className="attachment-size">{formatSize(att.size)}</div>
              </div>
              <button
                type="button"
                className="attachment-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveAttachment(idx);
                }}
                title="Remove"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
