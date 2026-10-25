/// <reference types="vitest/jsdom" />
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Node 25 also defines localStorage. Use jsdom's isolated browser storage,
// rather than Node's process-wide storage (which needs a filesystem path).
vi.stubGlobal("localStorage", jsdom.window.localStorage);
vi.stubGlobal("sessionStorage", jsdom.window.sessionStorage);

// jsdom has no layout engine. Keep the real list components, without running
// their browser-only resize/animation machinery.
vi.stubGlobal("ResizeObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});
