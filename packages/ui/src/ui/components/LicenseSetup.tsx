/**
 * orbit-core
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { t } from "../i18n";
import { S } from "../shared";

export function LicenseSetup({ onActivated }: { onActivated: () => void }) {
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
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(1000px 640px at 50% 40%, rgba(85,243,255,0.08), transparent 55%), linear-gradient(180deg, #040713, #0b1220)",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: "#e9eeff",
      }}
    >
      <div
        style={{
          ...S.card,
          maxWidth: 520,
          width: "90%",
          padding: 32,
          textAlign: "center" as const,
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 8 }}>&#x2B21;</div>
        <div style={{ fontWeight: 900, fontSize: 22, marginBottom: 4 }}>
          {t("license_setup_title")}
        </div>
        <div
          style={{
            color: "rgba(233,238,255,0.65)",
            fontSize: 14,
            marginBottom: 24,
          }}
        >
          {t("license_setup_subtitle")}
        </div>
        <textarea
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={t("license_key_placeholder")}
          style={{
            ...S.input,
            width: "100%",
            minHeight: 80,
            resize: "vertical" as const,
            fontFamily: "monospace",
            fontSize: 12,
            marginBottom: 12,
            boxSizing: "border-box" as const,
          }}
        />
        {error && <div style={S.err}>{error}</div>}
        <button
          onClick={activate}
          disabled={loading || !key.trim()}
          style={{
            ...S.btn,
            width: "100%",
            marginTop: 12,
            padding: "12px 16px",
          }}
        >
          {loading ? t("license_activating") : t("license_activate")}
        </button>
        <div
          style={{
            marginTop: 20,
            fontSize: 13,
            color: "rgba(233,238,255,0.55)",
          }}
        >
          {t("license_no_key")}{" "}
          <a
            href="https://orbit-core.org/register.html"
            target="_blank"
            rel="noreferrer"
            style={{ color: "#55f3ff", textDecoration: "none" }}
          >
            {t("license_register_link")}
          </a>
        </div>
      </div>
    </div>
  );
}
