import "@testing-library/jest-dom/vitest";

// Mock localStorage
const store: Record<string, string> = {};
Object.defineProperty(window, "localStorage", {
  value: {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  },
});

// Mock fetch
globalThis.fetch = vi.fn(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response),
);
