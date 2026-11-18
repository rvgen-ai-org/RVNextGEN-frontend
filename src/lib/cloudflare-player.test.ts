import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error Node's test runner reads the TypeScript source directly.
import { getStreamPlayer, observeStreamPlayback } from "./cloudflare-player.ts";

test("Cloudflare playback observers share the bridge and remove listeners on close", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const listeners = new Map<string, Set<() => void>>();
  let bridges = 0;
  const player = {
    currentTime: 0, duration: 120, paused: true,
    addEventListener(event: string, callback: () => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(callback);
    },
    removeEventListener(event: string, callback: () => void) { listeners.get(event)?.delete(callback); },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { Stream: () => { bridges++; return player; } } });
  try {
    const iframe = {} as HTMLIFrameElement;
    const changes: boolean[] = [];
    const stop = observeStreamPlayback(iframe, playing => changes.push(playing));
    await getStreamPlayer(iframe);
    assert.equal(bridges, 1);
    const emit = (event: string) => listeners.get(event)?.forEach(callback => callback());
    emit("playing"); emit("waiting"); emit("playing"); emit("pause"); emit("ended");
    assert.deepEqual(changes, [true, false, true, false, false]);
    player.paused = false;
    player.currentTime = 1;
    emit("timeupdate");
    assert.equal(changes.at(-1), true, "Recover playback that started before SDK attachment");
    emit("seeking");
    player.currentTime = 60;
    emit("timeupdate");
    assert.equal(changes.at(-1), false, "A seek must not count as advancing playback");
    emit("seeked");
    player.currentTime = 61;
    emit("timeupdate");
    assert.equal(changes.at(-1), true);
    const beforeCleanup = changes.length;
    stop();
    assert.ok([...listeners.values()].every(callbacks => callbacks.size === 0));
    emit("playing");
    assert.equal(changes.length, beforeCleanup);
    const cancel = observeStreamPlayback(iframe, () => assert.fail("Cancelled observer received an event"));
    cancel();
    await Promise.resolve();
    assert.ok([...listeners.values()].every(callbacks => callbacks.size === 0));
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
