import React from "react";
import uiPkg from "../../package.json";

export default function AboutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="about-modal" role="dialog" aria-modal="true" onClick={handleBackdropClick}>
      <div className="about-content">
        <button className="close-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2>Aurora</h2>
        <div className="muted">FinAI Labz • v{uiPkg.version}</div>
        <p>
          Copyright © 2026 <strong>FinAI Labz</strong>. All rights reserved for commercial use. This project is
          licensed under the PolyForm Noncommercial 1.0.0. Non-commercial use is permitted—see the LICENSE file.
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <a className="pick-btn" href="../LICENSE" target="_blank" rel="noreferrer">
            View LICENSE
          </a>
          <a className="pick-btn" href="../LICENSE-FAQ.md" target="_blank" rel="noreferrer">
            License FAQ
          </a>
          <a className="pick-btn" href="https://github.com/inaim-finailabz/aurora" target="_blank" rel="noreferrer">
            Project on GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
