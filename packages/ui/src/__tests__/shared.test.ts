import { describe, it, expect } from "vitest";
import {
  eventSource,
  fmtTs,
  relativeFrom,
  isoToLocal,
  SEV_COLOR,
  NS_COLOR,
  NAGIOS_STATE_COLOR,
} from "../ui/shared";

describe("eventSource", () => {
  it("returns fortigate for wazuh+fortigate kind", () => {
    expect(eventSource({ namespace: "wazuh", kind: "fortigate" })).toBe(
      "fortigate",
    );
  });

  it("returns namespace for non-fortigate events", () => {
    expect(eventSource({ namespace: "wazuh", kind: "alert" })).toBe("wazuh");
    expect(eventSource({ namespace: "nagios", kind: "state_change" })).toBe(
      "nagios",
    );
    expect(eventSource({ namespace: "suricata", kind: "alert" })).toBe(
      "suricata",
    );
  });
});

describe("fmtTs", () => {
  it("formats ISO timestamp to locale string", () => {
    const result = fmtTs("2024-06-15T10:30:00Z");
    expect(result).toContain("2024");
    expect(result).toBeTruthy();
  });
});

describe("relativeFrom", () => {
  it("returns ISO string N hours in the past", () => {
    const before = Date.now();
    const result = relativeFrom(1);
    const parsed = new Date(result).getTime();
    expect(parsed).toBeGreaterThan(before - 3601_000);
    expect(parsed).toBeLessThanOrEqual(before - 3599_000);
  });

  it("returns valid ISO string", () => {
    const result = relativeFrom(24);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe("isoToLocal", () => {
  it("converts ISO to datetime-local format", () => {
    const result = isoToLocal("2024-06-15T10:30:00Z");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("returns empty string for empty input", () => {
    expect(isoToLocal("")).toBe("");
  });

  it("returns empty string for invalid date", () => {
    expect(isoToLocal("not-a-date")).toBe("");
  });
});

describe("color constants", () => {
  it("has all severity colors", () => {
    for (const sev of ["critical", "high", "medium", "low", "info"]) {
      expect(SEV_COLOR[sev]).toBeDefined();
      expect(SEV_COLOR[sev]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("has all namespace colors", () => {
    for (const ns of [
      "nagios",
      "wazuh",
      "fortigate",
      "n8n",
      "otel",
      "suricata",
      "openclaw",
    ]) {
      expect(NS_COLOR[ns]).toBeDefined();
    }
  });

  it("has nagios state colors", () => {
    for (const state of [
      "OK",
      "UP",
      "WARNING",
      "CRITICAL",
      "DOWN",
      "UNKNOWN",
    ]) {
      expect(NAGIOS_STATE_COLOR[state]).toBeDefined();
    }
  });
});
