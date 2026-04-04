/**
 * orbit-core
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(e: Error) {
    return { error: e };
  }
  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 40,
            color: "#f87171",
            fontFamily: "monospace",
            background: "#0f0f12",
            minHeight: "100dvh",
          }}
        >
          <div style={{ fontSize: 18, marginBottom: 12, fontWeight: 700 }}>
            Erro inesperado na interface
          </div>
          <pre
            style={{
              fontSize: 12,
              color: "#94a3b8",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              marginBottom: 20,
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "8px 20px",
              cursor: "pointer",
              background: "#2d2d8f",
              border: "none",
              color: "#e2e8f0",
              borderRadius: 8,
              fontWeight: 600,
            }}
          >
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
