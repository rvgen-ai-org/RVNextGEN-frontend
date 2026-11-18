import { apiFetch } from "./client";
import { getStreamPlayer } from "./cloudflare-player";

export type AnalyticsType = "VIEW" | "PLAY" | "COMPLETE" | "SIGNUP" | "SUBSCRIPTION" | "GENERATION";
type Props = Record<string, string | number | boolean | null>;

/** Per-tab session id (groups a visit's events/watch heartbeats). Survives reloads within the tab. */
export function sessionId(): string {
  try {
    const existing = sessionStorage.getItem("rv_sid");
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem("rv_sid", id);
    return id;
  } catch { return crypto.randomUUID(); }
}

/** Fire-and-forget analytics event. Server enriches with device/os/browser/geo from the request. */
export function trackEvent(type: AnalyticsType, opts: { contentId?: string; properties?: Props } = {}, token?: string | null): void {
  if (!token) return;
  const referrer = typeof document !== "undefined" && document.referrer ? document.referrer : undefined;
  void apiFetch("analytics/events", { method: "POST", token, body: { type, contentId: opts.contentId, sessionId: sessionId(), referrer, properties: opts.properties } }).catch(() => {});
}

const visitsInFlight = new Set<string>();
/** One browse event per signed-in user and tab per day, so visits count toward active users. */
export function trackVisit(token: string | null, userId: string | undefined): void {
  if (!token) return;
  const key = `rv_visit_${userId ?? 'account'}_${new Date().toISOString().slice(0, 10)}`;
  try {
    if (sessionStorage.getItem(key)) return;
  } catch { /* Storage may be disabled; still record the visit. */ }
  if (visitsInFlight.has(key)) return;
  visitsInFlight.add(key);
  void apiFetch('analytics/events', { method: 'POST', token, body: { type: 'VIEW', sessionId: sessionId(), referrer: document.referrer || undefined, properties: { surface: 'browse' } } })
    .then(() => { try { sessionStorage.setItem(key, '1'); } catch { /* Storage may be disabled. */ } })
    .catch(() => {})
    .finally(() => visitsInFlight.delete(key));
}

/** Fire-and-forget watch heartbeat (START / PROGRESS / COMPLETE) with playback position + duration. */
export function watchBeacon(contentId: string, eventType: "START" | "PROGRESS" | "COMPLETE", token: string | null, opts: { progressSec?: number; durationSec?: number } = {}): void {
  if (!token) return;
  void apiFetch(`content/${contentId}/watch`, { method: "POST", token, body: { eventType, progressSec: opts.progressSec, durationSec: opts.durationSec, sessionId: sessionId() } }).catch(() => {});
}

/** Native HLS playback keeps the same watch events as the embedded player. */
type WatchToken = string | null | (() => string | null);
const watchToken = (token: WatchToken) => typeof token === "function" ? token() : token;

export function attachVideoTelemetry(video: HTMLVideoElement, contentId: string, token: WatchToken): () => void {
  let started = false;
  const snapshot = () => ({ progressSec: Math.round(video.currentTime) || 0, durationSec: Number.isFinite(video.duration) ? Math.round(video.duration) : undefined });
  const play = () => { const currentToken = watchToken(token); if (!started && currentToken) { started = true; trackEvent("PLAY", { contentId }, currentToken); watchBeacon(contentId, "START", currentToken, snapshot()); } };
  const ended = () => { if (started) watchBeacon(contentId, "COMPLETE", watchToken(token), snapshot()); };
  video.addEventListener("playing", play);
  video.addEventListener("ended", ended);
  const timer = window.setInterval(() => { if (started && !video.paused && !video.seeking && !document.hidden && video.readyState >= 3) watchBeacon(contentId, "PROGRESS", watchToken(token), snapshot()); }, 15000);
  return () => { clearInterval(timer); video.removeEventListener("playing", play); video.removeEventListener("ended", ended); };
}

/**
 * Attach watch telemetry to a Cloudflare Stream iframe: START on play, PROGRESS every ~15s
 * (with position + duration, so drop-off is known), COMPLETE on ended. Returns a cleanup fn.
 * Best-effort: silently no-ops if the Stream SDK can't load.
 */
export function attachStreamTelemetry(iframe: HTMLIFrameElement, contentId: string, token: WatchToken): () => void {
  let timer: number | undefined;
  let started = false;
  let cancelled = false;
  let removeListeners: (() => void) | undefined;
  getStreamPlayer(iframe).then(player => {
    if (cancelled) return;
    const snapshot = () => ({ progressSec: Math.round(player.currentTime) || 0, durationSec: Math.round(player.duration) || undefined });
    const onPlay = () => { const currentToken = watchToken(token); if (!started && currentToken) { started = true; trackEvent('PLAY', { contentId }, currentToken); watchBeacon(contentId, "START", currentToken, snapshot()); } };
    const onEnded = () => { if (started) watchBeacon(contentId, "COMPLETE", watchToken(token), snapshot()); };
    const onTime = () => { if (!player.paused) onPlay(); };
    player.addEventListener("play", onPlay);
    player.addEventListener("playing", onPlay);
    player.addEventListener("timeupdate", onTime);
    player.addEventListener("ended", onEnded);
    removeListeners = () => { player.removeEventListener("play", onPlay); player.removeEventListener("playing", onPlay); player.removeEventListener("timeupdate", onTime); player.removeEventListener("ended", onEnded); };
    timer = window.setInterval(() => { if (started && !player.paused && !document.hidden) watchBeacon(contentId, "PROGRESS", watchToken(token), snapshot()); }, 15000);
  }).catch(() => {});
  return () => { cancelled = true; if (timer) window.clearInterval(timer); removeListeners?.(); };
}
