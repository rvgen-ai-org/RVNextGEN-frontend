"use client";

import PlayerSettingsSelect from "./PlayerSettingsSelect";

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { angleDelta, fitVideoScale, landscapeSensorTilt, orientTilt, pointerTilt, smoothingFactor, stepGyroPoint, videoMotionProfile, type DevicePose, type VideoTilt } from "@/lib/player-tilt";
import { ambientPalettes, resolveAmbientMode, type AmbientMode, type AmbientPalette } from "@/lib/ambient-light";

type OrientationPermission = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<PermissionState> };
type Input = "pointer" | "sensor";
const reducedQuery = "(prefers-reduced-motion: reduce)";
const subscribeReduced = (listener: () => void) => {
  const query = window.matchMedia(reducedQuery);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};
const readReduced = () => window.matchMedia(reducedQuery).matches;
const serverReduced = () => false;
const subscribeLandscape = (listener: () => void) => {
  const query = window.matchMedia("(orientation: landscape)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};
const readLandscape = () => window.matchMedia("(orientation: landscape)").matches;
const tiltAvailable = process.env.NEXT_PUBLIC_PLAYER_TILT_ENABLED !== "false";
const liveAmbientAvailable = process.env.NEXT_PUBLIC_LIVE_AMBIENT_ENABLED === "true";

export function usePlayerTilt({ viewportRef, surfaceRef, ambientRef, ambientSupported = false, thumbnailSupported = false, playing, suspended = false, rotated = false, onMotionUnavailable }: {
  viewportRef: RefObject<HTMLDivElement | null>; surfaceRef: RefObject<HTMLDivElement | null>;
  ambientRef?: RefObject<HTMLDivElement | null>; ambientSupported?: boolean; thumbnailSupported?: boolean;
  playing: boolean; suspended?: boolean; rotated?: boolean;
  onMotionUnavailable?: () => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [input, setInput] = useState<Input>("pointer");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [sensitivity, setSensitivity] = useState<"low" | "normal">("normal");
  const [ambientEnabled, setAmbientEnabled] = useState(true);
  const [ambientStrength, setAmbientStrength] = useState(35);
  const [ambientMode, setAmbientMode] = useState<AmbientMode>("auto");
  const [ambientPalette, setAmbientPalette] = useState<AmbientPalette>("auto");
  const motionUnavailable = useRef(onMotionUnavailable);
  useEffect(() => { motionUnavailable.current = onMotionUnavailable; });
  const reduced = useSyncExternalStore(subscribeReduced, readReduced, serverReduced);
  const landscapeScreen = useSyncExternalStore(subscribeLandscape, readLandscape, serverReduced);
  const landscape = rotated || landscapeScreen;
  const baseline = useRef<DevicePose | null>(null);
  const current = useRef({ x: 0, y: 0, roll: 0, scale: 1 });
  const latestTarget = useRef<VideoTilt>({ x: 0, y: 0, roll: 0 });
  const viewerRotation = useRef({ rotated, landscape });
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);

  const toggle = async () => {
    if (!tiltAvailable) return;
    const attempt = ++request.current;
    if (enabled || pending) { setEnabled(false); setPending(false); setMessage(""); return; }
    if (reduced) { setMessage("Tilt is off because Reduce Motion is enabled on your device."); return; }
    latestTarget.current = { x: 0, y: 0, roll: 0 };
    if (!window.matchMedia("(pointer: coarse)").matches) {
      setInput("pointer"); setEnabled(true); setMessage(""); return;
    }
    if (!window.isSecureContext) { setMessage("Tilt needs a secure HTTPS connection on your phone or tablet."); return; }
    if (typeof DeviceOrientationEvent === "undefined") { setMessage("Tilt controls aren’t available on this device."); return; }
    setPending(true);
    try {
      const permission = (DeviceOrientationEvent as OrientationPermission).requestPermission;
      if (permission && await permission.call(DeviceOrientationEvent) !== "granted") {
        if (attempt === request.current) setMessage("Motion access wasn’t allowed. You can keep watching normally.");
        return;
      }
      if (attempt !== request.current) return;
      baseline.current = null;
      latestTarget.current = { x: 0, y: 0, roll: 0 };
      setInput("sensor"); setEnabled(true); setMessage("");
    } catch {
      if (attempt === request.current) setMessage("Motion access is unavailable. You can keep watching normally.");
    } finally { if (attempt === request.current) setPending(false); }
  };

  const recenter = () => { baseline.current = null; latestTarget.current = { x: 0, y: 0, roll: 0 }; setMessage(""); };

  useEffect(() => {
    const viewport = viewportRef.current;
    const surface = surfaceRef.current;
    if (!viewport || !surface) return;
    let frame = 0;
    let lastFrame = 0;
    let hidden = document.hidden;
    let providerFullscreen = false;
    let pictureInPicture = false;
    let interacting = false;
    let target = latestTarget.current;
    let sensorTimeout: number | undefined;
    let listening = false;
    let received = false;
    let bounds: DOMRect | undefined;
    let width = surface.clientWidth;
    let height = surface.clientHeight;
    let profile = videoMotionProfile(width, height, landscape);
    const allowed = () => enabled && !reduced && playing && !suspended && !hidden && !providerFullscreen && !pictureInPicture;
    const animate = (now: number) => {
      frame = 0;
      const elapsed = lastFrame ? now - lastFrame : 16;
      const active = allowed();
      const gain = sensitivity === "low" ? 0.5 : 1;
      const x = active && !interacting ? target.x * gain : 0;
      const y = active && !interacting ? target.y * gain : 0;
      const roll = active && !interacting ? target.roll * gain : 0;
      const scale = active ? 0.94 : 1;
      const amount = smoothingFactor(elapsed);
      lastFrame = now;
      const value = current.current;
      const pointSettled = stepGyroPoint(value, { x, y }, elapsed, 0.0005);
      value.roll += (roll - value.roll) * amount;
      value.scale += (scale - value.scale) * amount;
      const settled = pointSettled && Math.abs(roll - value.roll) < .0005 && Math.abs(scale - value.scale) < 0.0005;
      if (settled) { value.x = x; value.y = y; value.roll = roll; value.scale = scale; }
      // Leave a margin instead of enlarging/cropping the recorded picture.
      const neutral = value.scale === 1 && !value.x && !value.y && !value.roll;
      const tx = value.x * profile.range.x, ty = value.y * profile.range.y;
      const pitch = -value.y * profile.pitch, yaw = value.x * profile.yaw, bank = value.roll * profile.roll;
      const fitted = fitVideoScale(width, height, pitch, yaw, bank, profile.perspective, tx, ty, value.scale);
      const translate = neutral ? "" : `${tx.toFixed(3)}px ${ty.toFixed(3)}px`;
      const transform = neutral ? "" : `perspective(${profile.perspective}px) rotateX(${pitch}deg) rotateY(${yaw}deg) rotateZ(${bank}deg) scale(${fitted})`;
      if (surface.style.translate !== translate) surface.style.translate = translate;
      if (surface.style.transform !== transform) surface.style.transform = transform;
      const ambient = ambientRef?.current;
      if (ambient) ambient.style.translate = neutral ? "" : `${(-value.x * 6).toFixed(2)}px ${(-value.y * 6).toFixed(2)}px`;
      // Keep the video on one compositing layer during active use. Releasing it
      // between sensor samples can repeatedly rebuild an expensive iframe layer.
      const hint = active || !settled ? "transform, translate" : "";
      if (surface.style.willChange !== hint) surface.style.willChange = hint;
      if (!settled) frame = requestAnimationFrame(animate);
    };
    const schedule = () => { if (!frame) { lastFrame = 0; frame = requestAnimationFrame(animate); } };
    const reset = () => { target = latestTarget.current = { x: 0, y: 0, roll: 0 }; baseline.current = null; schedule(); };
    const onSensor = (event: DeviceOrientationEvent) => {
      if (event.beta === null || event.gamma === null || !Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
      received = true;
      window.clearTimeout(sensorTimeout);
      const pose: DevicePose = { alpha: typeof event.alpha === "number" && Number.isFinite(event.alpha) ? event.alpha : null, beta: event.beta, gamma: event.gamma };
      const origin = baseline.current ??= pose;
      const screenAngle = screen.orientation?.angle ?? (window as Window & { orientation?: number }).orientation ?? 0;
      const next = landscape ? landscapeSensorTilt(pose, origin, screenAngle, rotated) : { ...orientTilt(angleDelta(event.gamma, origin.gamma), angleDelta(event.beta, origin.beta), screenAngle, rotated), roll: 0 };
      if (next.x === target.x && next.y === target.y && next.roll === target.roll) return;
      target = latestTarget.current = next;
      schedule();
    };
    const syncSensors = () => {
      const shouldListen = allowed() && input === "sensor";
      if (shouldListen === listening) return;
      listening = shouldListen;
      window.clearTimeout(sensorTimeout);
      if (listening) {
        received = false;
        window.addEventListener("deviceorientation", onSensor);
        sensorTimeout = window.setTimeout(() => {
          if (!received) { setEnabled(false); setMessage("No motion readings received. You can keep watching normally."); motionUnavailable.current?.(); }
        }, 5000);
      } else window.removeEventListener("deviceorientation", onSensor);
    };
    const onVisibility = () => { hidden = document.hidden; reset(); syncSensors(); };
    const onFullscreen = (event?: Event) => {
      const fullscreen = document.fullscreenElement ?? (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement;
      providerFullscreen = Boolean(fullscreen && fullscreen !== document.documentElement && fullscreen !== viewport && !fullscreen.contains(viewport));
      // Effect restarts (pause/buffering/settings) must preserve calibration.
      // Only a real display-mode change needs a new neutral position.
      if (event) reset(); else schedule();
      syncSensors();
    };
    const onPip = () => { pictureInPicture = true; reset(); syncSensors(); };
    const onPipExit = () => { pictureInPicture = false; reset(); syncSensors(); };
    const onPointer = (event: PointerEvent) => {
      if (input !== "pointer" || event.pointerType !== "mouse" || !allowed()) return;
      interacting = Boolean((event.target as Element).closest("button, input, select, [role=slider], [data-tilt-controls]"));
      bounds ??= viewport.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width) * 2 - 1));
      const y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height) * 2 - 1));
      target = latestTarget.current = { ...pointerTilt(x, y, rotated), roll: 0 };
      schedule();
    };
    // Iframe events do not bubble. Reset at its boundary without covering provider controls.
    const onLeave = () => { target = latestTarget.current = { x: 0, y: 0, roll: 0 }; interacting = false; schedule(); };
    const onOut = (event: PointerEvent) => { if ((event.relatedTarget as Element | null)?.tagName === "IFRAME") onLeave(); };
    const onResize = () => { bounds = undefined; width = surface.clientWidth; height = surface.clientHeight; profile = videoMotionProfile(width, height, landscape); reset(); };
    const resize = new ResizeObserver(() => {
      // The initial observer notification must not discard the first sensor samples.
      if (surface.clientWidth !== width || surface.clientHeight !== height) onResize();
    });
    resize.observe(viewport);
    resize.observe(surface);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("webkitfullscreenchange", onFullscreen);
    document.addEventListener("enterpictureinpicture", onPip, true);
    document.addEventListener("leavepictureinpicture", onPipExit, true);
    window.addEventListener("orientationchange", onResize);
    screen.orientation?.addEventListener("change", onResize);
    viewport.addEventListener("pointermove", onPointer);
    viewport.addEventListener("pointerleave", onLeave);
    viewport.addEventListener("pointerout", onOut);
    if (reduced) { current.current = { x: 0, y: 0, roll: 0, scale: 1 }; surface.style.transform = ""; surface.style.translate = ""; }
    if (viewerRotation.current.rotated !== rotated || viewerRotation.current.landscape !== landscape) { viewerRotation.current = { rotated, landscape }; reset(); }
    onFullscreen();
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(sensorTimeout);
      window.removeEventListener("deviceorientation", onSensor);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("webkitfullscreenchange", onFullscreen);
      document.removeEventListener("enterpictureinpicture", onPip, true);
      document.removeEventListener("leavepictureinpicture", onPipExit, true);
      window.removeEventListener("orientationchange", onResize);
      screen.orientation?.removeEventListener("change", onResize);
      viewport.removeEventListener("pointermove", onPointer);
      viewport.removeEventListener("pointerleave", onLeave);
      viewport.removeEventListener("pointerout", onOut);
      resize.disconnect();
    };
  }, [enabled, input, playing, suspended, rotated, landscape, sensitivity, reduced, viewportRef, surfaceRef, ambientRef]);

  const liveSupported = ambientSupported && liveAmbientAvailable;
  const effectiveAmbientMode = resolveAmbientMode(ambientMode, thumbnailSupported, liveSupported && !reduced);
  return { available: tiltAvailable, enabled: enabled && !reduced, pending, message, reduced, input, sensitivity, setSensitivity, toggle, recenter, landscape, ambientSupported: liveSupported, thumbnailSupported, ambientEnabled, setAmbientEnabled, ambientStrength, setAmbientStrength, ambientMode, effectiveAmbientMode, setAmbientMode, ambientPalette, setAmbientPalette };
}

export type PlayerTiltState = ReturnType<typeof usePlayerTilt>;

export function PlayerTiltSettings({ tilt }: { tilt: PlayerTiltState }) {
  if (!tilt.available) return null;
  return <div data-tilt-settings className="px-3 pb-3 text-sm text-white">
      <p className="mt-2 text-xs leading-relaxed text-white/70">Gently move the full picture by tilting your device, or moving your mouse around the player.</p>
      <button type="button" aria-pressed={tilt.enabled} onClick={() => void tilt.toggle()} disabled={tilt.reduced} className="mt-3 min-h-11 w-full rounded-lg bg-white/15 px-3 text-left disabled:opacity-50">{tilt.pending ? "Cancel motion request" : tilt.enabled ? "Turn off tilt" : "Enable tilt"}</button>
      {tilt.enabled && <>
        <PlayerSettingsSelect label="Tilt sensitivity" value={tilt.sensitivity} onChange={tilt.setSensitivity} options={[{ value: "low", label: "Low" }, { value: "normal", label: tilt.landscape ? "Immersive" : "Normal" }]} />
        {tilt.landscape && <p className="mt-2 text-xs leading-relaxed text-white/70">Landscape adds stronger 3D tilt and roll. Choose Low for gentler movement.</p>}
        {tilt.input === "sensor" && <button type="button" onClick={tilt.recenter} className="min-h-11 w-full rounded-lg border border-white/20 px-3 text-left">Recenter</button>}
        <p className="mt-2 text-xs text-white/60">Active while playing. {tilt.input === "pointer" ? "Embedded player controls may limit mouse tracking." : "Hold comfortably, then recenter if needed."}</p>
      </>}
      <p role="status" aria-live="polite" className="mt-2 text-xs leading-relaxed text-white/75">{tilt.reduced ? "Tilt is off while your device’s Reduce Motion setting is enabled." : tilt.message}</p>
  </div>;
}

export function PlayerAmbientSettings({ tilt }: { tilt: PlayerTiltState }) {
  const liveAvailable = tilt.ambientSupported && !tilt.reduced;
  const mode = tilt.effectiveAmbientMode;
  const selectedMode = tilt.ambientMode === "auto" ? "auto" : mode;
  return <div data-ambient-settings className="px-3 pb-3 text-sm text-white">
      <p className="mt-2 text-xs leading-relaxed text-white/70">A soft surrounding glow. Enjoy it on its own or add Tilt view for depth.</p>
      <button type="button" aria-pressed={tilt.ambientEnabled} onClick={() => tilt.setAmbientEnabled(!tilt.ambientEnabled)} className="mt-3 min-h-11 w-full rounded-lg bg-white/15 px-3 text-left">{tilt.ambientEnabled ? "Turn off ambient" : "Enable ambient"}</button>
      {tilt.ambientEnabled && <>
        {(liveAvailable || tilt.thumbnailSupported) && <PlayerSettingsSelect<AmbientMode> label="Ambient style" value={selectedMode} onChange={tilt.setAmbientMode} options={[{ value: "auto", label: "For this video" }, ...(tilt.thumbnailSupported ? [{ value: "thumbnail" as const, label: "Thumbnail colors" }] : []), { value: "cinematic", label: "Cinematic" }, ...(liveAvailable ? [{ value: "live" as const, label: "Scene colors" }] : [])]} />}
        {mode === "cinematic" && <PlayerSettingsSelect<AmbientPalette> label="Ambient palette" value={tilt.ambientPalette} onChange={tilt.setAmbientPalette} options={[{ value: "auto", label: "For this title" }, ...Object.entries(ambientPalettes).map(([key, palette]) => ({ value: key as AmbientPalette, label: palette.label }))]} />}
        <label className="mt-3 block text-xs">Strength · {tilt.ambientStrength}%<input aria-label="Ambient strength" type="range" min="10" max="60" step="5" value={tilt.ambientStrength} onChange={event => tilt.setAmbientStrength(Number(event.target.value))} className="mt-1 min-h-11 w-full accent-white" /></label>
        <p className="text-xs leading-relaxed text-white/60">{mode === "thumbnail" ? "A soft spectrum from the video’s thumbnail, rather than the playing scenes. A neutral glow is used if the thumbnail is unavailable." : mode === "cinematic" ? "Designed colors that slowly drift while playing." : "Colors sampled from the playing video."}{tilt.reduced ? " Motion stays still with Reduce Motion enabled." : ""}</p>
      </>}
  </div>;
}
