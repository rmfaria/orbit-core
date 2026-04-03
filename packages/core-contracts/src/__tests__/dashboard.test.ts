import { describe, it, expect } from "vitest";
import {
  WidgetKindSchema,
  LayoutSchema,
  WidgetSpecSchema,
  DashboardSpecSchema,
} from "../dashboard.js";

describe("WidgetKindSchema", () => {
  it("accepts valid widget kinds", () => {
    for (const kind of [
      "timeseries",
      "timeseries_multi",
      "events",
      "eps",
      "kpi",
      "gauge",
    ]) {
      expect(WidgetKindSchema.parse(kind)).toBe(kind);
    }
  });

  it("rejects invalid kind", () => {
    expect(() => WidgetKindSchema.parse("pie")).toThrow();
  });
});

describe("LayoutSchema", () => {
  it("accepts valid layout", () => {
    const layout = LayoutSchema.parse({ x: 0, y: 0, w: 6, h: 4 });
    expect(layout).toEqual({ x: 0, y: 0, w: 6, h: 4 });
  });

  it("rejects negative x/y", () => {
    expect(() => LayoutSchema.parse({ x: -1, y: 0, w: 6, h: 4 })).toThrow();
  });

  it("rejects zero width/height", () => {
    expect(() => LayoutSchema.parse({ x: 0, y: 0, w: 0, h: 4 })).toThrow();
    expect(() => LayoutSchema.parse({ x: 0, y: 0, w: 6, h: 0 })).toThrow();
  });

  it("rejects non-integer values", () => {
    expect(() => LayoutSchema.parse({ x: 1.5, y: 0, w: 6, h: 4 })).toThrow();
  });
});

describe("WidgetSpecSchema", () => {
  const validWidget = {
    id: "w1",
    title: "CPU Load",
    kind: "timeseries",
    layout: { x: 0, y: 0, w: 6, h: 4 },
    query: {
      kind: "timeseries",
      asset_id: "host:srv1",
      namespace: "nagios",
      metric: "load1",
      from: "2024-01-01T00:00:00Z",
      to: "2024-01-02T00:00:00Z",
    },
  };

  it("accepts valid widget spec", () => {
    const result = WidgetSpecSchema.parse(validWidget);
    expect(result.id).toBe("w1");
    expect(result.title).toBe("CPU Load");
    expect(result.kind).toBe("timeseries");
  });

  it("accepts widget with optional note", () => {
    const result = WidgetSpecSchema.parse({ ...validWidget, note: "test" });
    expect(result.note).toBe("test");
  });

  it("rejects empty id", () => {
    expect(() => WidgetSpecSchema.parse({ ...validWidget, id: "" })).toThrow();
  });

  it("rejects empty title", () => {
    expect(() =>
      WidgetSpecSchema.parse({ ...validWidget, title: "" }),
    ).toThrow();
  });
});

describe("DashboardSpecSchema", () => {
  const validDashboard = {
    id: "d1",
    name: "Overview",
    widgets: [
      {
        id: "w1",
        title: "CPU",
        kind: "timeseries",
        layout: { x: 0, y: 0, w: 6, h: 4 },
        query: {
          kind: "timeseries",
          asset_id: "host:srv1",
          namespace: "nagios",
          metric: "load1",
          from: "2024-01-01T00:00:00Z",
          to: "2024-01-02T00:00:00Z",
        },
      },
    ],
  };

  it("accepts valid dashboard with defaults", () => {
    const result = DashboardSpecSchema.parse(validDashboard);
    expect(result.version).toBe("v1");
    expect(result.time.preset).toBe("60m");
    expect(result.tags).toEqual([]);
  });

  it("accepts dashboard with all optional fields", () => {
    const result = DashboardSpecSchema.parse({
      ...validDashboard,
      description: "Main overview",
      version: "v2",
      time: { preset: "24h" },
      tags: ["prod", "infra"],
    });
    expect(result.description).toBe("Main overview");
    expect(result.version).toBe("v2");
    expect(result.time.preset).toBe("24h");
    expect(result.tags).toEqual(["prod", "infra"]);
  });

  it("rejects empty widgets array", () => {
    expect(() =>
      DashboardSpecSchema.parse({ ...validDashboard, widgets: [] }),
    ).toThrow();
  });

  it("rejects empty name", () => {
    expect(() =>
      DashboardSpecSchema.parse({ ...validDashboard, name: "" }),
    ).toThrow();
  });

  it("rejects invalid time preset", () => {
    expect(() =>
      DashboardSpecSchema.parse({
        ...validDashboard,
        time: { preset: "2h" },
      }),
    ).toThrow();
  });
});
