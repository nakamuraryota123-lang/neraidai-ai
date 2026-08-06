import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const origin = "https://nakamuraryota123-lang.github.io";
const env = { OPENAI_API_KEY: "test-only", AI_RATE_LIMITER: { limit: async () => ({ success: true }) } };

test("health check does not expose secrets", async () => {
  const response = await worker.fetch(new Request("https://worker.example/health"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("rejects unapproved origins", async () => {
  const request = new Request("https://worker.example/v1/analyze", { method: "POST", headers: { Origin: "https://evil.example" } });
  assert.equal((await worker.fetch(request, env)).status, 403);
});

test("answers CORS preflight for GitHub Pages", async () => {
  const request = new Request("https://worker.example/v1/analyze", { method: "OPTIONS", headers: { Origin: origin } });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
});

test("fails closed when the server secret is absent", async () => {
  const request = new Request("https://worker.example/v1/analyze", { method: "POST", headers: { Origin: origin } });
  assert.equal((await worker.fetch(request, {})).status, 503);
});

test("validates image count before calling OpenAI", async () => {
  const request = new Request("https://worker.example/v1/analyze", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ images: [], today: "2026-08-06" }) });
  assert.equal((await worker.fetch(request, env)).status, 400);
});

test("returns normalized model rows without exposing the key", async () => {
  const originalFetch = globalThis.fetch;
  let authorization = "";
  globalThis.fetch = async (_url, options) => {
    authorization = options.headers.Authorization;
    return new Response(JSON.stringify({ output_text: '{"rows":[{"date":"2026-08-06","unit":"0531"}]}' }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const image = `data:image/png;base64,${Buffer.from("test").toString("base64")}`;
    const request = new Request("https://worker.example/v1/analyze", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.1" }, body: JSON.stringify({ images: [image], today: "2026-08-06" }) });
    const response = await worker.fetch(request, env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).rows[0].unit, "0531");
    assert.equal(authorization, "Bearer test-only");
  } finally { globalThis.fetch = originalFetch; }
});
