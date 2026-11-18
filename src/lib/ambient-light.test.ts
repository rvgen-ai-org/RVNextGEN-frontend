import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error Node's test runner reads the TypeScript source directly.
import { ambientFrameBounds } from "./ambient-light.ts";

test("letterboxing is removed from the ambient copy while spatial colors remain", () => {
  const pixels = new Uint8ClampedArray(32 * 18 * 4);
  for (let y = 2; y < 16; y++) for (let x = 0; x < 32; x++) {
    pixels[(y * 32 + x) * 4 + (x < 16 ? 0 : 2)] = 180;
    pixels[(y * 32 + x) * 4 + 3] = 255;
  }
  assert.deepEqual(ambientFrameBounds(pixels, 32, 18), { x: 0, y: 2, width: 32, height: 14 });
});

test("dark scenes and isolated bright details do not trigger excessive cropping", () => {
  const pixels = new Uint8ClampedArray(32 * 18 * 4);
  const full = { x: 0, y: 0, width: 32, height: 18 };
  assert.deepEqual(ambientFrameBounds(pixels, 32, 18), full);
  pixels[(9 * 32 + 16) * 4] = 255;
  assert.deepEqual(ambientFrameBounds(pixels, 32, 18), full);
});
