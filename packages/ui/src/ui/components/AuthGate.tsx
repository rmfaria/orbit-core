/**
 * orbit-core
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = React.useState<
    "loading" | "setup" | "login" | "ok"
  >("loading");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const hasKey = !!localStorage.getItem("orbit_api_key");

    fetch("api/v1/auth/status")
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) {
          setAuthState("ok");
          return;
        } // endpoint missing → legacy mode
        if (!j.setup_complete) {
          // First access — clear stale key and show setup
          localStorage.removeItem("orbit_api_key");
          setAuthState("setup");
        } else if (hasKey) {
          setAuthState("ok");
        } else {
          setAuthState("login");
        }
      })
      .catch(() => setAuthState("ok")); // network error → let the app handle it
  }, []);

  if (authState === "loading") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "#030711",
          color: "#55f3ff",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        Loading...
      </div>
    );
  }
  if (authState === "ok") return <>{children}</>;

  const isSetup = authState === "setup";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (isSetup && password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setBusy(true);
    try {
      const endpoint = isSetup ? "api/v1/auth/setup" : "api/v1/auth/login";
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const j = await r.json();
      if (!j.ok) {
        setError(j.error || "Authentication failed");
        setBusy(false);
        return;
      }
      localStorage.setItem("orbit_api_key", j.api_key);
      window.location.reload();
    } catch {
      setError("Connection failed");
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#030711",
        fontFamily: "Inter, system-ui, sans-serif",
        padding: 16,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          maxWidth: 400,
          width: "100%",
          padding: "clamp(20px, 5vw, 40px)",
          borderRadius: 16,
          background: "rgba(15,23,42,0.85)",
          border: "1px solid rgba(85,243,255,0.12)",
          backdropFilter: "blur(24px)",
          textAlign: "center",
          boxSizing: "border-box",
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 8 }}>&#x2B21;</div>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 900,
            color: "#e9eeff",
            margin: "0 0 4px",
          }}
        >
          {isSetup ? "Create Admin Password" : "Orbit Core Login"}
        </h1>
        <p style={{ color: "#8c9ab5", fontSize: 13, margin: "0 0 28px" }}>
          {isSetup
            ? "Set your admin password to get started."
            : "Enter your password to continue."}
        </p>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            textAlign: "left",
          }}
        >
          <div>
            <label
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#8c9ab5",
                display: "block",
                marginBottom: 4,
              }}
            >
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
              minLength={6}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 10,
                border: "1px solid rgba(140,160,255,0.2)",
                background: "rgba(15,23,42,0.6)",
                color: "#e9eeff",
                fontSize: 14,
                fontFamily: "inherit",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
          {isSetup && (
            <div>
              <label
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#8c9ab5",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                Confirm Password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={6}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: "1px solid rgba(140,160,255,0.2)",
                  background: "rgba(15,23,42,0.6)",
                  color: "#e9eeff",
                  fontSize: 14,
                  fontFamily: "inherit",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            style={{
              padding: 14,
              border: "none",
              borderRadius: 10,
              background: "linear-gradient(135deg, #55f3ff, #a78bfa)",
              color: "#030711",
              fontSize: 15,
              fontWeight: 800,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.5 : 1,
              marginTop: 8,
            }}
          >
            {busy
              ? isSetup
                ? "Creating..."
                : "Logging in..."
              : isSetup
                ? "Create Password"
                : "Login"}
          </button>
          {error && (
            <div
              style={{
                color: "#f87171",
                fontSize: 13,
                padding: "10px 14px",
                background: "rgba(248,113,113,0.08)",
                border: "1px solid rgba(248,113,113,0.2)",
                borderRadius: 8,
              }}
            >
              {error}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
