import * as React from "react";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";

interface AppDataPaths {
  config_dir: string | null;
  data_dir: string | null;
  cache_dir: string | null;
}

export default function UninstallModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState<"confirm" | "paths" | "uninstalling">("confirm");
  const [paths, setPaths] = useState<AppDataPaths | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStep("confirm");
      setError(null);
      // Fetch app data paths
      invoke<AppDataPaths>("get_app_data_paths")
        .then(setPaths)
        .catch((err) => console.error("Failed to get app paths:", err));
    }
  }, [open]);

  if (!open) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && step !== "uninstalling") {
      onClose();
    }
  };

  const handleUninstall = async () => {
    setStep("uninstalling");
    setError(null);
    try {
      await invoke("uninstall_aurora");
      // App will quit after successful uninstall
    } catch (err) {
      setError(String(err));
      setStep("confirm");
    }
  };

  return (
    <div className="about-modal" role="dialog" aria-modal="true" onClick={handleBackdropClick}>
      <div className="about-content" style={{ maxWidth: 480 }}>
        {step !== "uninstalling" && (
          <button className="close-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}

        {step === "confirm" && (
          <>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>⚠️</div>
              <h2 style={{ margin: 0, color: "var(--error)" }}>Uninstall Aurora</h2>
            </div>

            <p style={{ textAlign: "center", margin: "16px 0" }}>
              Are you sure you want to uninstall Aurora? This will remove:
            </p>

            <ul style={{ margin: "16px 0", paddingLeft: 24 }}>
              <li>The Aurora application</li>
              <li>Configuration files</li>
              <li>Cache and temporary files</li>
            </ul>

            <div style={{
              background: "var(--bg-secondary)",
              padding: 12,
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 13
            }}>
              <strong>Note:</strong> Your downloaded models will be kept in the storage directory.
              You can remove them manually if needed.
            </div>

            {error && (
              <div style={{
                background: "var(--error-bg, #fee)",
                color: "var(--error)",
                padding: 12,
                borderRadius: 8,
                marginBottom: 16,
                fontSize: 13
              }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button className="pick-btn" onClick={onClose}>
                Cancel
              </button>
              <button
                className="pick-btn"
                onClick={() => setStep("paths")}
                style={{ background: "var(--error)", color: "white" }}
              >
                Continue
              </button>
            </div>
          </>
        )}

        {step === "paths" && (
          <>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>📁</div>
              <h2 style={{ margin: 0 }}>Data to be Removed</h2>
            </div>

            <p style={{ textAlign: "center", margin: "16px 0", fontSize: 13 }}>
              The following directories will be removed:
            </p>

            <div style={{
              background: "var(--bg-secondary)",
              padding: 16,
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 12,
              fontFamily: "monospace"
            }}>
              {paths && (
                <ul style={{ margin: 0, paddingLeft: 20, listStyle: "none" }}>
                  {paths.config_dir && <li>📄 {paths.config_dir}</li>}
                  {paths.data_dir && <li>📁 {paths.data_dir}</li>}
                  {paths.cache_dir && <li>🗑️ {paths.cache_dir}</li>}
                  <li>🍎 /Applications/Aurora.app</li>
                </ul>
              )}
            </div>

            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button className="pick-btn" onClick={() => setStep("confirm")}>
                Back
              </button>
              <button
                className="pick-btn"
                onClick={handleUninstall}
                style={{ background: "var(--error)", color: "white" }}
              >
                Uninstall Aurora
              </button>
            </div>
          </>
        )}

        {step === "uninstalling" && (
          <>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>⏳</div>
              <h2 style={{ margin: 0 }}>Uninstalling...</h2>
            </div>

            <p style={{ textAlign: "center", margin: "16px 0" }}>
              Please wait while Aurora is being uninstalled...
            </p>

            <div style={{ display: "flex", justifyContent: "center" }}>
              <div className="spinner" style={{
                width: 32,
                height: 32,
                border: "3px solid var(--border-primary)",
                borderTopColor: "var(--accent-primary)",
                borderRadius: "50%",
                animation: "spin 1s linear infinite"
              }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
