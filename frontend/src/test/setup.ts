// Runs before every test file.
import "@testing-library/jest-dom/vitest"; // adds expect(...).toBeInTheDocument() etc.
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

// jsdom has no layout engine, so Recharts' ResponsiveContainer needs a
// stand-in ResizeObserver to render at all.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
