/**
 * orbit-core
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  DoughnutController,
  ArcElement,
  RadarController,
  RadialLinearScale,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";
import "./home.css";
import { t } from "./i18n";
import { S, Tab, AssetOpt, useIsMobile, apiGetHeaders } from "./shared";
import { TopBar } from "./components/TopBar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AuthGate } from "./components/AuthGate";
import { LicenseBanner, LicenseStatus } from "./components/LicenseBanner";
import { LicenseSetup } from "./components/LicenseSetup";
import { SystemTab } from "./tabs/SystemTab";
import { HomeTab } from "./tabs/HomeTab";
import { MetricsTab } from "./tabs/MetricsTab";
import { WazuhTab } from "./tabs/WazuhTab";
import { EventsTab } from "./tabs/EventsTab";
import { NagiosTab } from "./tabs/NagiosTab";
import { OpenClawTab } from "./tabs/OpenClawTab";
import { CorrelationsTab } from "./tabs/CorrelationsTab";
import { AdminTab } from "./tabs/AdminTab";
import { SourcesTab } from "./tabs/SourcesTab";
import { DashboardsTab } from "./tabs/DashboardsTab";
import { AiDesignerTab } from "./tabs/AiDesignerTab";
import { AlertsTab } from "./tabs/AlertsTab";
import { ConnectorsTab } from "./tabs/ConnectorsTab";
import { ThreatIntelTab } from "./tabs/ThreatIntelTab";

// Register only the Chart.js components we actually use (smaller bundle).
Chart.register(
  LineController,
  LineElement,
  PointElement,
  DoughnutController,
  ArcElement,
  RadarController,
  RadialLinearScale,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend,
);

// ─── ROOT APP ─────────────────────────────────────────────────────────────────

export function App() {
  const isMobile = useIsMobile();
  const [tab, setTab] = React.useState<Tab>("home");
  const [assets, setAssets] = React.useState<AssetOpt[]>([]);
  const [needsKey, setNeedsKey] = React.useState(false);
  const [, _forceLocale] = React.useReducer((x: number) => x + 1, 0);

  const [licenseStatus, setLicenseStatus] =
    React.useState<LicenseStatus>("loading");
  const [licenseMsg, setLicenseMsg] = React.useState("");

  // Check license on mount
  React.useEffect(() => {
    fetch("api/v1/license/status")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setLicenseStatus(j.license.status);
          setLicenseMsg(j.license.message ?? "");
        } else {
          setLicenseStatus("grace");
        }
      })
      .catch(() => setLicenseStatus("grace"));
  }, []);

  React.useEffect(() => {
    if (
      licenseStatus === "loading" ||
      licenseStatus === "unlicensed" ||
      licenseStatus === "expired"
    )
      return;
    fetch("api/v1/catalog/assets?limit=500", { headers: apiGetHeaders() })
      .then((r) => {
        if (r.status === 401) {
          setNeedsKey(true);
          return null;
        }
        return r.json();
      })
      .then((j) => {
        if (j) {
          setNeedsKey(false);
          setAssets(
            (j?.assets ?? []).map((a: any) => ({
              asset_id: a.asset_id,
              name: a.name ?? a.asset_id,
            })),
          );
        }
      })
      .catch((e) => console.error("[orbit]", e));
  }, [tab, licenseStatus]);

  // Loading state
  if (licenseStatus === "loading") {
    return (
      <div
        style={{
          ...S.root,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          color: "#55f3ff",
        }}
      >
        {t("license_loading")}
      </div>
    );
  }

  // Unlicensed or expired → full-screen setup
  if (licenseStatus === "unlicensed" || licenseStatus === "expired") {
    return (
      <AuthGate>
        <LicenseSetup onActivated={() => setLicenseStatus("valid")} />
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <ErrorBoundary>
        <div style={S.root}>
          <TopBar tab={tab} setTab={setTab} onLocaleChange={_forceLocale} />
          <div
            style={{
              flex: 1,
              minWidth: 0,
              padding: isMobile ? "14px 12px" : "22px 24px",
            }}
          >
            {licenseStatus === "grace" && (
              <LicenseBanner
                msg={licenseMsg}
                onActivated={() => {
                  setLicenseStatus("valid");
                  setLicenseMsg("");
                }}
              />
            )}
            {needsKey && tab !== "admin" && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: isMobile ? "10px 12px" : "12px 18px",
                  marginBottom: 14,
                  background: "rgba(251,191,36,.08)",
                  border: "1px solid rgba(251,191,36,.35)",
                  borderRadius: 12,
                  fontSize: isMobile ? 12 : 13,
                  color: "#fbbf24",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: 18 }}>⚠</span>
                <span>
                  {t("err_api_key")}
                  <strong>API Key</strong>
                  {t("err_api_key_mid")}
                </span>
                <button
                  onClick={() => setTab("admin")}
                  style={{
                    background: "rgba(251,191,36,.15)",
                    border: "1px solid rgba(251,191,36,.4)",
                    borderRadius: 8,
                    color: "#fbbf24",
                    padding: "4px 12px",
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: 12,
                  }}
                >
                  ⚙ Admin
                </button>
                <span>{t("err_api_key_suffix")}</span>
              </div>
            )}
            {tab === "home" && <HomeTab assets={assets} setTab={setTab} />}
            {tab === "system" && <SystemTab />}
            {tab === "dashboards" && <DashboardsTab assets={assets} />}
            {tab === "ai-designer" && <AiDesignerTab />}
            {tab === "src-nagios" && <NagiosTab assets={assets} />}
            {tab === "src-wazuh" && <WazuhTab assets={assets} />}
            {tab === "src-fortigate" && (
              <EventsTab
                key="src-fortigate"
                assets={assets}
                defaultNs="wazuh"
              />
            )}
            {tab === "src-n8n" && (
              <EventsTab key="src-n8n" assets={assets} defaultNs="n8n" />
            )}
            {tab === "src-otel" && (
              <EventsTab key="src-otel" assets={assets} defaultNs="otel" />
            )}
            {tab === "src-suricata" && (
              <EventsTab
                key="src-suricata"
                assets={assets}
                defaultNs="suricata"
              />
            )}
            {tab === "src-openclaw" && <OpenClawTab assets={assets} />}
            {tab === "events" && <EventsTab key="events" assets={assets} />}
            {tab === "metrics" && <MetricsTab assets={assets} />}
            {tab === "correlations" && <CorrelationsTab assets={assets} />}
            {tab === "threat-intel" && <ThreatIntelTab assets={assets} />}
            {tab === "alerts" && <AlertsTab assets={assets} />}
            {tab === "connectors" && <ConnectorsTab setTab={setTab} />}
            {tab === "admin" && <AdminTab setTab={setTab} />}
          </div>
        </div>
      </ErrorBoundary>
    </AuthGate>
  );
}
