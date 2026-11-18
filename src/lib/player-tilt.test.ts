import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error Node's test runner reads the TypeScript source directly.
import { angleDelta, fitVideoScale, gyroTarget, landscapeSensorTilt, orientTilt, pointerGyroTarget, pointerTilt, relativeDeviceRotation, smoothingFactor, stepGyroPoint, videoMotionProfile, videoMotionRange } from "./player-tilt.ts";

test("artwork and video use the same linear gyro response, noise filter and limits", () => {
  assert.deepEqual(gyroTarget(0.01, -0.01), { x: 0, y: 0 });
  assert.deepEqual(gyroTarget(15, 20), { x: 12, y: 9 });
  assert.deepEqual(gyroTarget(1000, -1000), { x: 24, y: -18 });
  assert.ok(gyroTarget(0.5, 0).x > 0, "Small intentional movement should not feel stuck");
  assert.deepEqual(gyroTarget(NaN, Infinity), { x: 0, y: 0 });
});

test("crossing the sensor's angle boundary does not reverse the view", () => {
  assert.equal(angleDelta(-179, 179), 2);
  assert.equal(angleDelta(179, -179), -2);
});

test("landscape and simulated landscape map device input into viewer axes", () => {
  const landscape = orientTilt(0, 15, 90, false);
  assert.equal(landscape.x, .5);
  assert.ok(Math.abs(landscape.y) < 0.0001);
  const fallback = orientTilt(15, 0, 0, true);
  assert.equal(fallback.y, 6.8 / 18);
  assert.ok(Math.abs(fallback.x) < 0.0001);
  assert.deepEqual(orientTilt(30, 40, 0, false), { x: 1, y: 1 });
});

test("smoothing has the same response at 30 and 60fps without overshooting after a stall", () => {
  const sixty = 1 - Math.pow(1 - smoothingFactor(1000 / 60), 6);
  const thirty = 1 - Math.pow(1 - smoothingFactor(1000 / 30), 3);
  assert.ok(Math.abs(sixty - thirty) < 0.000001);
  assert.ok(smoothingFactor(2000) > 0 && smoothingFactor(2000) < 1);
  assert.equal(smoothingFactor(0), 0);
  assert.ok(sixty > .65 && sixty < .75, "Match the artwork's 85ms follow response");
});

test("pointer motion matches the artwork and rotates with the viewer", () => {
  assert.deepEqual(pointerGyroTarget(1, -1), { x: 18, y: -14 });
  assert.deepEqual(pointerGyroTarget(2, -2), { x: 18, y: -14 });
  assert.deepEqual(pointerTilt(1, 0, false), { x: .75, y: 0 });
  assert.deepEqual(pointerTilt(1, 0, true), { x: 0, y: -14 / 18 });
});

test("shared interpolation approaches the target without overshoot and stops when settled", () => {
  const current = { x: 0, y: 0 };
  const target = { x: 24, y: -18 };
  let settled = false;
  for (let i = 0; i < 120; i++) {
    settled = stepGyroPoint(current, target, 1000 / 60);
    assert.ok(current.x >= 0 && current.x <= 24);
    assert.ok(current.y <= 0 && current.y >= -18);
  }
  assert.ok(settled);
  assert.deepEqual(current, target);
});

test("video movement stays inside a responsive margin and never exceeds the artwork budget", () => {
  assert.deepEqual(videoMotionRange(1920, 1080), { x: 24, y: 18 });
  const phone = videoMotionRange(390, 844);
  assert.equal(phone.x, 390 * .018);
  assert.equal(phone.y, 844 * .018);
  assert.deepEqual(videoMotionRange(0, -1), { x: 0, y: 0 });
});

test("three-axis relative orientation follows local pitch, yaw and roll", () => {
  const origin = { alpha: 0, beta: 0, gamma: 0 };
  const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < .00001, `${actual} != ${expected}`);
  close(relativeDeviceRotation({ alpha: 20, beta: 0, gamma: 0 }, origin).roll, 20);
  close(relativeDeviceRotation({ alpha: 0, beta: 25, gamma: 0 }, origin).pitch, 25);
  close(relativeDeviceRotation({ alpha: 0, beta: 0, gamma: -35 }, origin).yaw, -35);
  const wrapped = relativeDeviceRotation({ alpha: 1, beta: 0, gamma: 0 }, { alpha: 359, beta: 0, gamma: 0 });
  close(wrapped.roll, 2);
});

test("equivalent Euler readings at a vertical hold do not make the view jump", () => {
  const neutral = { alpha: 0, beta: 90, gamma: 0 };
  const alias = relativeDeviceRotation({ alpha: 30, beta: 90, gamma: -30 }, neutral);
  assert.ok(Math.abs(alias.pitch) + Math.abs(alias.yaw) + Math.abs(alias.roll) < .00001);
  const heading = relativeDeviceRotation({ alpha: 2, beta: 90, gamma: 0 }, neutral);
  assert.ok(Math.abs(heading.yaw - 2) < .00001);
});

test("landscape uses a wider physical range and falls back when heading is unavailable", () => {
  const origin = { alpha: null, beta: 0, gamma: 0 };
  const small = landscapeSensorTilt({ alpha: null, beta: 0, gamma: 15 }, origin, 0, false);
  const larger = landscapeSensorTilt({ alpha: null, beta: 0, gamma: 30 }, origin, 0, false);
  assert.ok(small.x < larger.x && larger.x < 1);
  assert.deepEqual(landscapeSensorTilt({ alpha: null, beta: 45, gamma: 45 }, origin, 0, false), { x: 1, y: 1, roll: 0 });
  const bank = landscapeSensorTilt({ alpha: 60, beta: 0, gamma: 0 }, { alpha: 0, beta: 0, gamma: 0 }, 90, false);
  assert.ok(Math.abs(bank.roll - 1) < .00001);
});

test("landscape strengthens perspective without changing the portrait profile", () => {
  const portrait = videoMotionProfile(390, 844, false);
  const landscape = videoMotionProfile(844, 390, true);
  assert.equal(portrait.yaw, 1.5);
  assert.equal(portrait.roll, 0);
  assert.equal(landscape.yaw, 14);
  assert.equal(landscape.pitch, 12);
  assert.equal(landscape.roll, 8);
  assert.ok(landscape.range.x > videoMotionRange(844, 390).x);
});

test("perspective fitting reserves the full image instead of zooming it", () => {
  const p = videoMotionProfile(844, 390, true);
  assert.equal(fitVideoScale(844, 390, 0, 0, 0, p.perspective, 0, 0, .94), .94);
  const tilted = fitVideoScale(844, 390, -p.pitch, p.yaw, p.roll, p.perspective, p.range.x, p.range.y, .94);
  assert.ok(tilted > .4 && tilted < .94);
  assert.equal(fitVideoScale(0, 0, 12, 14, 8, 1, 0, 0, 1), 1);
});
