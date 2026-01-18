import React, { useState } from "react";
import uiPkg from "../../package.json";

const MIT_LICENSE = `MIT License

Copyright (c) 2026 FinAI Labz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

export default function AboutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [showLicense, setShowLicense] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const copyLicense = async () => {
    try {
      await navigator.clipboard.writeText(MIT_LICENSE);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy license:", err);
    }
  };

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText("contact@finailabz.com");
    } catch (err) {
      console.error("Failed to copy email:", err);
    }
  };

  return (
    <div className="about-modal" role="dialog" aria-modal="true" onClick={handleBackdropClick}>
      <div className="about-content" style={{ maxWidth: 520 }}>
        <button className="close-btn" onClick={onClose} aria-label="Close">
          ×
        </button>

        {/* Logo and Title */}
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🌌</div>
          <h2 style={{ margin: 0 }}>Aurora</h2>
          <div className="muted" style={{ marginTop: 4 }}>v{uiPkg.version}</div>
        </div>

        {/* Description */}
        <p style={{ textAlign: "center", margin: "16px 0" }}>
          A powerful desktop application for running local LLM inference with GGUF models.
          Built with Rust, React, and Tauri.
        </p>

        {/* Company Info */}
        <div style={{ background: "var(--panel-bg)", padding: 16, borderRadius: 8, marginBottom: 16 }}>
          <h4 style={{ margin: "0 0 12px 0" }}>Company Information</h4>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span><strong>Company:</strong></span>
              <span>FinAI Labz</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span><strong>Website:</strong></span>
              <a href="https://finailabz.com" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                finailabz.com
              </a>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span><strong>Email:</strong></span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <a href="mailto:contact@finailabz.com" style={{ color: "var(--accent)" }}>
                  contact@finailabz.com
                </a>
                <button
                  className="pick-btn"
                  onClick={copyEmail}
                  style={{ padding: "2px 8px", fontSize: 11 }}
                >
                  Copy
                </button>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span><strong>Support:</strong></span>
              <a href="mailto:support@finailabz.com" style={{ color: "var(--accent)" }}>
                support@finailabz.com
              </a>
            </div>
          </div>
        </div>

        {/* License Section */}
        <div style={{ background: "var(--panel-bg)", padding: 16, borderRadius: 8, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h4 style={{ margin: 0 }}>License</h4>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="pick-btn" onClick={() => setShowLicense(!showLicense)}>
                {showLicense ? "Hide" : "View"} License
              </button>
              <button className="pick-btn" onClick={copyLicense}>
                {copied ? "Copied!" : "Copy License"}
              </button>
            </div>
          </div>
          <p style={{ margin: "8px 0 0 0", fontSize: 13 }}>
            This software is licensed under the <strong>MIT License</strong>.
          </p>
          {showLicense && (
            <pre style={{
              background: "var(--bg)",
              padding: 12,
              borderRadius: 6,
              marginTop: 12,
              fontSize: 11,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 200,
              overflow: "auto"
            }}>
              {MIT_LICENSE}
            </pre>
          )}
        </div>

        {/* Copyright */}
        <p style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", margin: "16px 0 8px 0" }}>
          Copyright © 2026 FinAI Labz. All rights reserved.
        </p>

        {/* Links */}
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <a className="pick-btn" href="https://github.com/inaim-finailabz/aurora" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a className="pick-btn" href="https://finailabz.com/aurora/docs" target="_blank" rel="noreferrer">
            Documentation
          </a>
          <a className="pick-btn" href="https://subscription-portal.finailabz.com" target="_blank" rel="noreferrer">
            Subscriptions
          </a>
        </div>
      </div>
    </div>
  );
}
