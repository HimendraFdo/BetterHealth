import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.js";

test("GET /health returns ok", async () => {
  const app = buildApp({ logger: false });

  // inject() simulates an HTTP request in memory; no port is opened.
  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });
});
