/**
 * orbit-core
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { t } from "../i18n";
import { S } from "../shared";

export type LicenseStatus =
  | "loading"
  | "valid"
  | "grace"
  | "expired"
  | "unlicensed";

export function LicenseBanner({
  msg,
  onActivated,
}: {
  msg: string;
  onActivated: () => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [key, setKey] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function activate() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("api/v1/license/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ license_key: key.trim() }),
      });
      const j = await res.json();
      if (j.ok) onActivated();
      else setError(j.error || "Invalid license key");
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        marginBottom: 14,
        background: "rgba(85,243,255,0.06)",
        border: "1px solid rgba(85,243,255,0.25)",
        borderRadius: 12,
        fontSize: 13,
        color: "#55f3ff",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 16 }}>&#x23F3;</span>
        <span style={{ flex: 1, minWidth: 150 }}>{msg}</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: "rgba(85,243,255,0.12)",
              border: "1px solid rgba(85,243,255,0.3)",
              borderRadius: 8,
              color: "#55f3ff",
              padding: "4px 12px",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            {expanded ? "✕" : t("license_activate")}
          </button>
          <a
            href="https://orbit-core.org/register.html"
            target="_blank"
            rel="noreferrer"
            style={{
              color: "#55f3ff",
              fontWeight: 700,
              textDecoration: "underline",
              fontSize: 12,
            }}
          >
            {t("license_get_free")}
          </a>
        </div>
      </div>
      {expanded && (
        <div
          style={{
            padding: "0 18px 14px",
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap" as const,
          }}
        >
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t("license_key_placeholder")}
            style={{
              ...S.input,
              flex: 1,
              minWidth: 0,
              fontFamily: "monospace",
              fontSize: 12,
              padding: "8px 12px",
              boxSizing: "border-box" as const,
            }}
          />
          <button
            onClick={activate}
            disabled={loading || !key.trim()}
            style={{
              ...S.btn,
              padding: "8px 20px",
              fontSize: 12,
              whiteSpace: "nowrap" as const,
            }}
          >
            {loading ? t("license_activating") : "→ " + t("license_activate")}
          </button>
          {error && (
            <span style={{ color: "#f87171", fontSize: 12 }}>{error}</span>
          )}
        </div>
      )}
    </div>
  );
}
