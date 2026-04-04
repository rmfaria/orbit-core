import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// Mock i18n before importing components that use it
vi.mock("../ui/i18n", () => ({
  t: (key: string) => key,
  setLocale: vi.fn(),
  getLocale: () => "en",
}));

// Mock chart.js to avoid canvas issues in jsdom
vi.mock("chart.js", () => ({
  Chart: { register: vi.fn() },
  LineController: {},
  LineElement: {},
  PointElement: {},
  DoughnutController: {},
  ArcElement: {},
  RadarController: {},
  RadialLinearScale: {},
  LinearScale: {},
  CategoryScale: {},
  Filler: {},
  Tooltip: {},
  Legend: {},
}));

describe("ErrorBoundary", () => {
  // Dynamically import after mocks are set up
  it("renders children when no error", async () => {
    const { ErrorBoundary } = await import("../ui/components/ErrorBoundary");
    render(
      <ErrorBoundary>
        <div data-testid="child">Hello</div>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("renders error message when child throws", async () => {
    const { ErrorBoundary } = await import("../ui/components/ErrorBoundary");
    const ThrowingComponent = () => {
      throw new Error("Test crash");
    };

    // Suppress React error boundary console output in tests
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/Test crash/)).toBeInTheDocument();
    expect(screen.getByText(/Recarregar/)).toBeInTheDocument();
    spy.mockRestore();
  });
});

describe("AuthGate", () => {
  it("shows loading state initially", async () => {
    // Mock fetch to never resolve (simulates loading)
    vi.mocked(globalThis.fetch).mockReturnValue(new Promise(() => {}));

    const { AuthGate } = await import("../ui/components/AuthGate");
    render(
      <AuthGate>
        <div>Protected content</div>
      </AuthGate>,
    );

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows children when auth status returns ok", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, setup_complete: true }),
    } as Response);

    // Pre-set api key in localStorage
    window.localStorage.setItem("orbit_api_key", "test-key-123");

    const { AuthGate } = await import("../ui/components/AuthGate");

    render(
      <AuthGate>
        <div data-testid="protected">Secret</div>
      </AuthGate>,
    );

    // Wait for effect to resolve
    const el = await screen.findByTestId("protected");
    expect(el).toBeInTheDocument();
  });
});

describe("LicenseBanner", () => {
  it("renders license message", async () => {
    const { LicenseBanner } = await import("../ui/components/LicenseBanner");
    render(
      <LicenseBanner msg="Trial expires in 7 days" onActivated={vi.fn()} />,
    );
    expect(screen.getByText("Trial expires in 7 days")).toBeInTheDocument();
  });
});
