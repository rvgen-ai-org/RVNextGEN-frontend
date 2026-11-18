"use client";

import { useEffect, useRef, type RefObject } from "react";
import { ambientFrameBounds, paintAmbientFallback, paintAmbientPalette, type AmbientRenderMode, type AmbientPalette } from "@/lib/ambient-light";
import { loadYouTubeAmbientFrame } from "@/lib/youtube-thumbnail";
import styles from "./PlayerAmbient.module.css";

/** Cinematic palettes work with any provider; live mode can use the existing decoder. */
export default function PlayerAmbient({ videoRef, motionRef, enabled, playing, sourceKey, strength = 35, onUnavailable, mode = "cinematic", palette = "auto", paletteKey = sourceKey, youtubeId }: {
  videoRef: RefObject<HTMLVideoElement | null>; motionRef: RefObject<HTMLDivElement | null>;
  enabled: boolean; playing: boolean; sourceKey: string; strength?: number;
  onUnavailable?: () => void;
  mode?: AmbientRenderMode; palette?: AmbientPalette; paletteKey?: string; youtubeId?: string;
}) {
  const first = useRef<HTMLCanvasElement>(null);
  const second = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const unavailable = useRef(onUnavailable);
  useEffect(() => { unavailable.current = onUnavailable; });

  useEffect(() => {
    for (const canvas of [first.current, second.current]) {
      if (canvas) { canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height); canvas.style.opacity = "0"; }
    }
    if (root.current) root.current.dataset.ambientState = "waiting";
  }, [sourceKey, mode, palette, paletteKey, youtubeId]);

  useEffect(() => {
    if (mode !== "thumbnail" || !enabled || !youtubeId) return;
    let live = true;
    const ctx = first.current?.getContext("2d");
    if (!ctx) return;
    paintAmbientFallback(ctx);
    first.current!.style.opacity = "1";
    second.current!.style.opacity = "0";
    if (root.current) root.current.dataset.ambientSource = "neutral";
    void loadYouTubeAmbientFrame(youtubeId).then(frame => {
      if (!live || !frame) return;
      const sample = document.createElement("canvas");
      sample.width = frame.width; sample.height = frame.height;
      const read = sample.getContext("2d");
      const soft = document.createElement("canvas");
      soft.width = 12; soft.height = 7;
      const soften = soft.getContext("2d");
      if (!read || !soften) return;
      read.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
      const bounds = ambientFrameBounds(frame.pixels, frame.width, frame.height);
      soften.drawImage(sample, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, 12, 7);
      ctx.clearRect(0, 0, 192, 108);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.filter = "blur(12px) saturate(0.85)";
      ctx.drawImage(soft, -24, -14, 240, 136);
      if (root.current) root.current.dataset.ambientSource = "thumbnail";
    });
    return () => { live = false; };
  }, [enabled, mode, sourceKey, youtubeId, palette, paletteKey]);

  useEffect(() => {
    const container = root.current;
    if (!container || mode === "live" || !enabled) return;
    if (mode === "cinematic") [first.current, second.current].forEach((canvas, index) => {
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      paintAmbientPalette(ctx, palette, paletteKey, index);
      canvas.style.opacity = index ? ".55" : "1";
    });
    let inView = true, pip = document.pictureInPictureElement === videoRef.current && Boolean(videoRef.current), nativeFullscreen = false;
    const update = () => {
      const fullscreen = document.fullscreenElement;
      const outsideFullscreen = Boolean(fullscreen && !fullscreen.contains(container));
      const visible = !document.hidden && inView && !pip && !nativeFullscreen && !outsideFullscreen;
      container.dataset.running = String(playing && visible);
      container.dataset.ambientState = visible ? mode : "suspended";
      container.style.visibility = visible ? "" : "hidden";
    };
    const enterPip = () => { pip = true; update(); };
    const leavePip = () => { pip = false; update(); };
    const beginFullscreen = () => { nativeFullscreen = true; update(); };
    const endFullscreen = () => { nativeFullscreen = false; update(); };
    const observer = new IntersectionObserver(entries => { inView = entries[0]?.isIntersecting ?? true; update(); });
    observer.observe(container);
    document.addEventListener("visibilitychange", update);
    document.addEventListener("fullscreenchange", update);
    document.addEventListener("enterpictureinpicture", enterPip, true);
    document.addEventListener("leavepictureinpicture", leavePip, true);
    document.addEventListener("webkitbeginfullscreen", beginFullscreen, true);
    document.addEventListener("webkitendfullscreen", endFullscreen, true);
    update();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      document.removeEventListener("fullscreenchange", update);
      document.removeEventListener("enterpictureinpicture", enterPip, true);
      document.removeEventListener("leavepictureinpicture", leavePip, true);
      document.removeEventListener("webkitbeginfullscreen", beginFullscreen, true);
      document.removeEventListener("webkitendfullscreen", endFullscreen, true);
      container.dataset.running = "false";
      container.style.visibility = "";
    };
  }, [enabled, playing, mode, sourceKey, palette, paletteKey, videoRef]);

  useEffect(() => {
    const container = root.current;
    if (!container || mode !== "live" || !enabled || !playing) return;
    const canvases = [first.current!, second.current!];
    const contexts = canvases.map(canvas => canvas.getContext("2d"));
    const sample = document.createElement("canvas");
    const soft = document.createElement("canvas");
    sample.width = 32; sample.height = 18;
    soft.width = 12; soft.height = 7;
    const read = sample.getContext("2d", { willReadFrequently: true });
    const soften = soft.getContext("2d");
    if (!read || !soften || contexts.some(ctx => !ctx)) return;
    const mobile = matchMedia("(pointer: coarse)").matches;
    let interval = mobile ? 250 : 167;
    let timer = 0, callback = 0, lastTime = -1, layer = 0, slowSamples = 0;
    let pip = Boolean(document.pictureInPictureElement && document.pictureInPictureElement === videoRef.current);
    let nativeFullscreen = false, inView = true, blocked = false, disposed = false;
    let observed: HTMLVideoElement | null = null;
    const stop = () => {
      clearTimeout(timer);
      if (callback && observed?.cancelVideoFrameCallback) observed.cancelVideoFrameCallback(callback);
      callback = 0;
    };
    const canSample = () => !disposed && !blocked && !document.hidden && !pip && !nativeFullscreen && inView;
    const schedule = () => {
      stop();
      if (!canSample()) return;
      timer = window.setTimeout(() => {
        const video = videoRef.current;
        if (video?.requestVideoFrameCallback && !video.paused) {
          observed = video;
          callback = video.requestVideoFrameCallback(() => { callback = 0; draw(); });
        } else draw();
      }, interval);
    };
    const draw = () => {
      if (!canSample()) return;
      const video = videoRef.current;
      if (!video) { container.dataset.ambientState = "unavailable"; schedule(); return; }
      if (video.paused || video.seeking || video.readyState < 2 || !video.videoWidth || video.currentTime === lastTime) { schedule(); return; }
      const start = performance.now();
      try {
        read.drawImage(video, 0, 0, 32, 18);
        // Tiny readback both detects blocked sources and excludes letterbox borders.
        const bounds = ambientFrameBounds(read.getImageData(0, 0, 32, 18).data, 32, 18);
        soften.drawImage(sample, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, 12, 7);
        const ctx = contexts[layer]!;
        ctx.clearRect(0, 0, 192, 108);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        // Blur the tiny canvas at sampling frequency, never a full-screen CSS filter.
        ctx.filter = "blur(9px)";
        ctx.drawImage(soft, -24, -14, 240, 136);
        canvases[layer].style.opacity = "1";
        canvases[1 - layer].style.opacity = "0";
        layer = 1 - layer;
        container.dataset.ambientState = "sampling";
        lastTime = video.currentTime;
        const elapsed = performance.now() - start;
        container.dataset.sampleMs = elapsed.toFixed(2);
        // Sustained slow samples select the low-power rate; no React renders per frame.
        slowSamples = elapsed > 4 ? slowSamples + 1 : Math.max(0, slowSamples - 1);
        if (slowSamples >= 3) interval = 500;
      } catch {
        blocked = true;
        container.dataset.ambientState = "blocked";
        canvases.forEach(canvas => { canvas.style.opacity = "0"; });
        unavailable.current?.();
      }
      schedule();
    };
    const visibility = () => { if (document.hidden) stop(); else schedule(); };
    const enterPip = () => { pip = true; stop(); container.style.visibility = "hidden"; };
    const leavePip = () => { pip = false; container.style.visibility = ""; schedule(); };
    const beginFullscreen = () => { nativeFullscreen = true; stop(); container.style.visibility = "hidden"; };
    const endFullscreen = () => { nativeFullscreen = false; container.style.visibility = ""; schedule(); };
    const fullscreen = () => {
      const element = document.fullscreenElement;
      nativeFullscreen = Boolean(element && videoRef.current && element.contains(videoRef.current) && !element.contains(container));
      container.style.visibility = nativeFullscreen || pip ? "hidden" : "";
      if (nativeFullscreen) stop(); else schedule();
    };
    const visibilityObserver = new IntersectionObserver(entries => { inView = entries[0]?.isIntersecting ?? true; if (inView) schedule(); else stop(); });
    visibilityObserver.observe(container);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("enterpictureinpicture", enterPip, true);
    document.addEventListener("leavepictureinpicture", leavePip, true);
    document.addEventListener("webkitbeginfullscreen", beginFullscreen, true);
    document.addEventListener("webkitendfullscreen", endFullscreen, true);
    document.addEventListener("fullscreenchange", fullscreen);
    fullscreen();
    return () => {
      disposed = true; stop(); visibilityObserver.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("enterpictureinpicture", enterPip, true);
      document.removeEventListener("leavepictureinpicture", leavePip, true);
      document.removeEventListener("webkitbeginfullscreen", beginFullscreen, true);
      document.removeEventListener("webkitendfullscreen", endFullscreen, true);
      document.removeEventListener("fullscreenchange", fullscreen);
      container.style.visibility = "";
    };
  }, [enabled, playing, sourceKey, videoRef, mode]);

  return <div ref={root} aria-hidden="true" data-ambient-mode={mode} className={`${styles.ambient} ${mode !== "live" ? styles.cinematic : ""} ${mode === "thumbnail" ? styles.thumbnail : ""}`} style={{ opacity: enabled ? Math.min(60, Math.max(0, strength)) / 100 * (playing ? 1 : .35) : 0 }}>
    <div ref={motionRef} className={styles.motion}>
      <canvas ref={first} width={192} height={108} />
      <canvas ref={second} width={192} height={108} />
    </div>
  </div>;
}
