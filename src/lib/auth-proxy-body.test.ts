import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error Node reads this TypeScript source directly.
import { readAuthBody } from "./auth-proxy-body.ts";

test("auth accepts object JSON and empty refresh bodies", async () => {
  assert.deepEqual(await readAuthBody(new Request("http://localhost", { method: "POST", body: '{"email":"viewer@example.test"}' })), { email: "viewer@example.test" });
  assert.deepEqual(await readAuthBody(new Request("http://localhost", { method: "POST" })), {});
});

test("malformed, array and scalar auth payloads are rejected", async () => {
  for (const body of ['{', '[]', 'null', '"text"']) await assert.rejects(readAuthBody(new Request("http://localhost", { method: "POST", body })), { status: 400 });
});

test("oversized auth payloads are bounded without trusting Content-Length", async () => {
  await assert.rejects(readAuthBody(new Request("http://localhost", { method: "POST", body: ' '.repeat(16 * 1024 + 1) })), { status: 413 });
  await assert.rejects(readAuthBody(new Request("http://localhost", { method: "POST", headers: { "content-length": "20000" }, body: '{}' })), { status: 413 });
});

test("auth limits UTF-8 bytes rather than JavaScript character counts", async () => {
  const body = JSON.stringify({ name: "\u20ac".repeat(6000) });
  assert(body.length < 16 * 1024);
  await assert.rejects(readAuthBody(new Request("http://localhost", { method: "POST", body })), { status: 413 });
});

test("oversized streaming bodies are cancelled before the rest is read", async () => {
  let cancelled = false;
  let reads = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { reads++; controller.enqueue(new Uint8Array(8192)); },
    cancel() { cancelled = true; },
  });
  const init = { method: "POST", body, duplex: "half" } as RequestInit;
  await assert.rejects(readAuthBody(new Request("http://localhost", init)), { status: 413 });
  assert(cancelled);
  assert(reads <= 4);
});
