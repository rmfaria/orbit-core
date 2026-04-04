/**
 * orbit-core
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { t, setLocale, getLocale, Locale } from "../i18n";
import { S, Tab, NS_COLOR, useIsMobile } from "../shared";
import { HealthBadge } from "../chartHelpers";

export function TopBar({
  tab,
  setTab,
  onLocaleChange,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  onLocaleChange: () => void;
}) {
  const isMobile = useIsMobile();
  const [fontesDdOpen, setFontesDdOpen] = React.useState(false);
  const [analysisDdOpen, setAnalysisDdOpen] = React.useState(false);
  const [gearDdOpen, setGearDdOpen] = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [apiKey, setApiKey] = React.useState(
    () => localStorage.getItem("orbit_api_key") ?? "",
  );
  const [locale, setLoc] = React.useState<Locale>(getLocale);

  function changeLocale(l: Locale) {
    setLocale(l);
    setLoc(l);
    onLocaleChange();
  }

  // Close dropdowns on outside click
  React.useEffect(() => {
    function handle(e: MouseEvent) {
      const tgt = e.target as HTMLElement;
      if (!tgt.closest('[data-dd="fontes"]')) setFontesDdOpen(false);
      if (!tgt.closest('[data-dd="analysis"]')) setAnalysisDdOpen(false);
      if (!tgt.closest('[data-dd="gear"]')) setGearDdOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  // Close mobile nav on resize to desktop
  React.useEffect(() => {
    if (!isMobile) setMobileNavOpen(false);
  }, [isMobile]);

  function navTabBtn(tid: Tab, label: string) {
    const active = tab === tid;
    return (
      <button
        key={tid}
        onClick={() => setTab(tid)}
        style={{
          background: active ? "rgba(85,243,255,0.12)" : "transparent",
          border: active
            ? "1px solid rgba(85,243,255,0.28)"
            : "1px solid transparent",
          borderRadius: 8,
          color: active ? "#55f3ff" : "rgba(233,238,255,0.60)",
          padding: "5px 12px",
          margin: "0 2px",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: active ? 700 : 500,
          transition: "all 0.15s",
          whiteSpace: "nowrap" as const,
          height: 34,
          display: "flex",
          alignItems: "center",
        }}
      >
        {label}
      </button>
    );
  }

  // Drawer nav item (mobile)
  function navDrawerBtn(tid: Tab, label: string) {
    const active = tab === tid;
    return (
      <button
        key={tid}
        onClick={() => {
          setTab(tid);
          setMobileNavOpen(false);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          background: active ? "rgba(85,243,255,0.08)" : "transparent",
          border: "none",
          borderLeft: active ? "3px solid #55f3ff" : "3px solid transparent",
          color: active ? "#55f3ff" : "rgba(233,238,255,0.80)",
          padding: "14px 20px",
          cursor: "pointer",
          fontSize: 15,
          fontWeight: active ? 700 : 400,
          textAlign: "left" as const,
          transition: "background 0.12s",
        }}
      >
        {label}
      </button>
    );
  }

  const isFontesActive = tab.startsWith("src-");

  function logoff() {
    localStorage.removeItem("orbit_api_key");
    setApiKey("");
    setTab("home");
  }

  const ddBase: React.CSSProperties = {
    position: "absolute" as const,
    top: "100%",
    right: 0,
    marginTop: 4,
    background: "rgba(8,12,28,0.97)",
    border: "1px solid rgba(140,160,255,0.20)",
    borderRadius: 12,
    boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
    backdropFilter: "blur(12px)",
    minWidth: 160,
    zIndex: 100,
    overflow: "hidden" as const,
  };

  const ddBtn: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    background: "transparent",
    border: "none",
    color: "rgba(233,238,255,0.80)",
    padding: "10px 16px",
    cursor: "pointer",
    fontSize: 13,
    textAlign: "left" as const,
  };

  const sourceLabels = [
    "Nagios",
    "Wazuh",
    "Fortigate",
    "n8n",
    "OTel",
    "Suricata",
    "OpenClaw",
  ];
  const sourceColors = [
    NS_COLOR.nagios,
    NS_COLOR.wazuh,
    NS_COLOR.fortigate,
    NS_COLOR.n8n,
    NS_COLOR.otel,
    NS_COLOR.suricata,
    NS_COLOR.openclaw,
  ];
  const sourceTabs: Tab[] = [
    "src-nagios",
    "src-wazuh",
    "src-fortigate",
    "src-n8n",
    "src-otel",
    "src-suricata",
    "src-openclaw",
  ];

  return (
    <>
      <div style={S.topbar}>
        {/* Logo */}
        <span
          style={{
            fontSize: 15,
            fontWeight: 800,
            color: "#55f3ff",
            letterSpacing: "0.2px",
            marginRight: 8,
            whiteSpace: "nowrap",
          }}
        >
          ◎ Orbit Core
        </span>

        {/* Divider */}
        <div
          style={{
            width: 1,
            height: 22,
            background: "rgba(140,160,255,0.18)",
            marginRight: 8,
          }}
        />

        {/* Nav tabs — desktop only */}
        {!isMobile && (
          <nav style={{ display: "flex", alignItems: "center", flex: 1 }}>
            {navTabBtn("home", t("nav_home"))}
            {navTabBtn("system", t("nav_system"))}

            {/* Sources dropdown */}
            <div data-dd="fontes" style={{ position: "relative" }}>
              <button
                onClick={() => setFontesDdOpen((x) => !x)}
                style={{
                  background: isFontesActive
                    ? "rgba(85,243,255,0.12)"
                    : "transparent",
                  border: isFontesActive
                    ? "1px solid rgba(85,243,255,0.28)"
                    : "1px solid transparent",
                  borderRadius: 8,
                  color: isFontesActive ? "#55f3ff" : "rgba(233,238,255,0.60)",
                  padding: "5px 12px",
                  margin: "0 2px",
                  height: 34,
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: isFontesActive ? 700 : 500,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  transition: "all 0.15s",
                  whiteSpace: "nowrap" as const,
                }}
              >
                {t("nav_sources")}
                <span style={{ fontSize: 10, opacity: 0.7 }}>
                  {fontesDdOpen ? "▲" : "▼"}
                </span>
              </button>
              {fontesDdOpen && (
                <div style={ddBase}>
                  {sourceTabs.map((tid, i) => {
                    const active = tab === tid;
                    return (
                      <button
                        key={tid}
                        onClick={() => {
                          setTab(tid);
                          setFontesDdOpen(false);
                        }}
                        style={{
                          ...ddBtn,
                          background: active
                            ? "rgba(85,243,255,0.07)"
                            : "transparent",
                          color: active ? "#e9eeff" : "rgba(233,238,255,0.75)",
                          fontWeight: active ? 700 : 400,
                        }}
                      >
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            background: sourceColors[i],
                            flexShrink: 0,
                          }}
                        />
                        {sourceLabels[i]}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Analysis dropdown */}
            {(() => {
              const analysisTabs: Tab[] = [
                "events",
                "metrics",
                "correlations",
                "threat-intel",
              ];
              const analysisLabels = [
                t("nav_events"),
                t("nav_metrics"),
                t("nav_correlations"),
                "Threat Intel",
              ];
              const isAnalysisActive = analysisTabs.includes(tab);
              return (
                <div data-dd="analysis" style={{ position: "relative" }}>
                  <button
                    onClick={() => setAnalysisDdOpen((x) => !x)}
                    style={{
                      background: isAnalysisActive
                        ? "rgba(85,243,255,0.12)"
                        : "transparent",
                      border: isAnalysisActive
                        ? "1px solid rgba(85,243,255,0.28)"
                        : "1px solid transparent",
                      borderRadius: 8,
                      color: isAnalysisActive
                        ? "#55f3ff"
                        : "rgba(233,238,255,0.60)",
                      padding: "5px 12px",
                      margin: "0 2px",
                      height: 34,
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: isAnalysisActive ? 700 : 500,
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      transition: "all 0.15s",
                      whiteSpace: "nowrap" as const,
                    }}
                  >
                    {t("nav_analysis")}
                    <span style={{ fontSize: 10, opacity: 0.7 }}>
                      {analysisDdOpen ? "▲" : "▼"}
                    </span>
                  </button>
                  {analysisDdOpen && (
                    <div style={ddBase}>
                      {analysisTabs.map((tid, i) => {
                        const active = tab === tid;
                        return (
                          <button
                            key={tid}
                            onClick={() => {
                              setTab(tid);
                              setAnalysisDdOpen(false);
                            }}
                            style={{
                              ...ddBtn,
                              background: active
                                ? "rgba(85,243,255,0.07)"
                                : "transparent",
                              color: active
                                ? "#e9eeff"
                                : "rgba(233,238,255,0.75)",
                              fontWeight: active ? 700 : 400,
                            }}
                          >
                            {analysisLabels[i]}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
            {navTabBtn("alerts", t("nav_alerts"))}
            {navTabBtn("connectors", t("nav_connectors"))}
            {navTabBtn("dashboards", t("nav_dashboards"))}
            {navTabBtn("ai-designer", t("nav_ai_designer"))}
          </nav>
        )}

        {/* Mobile spacer */}
        {isMobile && <div style={{ flex: 1 }} />}

        {/* Right side — desktop */}
        {!isMobile && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginLeft: 8,
            }}
          >
            {/* Language switcher */}
            <div style={{ display: "flex", gap: 2 }}>
              {(["en", "pt-BR", "es"] as Locale[]).map((l) => (
                <button
                  key={l}
                  onClick={() => changeLocale(l)}
                  style={{
                    background:
                      locale === l ? "rgba(85,243,255,0.15)" : "transparent",
                    border:
                      "1px solid " +
                      (locale === l
                        ? "rgba(85,243,255,0.40)"
                        : "rgba(140,160,255,0.18)"),
                    borderRadius: 6,
                    color: locale === l ? "#55f3ff" : "rgba(233,238,255,0.50)",
                    padding: "3px 7px",
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: locale === l ? 700 : 500,
                    letterSpacing: "0.03em",
                    transition: "all 0.12s",
                    height: 26,
                  }}
                >
                  {l === "en" ? "EN" : l === "pt-BR" ? "PT" : "ES"}
                </button>
              ))}
            </div>

            <HealthBadge />

            {/* User indicator */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: apiKey ? "#4ade80" : "#fbbf24",
                  display: "inline-block",
                }}
              />
              <span
                style={{
                  color: apiKey ? "#4ade80" : "#fbbf24",
                  fontWeight: 600,
                }}
              >
                {apiKey ? t("auth_admin") : t("auth_no_auth")}
              </span>
            </div>

            {/* Gear dropdown */}
            <div data-dd="gear" style={{ position: "relative" }}>
              <button
                onClick={() => setGearDdOpen((x) => !x)}
                title={t("auth_settings")}
                style={{
                  background: gearDdOpen
                    ? "rgba(85,243,255,0.10)"
                    : "transparent",
                  border:
                    "1px solid " +
                    (gearDdOpen
                      ? "rgba(85,243,255,0.30)"
                      : "rgba(140,160,255,0.20)"),
                  borderRadius: 8,
                  color: "rgba(233,238,255,0.70)",
                  cursor: "pointer",
                  fontSize: 16,
                  width: 32,
                  height: 32,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "all 0.15s",
                }}
              >
                ⚙
              </button>
              {gearDdOpen && (
                <div style={ddBase}>
                  <button
                    onClick={() => {
                      setTab("admin");
                      setGearDdOpen(false);
                    }}
                    style={ddBtn}
                  >
                    ⚙ Administration
                  </button>
                </div>
              )}
            </div>

            {/* Logoff */}
            <button
              onClick={logoff}
              title="Logoff"
              style={{
                background: "transparent",
                border: "1px solid rgba(140,160,255,0.20)",
                borderRadius: 8,
                color: "rgba(233,238,255,0.55)",
                cursor: "pointer",
                fontSize: 15,
                width: 32,
                height: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.15s",
              }}
            >
              ⏻
            </button>
          </div>
        )}

        {/* Hamburger button — mobile only */}
        {isMobile && (
          <button
            onClick={() => setMobileNavOpen((x) => !x)}
            aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
            style={{
              background: mobileNavOpen
                ? "rgba(85,243,255,0.12)"
                : "transparent",
              border:
                "1px solid " +
                (mobileNavOpen
                  ? "rgba(85,243,255,0.30)"
                  : "rgba(140,160,255,0.20)"),
              borderRadius: 8,
              color: "#e9eeff",
              cursor: "pointer",
              fontSize: 20,
              width: 44,
              height: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.15s",
              marginLeft: 8,
              flexShrink: 0,
            }}
          >
            {mobileNavOpen ? "✕" : "☰"}
          </button>
        )}
      </div>

      {/* Mobile navigation drawer */}
      {isMobile && mobileNavOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            top: 50,
            zIndex: 40,
            background: "rgba(4,7,19,0.98)",
            backdropFilter: "blur(16px)",
            borderTop: "1px solid rgba(140,160,255,0.14)",
            overflowY: "auto",
            WebkitOverflowScrolling: "touch" as const,
          }}
          onClick={() => setMobileNavOpen(false)}
        >
          {/* Inner: stop propagation so clicks on items don't close via the outer div */}
          <div onClick={(e) => e.stopPropagation()}>
            {/* Status row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 20px",
                borderBottom: "1px solid rgba(140,160,255,0.10)",
              }}
            >
              <HealthBadge />
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: apiKey ? "#4ade80" : "#fbbf24",
                  display: "inline-block",
                }}
              />
              <span
                style={{
                  color: apiKey ? "#4ade80" : "#fbbf24",
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                {apiKey ? t("auth_admin") : t("auth_no_auth")}
              </span>
            </div>

            {/* Nav items */}
            <div>
              {navDrawerBtn("home", t("nav_home"))}
              {navDrawerBtn("system", t("nav_system"))}

              {/* Sources section */}
              <div
                style={{
                  padding: "10px 20px 4px",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  color: "rgba(233,238,255,0.35)",
                  textTransform: "uppercase" as const,
                }}
              >
                {t("nav_sources")}
              </div>
              {sourceTabs.map((tid, i) => {
                const active = tab === tid;
                return (
                  <button
                    key={tid}
                    onClick={() => {
                      setTab(tid);
                      setMobileNavOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      background: active
                        ? "rgba(85,243,255,0.08)"
                        : "transparent",
                      border: "none",
                      borderLeft: active
                        ? "3px solid #55f3ff"
                        : "3px solid transparent",
                      color: active ? "#55f3ff" : "rgba(233,238,255,0.75)",
                      padding: "13px 20px 13px 28px",
                      cursor: "pointer",
                      fontSize: 14,
                      fontWeight: active ? 700 : 400,
                      textAlign: "left" as const,
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: sourceColors[i],
                        flexShrink: 0,
                      }}
                    />
                    {sourceLabels[i]}
                  </button>
                );
              })}

              {/* Analysis section */}
              <div
                style={{
                  padding: "10px 20px 4px",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  color: "rgba(233,238,255,0.35)",
                  textTransform: "uppercase" as const,
                }}
              >
                {t("nav_analysis")}
              </div>
              {navDrawerBtn("events", t("nav_events"))}
              {navDrawerBtn("metrics", t("nav_metrics"))}
              {navDrawerBtn("correlations", t("nav_correlations"))}
              {navDrawerBtn("threat-intel", "Threat Intel")}

              {navDrawerBtn("alerts", t("nav_alerts"))}
              {navDrawerBtn("connectors", t("nav_connectors"))}
              {navDrawerBtn("dashboards", t("nav_dashboards"))}
              {navDrawerBtn("ai-designer", t("nav_ai_designer"))}
            </div>

            {/* Language switcher — mobile */}
            <div style={{ padding: "10px 20px", display: "flex", gap: 6 }}>
              {(["en", "pt-BR", "es"] as Locale[]).map((l) => (
                <button
                  key={l}
                  onClick={() => {
                    changeLocale(l);
                    setMobileNavOpen(false);
                  }}
                  style={{
                    background:
                      locale === l ? "rgba(85,243,255,0.15)" : "transparent",
                    border:
                      "1px solid " +
                      (locale === l
                        ? "rgba(85,243,255,0.40)"
                        : "rgba(140,160,255,0.20)"),
                    borderRadius: 8,
                    color: locale === l ? "#55f3ff" : "rgba(233,238,255,0.55)",
                    padding: "8px 18px",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: locale === l ? 700 : 500,
                    flex: 1,
                  }}
                >
                  {l === "en" ? "EN" : l === "pt-BR" ? "PT" : "ES"}
                </button>
              ))}
            </div>

            {/* Bottom actions */}
            <div
              style={{
                borderTop: "1px solid rgba(140,160,255,0.10)",
                padding: "14px 20px",
                display: "flex",
                gap: 10,
              }}
            >
              <button
                onClick={() => {
                  setTab("admin");
                  setMobileNavOpen(false);
                }}
                style={{
                  ...ddBtn,
                  flex: 1,
                  padding: "12px 16px",
                  borderRadius: 10,
                  border: "1px solid rgba(140,160,255,0.20)",
                  justifyContent: "center",
                  fontSize: 14,
                }}
              >
                ⚙ Admin
              </button>
              <button
                onClick={() => {
                  logoff();
                  setMobileNavOpen(false);
                }}
                style={{
                  ...ddBtn,
                  flex: 1,
                  padding: "12px 16px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,93,93,0.25)",
                  color: "#fca5a5",
                  justifyContent: "center",
                  fontSize: 14,
                }}
              >
                ⏻ Logoff
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
