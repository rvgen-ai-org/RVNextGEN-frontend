"use client";

import { useEffect, type RefObject } from "react";
import { gyroTarget, pointerGyroTarget, stepGyroPoint } from "./player-tilt";

/** Only the active art layers move; no inherited CSS variables invalidate the page. */
export function useArtworkMotion(rootRef: RefObject<HTMLElement | null>, suspended: boolean, onSensor: () => void) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || suspended) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let lastTime = 0;
    let sensorActive = false;
    let listening = false;
    const current = { x: 0, y: 0 };
    let targetX = 0, targetY = 0;
    let bounds = root.getBoundingClientRect();
    let layers: { node: HTMLElement; x: number; y: number }[] = [];
    const allowed = () => !preference.matches && !document.hidden;
    const apply = () => {
      for (const layer of layers) {
        const translate = `${(current.x * layer.x).toFixed(2)}px ${(current.y * layer.y).toFixed(2)}px`;
        if (layer.node.style.translate !== translate) layer.node.style.translate = translate;
      }
    };
    const render = (time: number) => {
      frame = 0;
      if (!allowed()) return;
      const settled = stepGyroPoint(current, { x: targetX, y: targetY }, lastTime ? time - lastTime : 16);
      lastTime = time;
      if (settled) lastTime = 0;
      apply();
      if (!settled) frame = requestAnimationFrame(render);
    };
    const schedule = () => { if (!frame && allowed()) frame = requestAnimationFrame(render); };
    const refreshLayers = () => {
      for (const layer of layers) if (!layer.node.hasAttribute("data-gyro-layer")) layer.node.style.translate = "";
      layers = Array.from(root.querySelectorAll<HTMLElement>("[data-gyro-layer]")).map(node => ({ node, x: Number(node.dataset.gyroX) || 0, y: Number(node.dataset.gyroY) || 0 }));
      schedule();
    };
    const move = (nextX: number, nextY: number) => {
      if (targetX === nextX && targetY === nextY) return;
      targetX = nextX; targetY = nextY; schedule();
    };
    const orientation = (event: DeviceOrientationEvent) => {
      if (event.gamma == null || event.beta == null || !Number.isFinite(event.gamma) || !Number.isFinite(event.beta)) return;
      if (!sensorActive) { sensorActive = true; onSensor(); }
      const target = gyroTarget(event.gamma, event.beta - 45);
      move(target.x, target.y);
    };
    const pointer = (event: PointerEvent) => {
      if (sensorActive || event.pointerType !== "mouse" || (event.target as Element).closest('dialog, [role="dialog"], button, a, input, select')) return;
      const target = pointerGyroTarget((event.clientX - bounds.left) / Math.max(1, bounds.width) * 2 - 1, (event.clientY - bounds.top) / Math.max(1, bounds.height) * 2 - 1);
      move(target.x, target.y);
    };
    const leave = () => move(0, 0);
    const sync = () => {
      const active = allowed();
      if (listening !== active) {
        listening = active;
        if (active) window.addEventListener("deviceorientation", orientation);
        else window.removeEventListener("deviceorientation", orientation);
      }
      if (!active) {
        cancelAnimationFrame(frame); frame = 0; lastTime = 0;
        current.x = current.y = targetX = targetY = 0; apply();
      }
    };
    const resize = new ResizeObserver(() => { bounds = root.getBoundingClientRect(); });
    resize.observe(root);
    const observer = new MutationObserver(refreshLayers);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-gyro-layer", "data-gyro-x", "data-gyro-y"] });
    root.addEventListener("pointermove", pointer);
    root.addEventListener("pointerleave", leave);
    preference.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    refreshLayers(); sync();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("deviceorientation", orientation);
      root.removeEventListener("pointermove", pointer);
      root.removeEventListener("pointerleave", leave);
      preference.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      resize.disconnect(); observer.disconnect();
      for (const layer of layers) layer.node.style.translate = "";
    };
  }, [rootRef, suspended, onSensor]);
}
