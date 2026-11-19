"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import styles from "./EpisodeExpansion.module.css";
import { loadYouTubeApi, type YouTubePlayer } from "@/lib/youtube-player";
import { usePlayerTilt } from "./PlayerTilt";
import { observeStreamPlayback } from "@/lib/cloudflare-player";
import StreamVideo from "./StreamVideo";
import PlayerAmbient from "./PlayerAmbient";
import { useAuth } from "./AuthProvider";
import { attachStreamTelemetry, attachVideoTelemetry, trackEvent, watchBeacon } from "@/lib/analytics";
import { PlayerButton, BackIcon, CaptionsIcon, FullscreenEnterIcon, FullscreenExitIcon, Scrubber, SettingsIcon, SunIcon, SettingsPanel, formatTime, type CaptionTrack, type SettingsPage } from "./PlayerControls";

export type EpisodeSelection = { episode: number; origin: HTMLElement };

type FullscreenDocument = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type NativeFullscreenVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitExitFullscreen?: () => void; webkitDisplayingFullscreen?: boolean };
const fullscreenElement = () => (document as FullscreenDocument).fullscreenElement ?? (document as FullscreenDocument).webkitFullscreenElement ?? null;
const fullscreenAvailable = () => typeof document !== "undefined" && Boolean(document.fullscreenEnabled || (document as FullscreenDocument).webkitFullscreenEnabled);
const exitFullscreen = async () => {
  try {
    if (document.exitFullscreen) await document.exitFullscreen();
    else await (document as FullscreenDocument).webkitExitFullscreen?.();
  } catch { /* Full screen may already have ended in the browser. */ }
};
const enterFullscreen = async (element: FullscreenElement) => {
  if (element.requestFullscreen) await element.requestFullscreen({ navigationUI: "hide" });
  else if (element.webkitRequestFullscreen) await element.webkitRequestFullscreen();
  else throw new Error("Full screen unavailable");
};
type LockableOrientation = ScreenOrientation & { lock?: (orientation: string) => Promise<void> };
const orientation = () => (typeof screen === "undefined" ? undefined : screen.orientation as LockableOrientation | undefined);
const portraitQuery = "(orientation: portrait)";
const subscribeToOrientation = (onChange: () => void) => {
  const query = window.matchMedia(portraitQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const isPortrait = () => window.matchMedia(portraitQuery).matches;
const BRIGHTNESS_KEY = "rv-player-brightness";
// Netflix-style: let the episode art settle for a moment, then start playing on its own.
const AUTOPLAY_DELAY_MS = 1000;

/** Show the player immediately while keeping the original scene mounted behind it. */
export default function EpisodeExpansion({ selection, seriesTitle, videoId, streamUrl, hlsManifestUrl, contentId, onClose }: { selection: EpisodeSelection; seriesTitle: string; videoId?: string; streamUrl?: string; hlsManifestUrl?: string; contentId?: string; onClose: () => void }) {
  const { accessToken } = useAuth();
  const watch = useRef({ contentId, accessToken });
  useEffect(() => { watch.current = { contentId, accessToken }; }, [contentId, accessToken]);
  const dialog = useRef<HTMLDialogElement>(null);
  const artwork = useRef<HTMLDivElement>(null);
  const playerMount = useRef<HTMLDivElement>(null);
  const player = useRef<YouTubePlayer | null>(null);
  const streamVideo = useRef<HTMLVideoElement>(null);
  const ambientMotion = useRef<HTMLDivElement>(null);
  const [streamFallback, setStreamFallback] = useState(false);
  const [ambientBlocked, setAmbientBlocked] = useState(false);
  const [videoAspect, setVideoAspect] = useState(16 / 9);
  const tiltViewport = useRef<HTMLDivElement>(null);
  const tiltSurface = useRef<HTMLDivElement>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [providerFeedback, setProviderFeedback] = useState(false);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const handOffCenterFeedback = useCallback(() => {
    // YouTube owns its transient playback animation. Leave its center clear
    // briefly, then restore our hover control; this is a timing fallback, not an iframe visibility API.
    clearTimeout(feedbackTimer.current);
    setProviderFeedback(true);
    feedbackTimer.current = setTimeout(() => setProviderFeedback(false), 900);
  }, []);
  useEffect(() => () => clearTimeout(feedbackTimer.current), []);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  const lastAudibleVolume = useRef(100);
  const [volumeFocused, setVolumeFocused] = useState(false);
  const [volumeExpanded, setVolumeExpanded] = useState(false);
  const [volumeDragging, setVolumeDragging] = useState(false);
  useEffect(() => {
    if (!volumeExpanded || volumeDragging) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target as Element).closest(".player-volume")) { setVolumeExpanded(false); setVolumeFocused(false); }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [volumeExpanded, volumeDragging]);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playerError, setPlayerError] = useState("");
  const [buffered, setBuffered] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [panel, setPanel] = useState<SettingsPage | null>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const closePanel = () => { setPanel(null); settingsTrigger.current?.focus({ preventScroll: true }); };
  const [chrome, setChrome] = useState(true);
  const [activity, setActivity] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  const [fullscreenSupported] = useState(fullscreenAvailable);
  // iPhone exposes fullscreen through the video's own player, not the page.
  const nativeYouTube = Boolean(videoId && !fullscreenSupported);
  const [landscapeMode, setLandscapeMode] = useState(false);
  const portrait = useSyncExternalStore(subscribeToOrientation, isPortrait, () => false);
  const rotatedLandscape = fullscreen && landscapeMode && portrait;
  const fullscreenActive = fullscreen || nativeFullscreen;
  const fullscreenRequest = useRef(0);
  const [brightness, setBrightness] = useState(() => {
    try { const saved = Number(localStorage.getItem(BRIGHTNESS_KEY)); return saved >= 50 && saved <= 150 ? saved : 100; } catch { return 100; }
  });
  const [qualities, setQualities] = useState<string[]>([]);
  const [quality, setQuality] = useState("auto");
  const [tracks, setTracks] = useState<CaptionTrack[]>([]);
  const [captionLang, setCaptionLang] = useState<string | null>(null);
  const [streamStarted, setStreamStarted] = useState(false);
  const [adjustingBrightness, setAdjustingBrightness] = useState(false);
  const [brightnessHud, setBrightnessHud] = useState(false);
  const brightnessGesture = useRef<{ y: number; start: number; height: number; moved: boolean } | null>(null);
  const lastWake = useRef(0);
  const closing = useRef(false);
  const dismiss = useRef<() => void>(() => {});
  const tilt = usePlayerTilt({ viewportRef: tiltViewport, surfaceRef: tiltSurface, ambientRef: ambientMotion, ambientSupported: Boolean(hlsManifestUrl) && !streamFallback && !ambientBlocked, thumbnailSupported: Boolean(videoId), playing: playing && !playerError, rotated: rotatedLandscape, suspended: panel !== null || scrubbing || adjustingBrightness, onMotionUnavailable: () => setPanel("tilt") });

  useEffect(() => {
    if (!streamUrl) return;
    const timer = window.setTimeout(() => setStreamStarted(true), AUTOPLAY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [streamUrl]);

  useEffect(() => {
    // Mount the embed as soon as the dialog is open.
    const host = playerMount.current;
    if (!videoId || !host) return;
    const openedAt = performance.now();
    let autoplayTimer: number | undefined;
    let live = true;
    let instance: YouTubePlayer | null = null;
    let started = false;
    let watchTimer: number | undefined;
    const report = (event: "START" | "PROGRESS" | "COMPLETE") => {
      const { contentId: id, accessToken: token } = watch.current;
      if (!id || !token || !instance) return;
      const length = Math.max(0, Math.round(instance.getDuration() || 0));
      watchBeacon(id, event, token, { progressSec: event === "COMPLETE" ? length : Math.max(0, Math.round(instance.getCurrentTime() || 0)), durationSec: length });
    };
    void loadYouTubeApi().then(() => {
      if (!live || !window.YT) return;
      // YouTube replaces its target with an iframe and removes it on destroy. Keep
      // that target inside a stable React-owned host so iOS control switches and
      // Strict Mode cleanup never remove a DOM node React still expects to own.
      const target = document.createElement("div");
      host.replaceChildren(target);
      instance = new window.YT.Player(target, {
        width: "100%",
        height: "100%",
        videoId,
        playerVars: { autoplay: 0, controls: nativeYouTube ? 1 : 0, disablekb: 1, fs: 1, playsinline: 1, rel: 0, cc_load_policy: 0, enablejsapi: 1, origin: window.location.origin },
        events: {
          onReady: (event: { target: YouTubePlayer }) => {
            if (!live) return;
            player.current = event.target;
            const iframe = host.querySelector("iframe");
            iframe?.setAttribute("allowfullscreen", "");
            iframe?.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture; fullscreen");
            setPlayerReady(true);
            setMuted(event.target.isMuted());
            const initialVolume = event.target.getVolume?.();
            if (typeof initialVolume === "number" && Number.isFinite(initialVolume)) setVolume(initialVolume);
            const length = event.target.getDuration();
            if (Number.isFinite(length)) setDuration(length);
            event.target.loadModule?.("captions");
            // Start one second after the card opened, counting the time the player spent loading.
            autoplayTimer = window.setTimeout(() => { if (live) event.target.playVideo(); }, Math.max(0, AUTOPLAY_DELAY_MS - (performance.now() - openedAt)));
          },
          onStateChange: (event: { data: number; target: YouTubePlayer }) => {
            if (!live || !window.YT) return;
            setPlaying(event.data === window.YT.PlayerState.PLAYING);
            if (event.data === window.YT.PlayerState.PLAYING || event.data === window.YT.PlayerState.PAUSED) handOffCenterFeedback();
            if (event.data === window.YT.PlayerState.PLAYING || event.data === window.YT.PlayerState.PAUSED || event.data === window.YT.PlayerState.ENDED) {
              // Restart the shared chrome timer when the provider confirms playback,
              // including pauses initiated inside the iframe or by a media key.
              setChrome(true);
              setActivity(count => count + 1);
            }
            if (event.data === window.YT.PlayerState.PLAYING && !started && watch.current.contentId && watch.current.accessToken) {
              started = true;
              trackEvent("PLAY", { contentId: watch.current.contentId }, watch.current.accessToken);
              report("START");
            }
            if (event.data === window.YT.PlayerState.ENDED && started) report("COMPLETE");
            if (event.data === window.YT.PlayerState.ENDED) setPosition(event.target.getDuration());
          },
          onError: () => { if (live) { setPlaying(false); setPlayerError("This video can’t be played here."); } },
        },
      });
      player.current = instance;
      watchTimer = window.setInterval(() => { if (started && instance?.getPlayerState() === 1 && !document.hidden) report("PROGRESS"); }, 15000);
    }).catch(error => { if (live) setPlayerError(error instanceof Error ? error.message : "Could not load this video."); });
    return () => {
      live = false;
      window.clearTimeout(autoplayTimer);
      window.clearInterval(watchTimer);
      instance?.destroy();
      if (player.current === instance) player.current = null;
      host.replaceChildren();
    };
  }, [videoId, nativeYouTube, handOffCenterFeedback]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const current = player.current?.getCurrentTime();
      const length = player.current?.getDuration();
      if (Number.isFinite(current)) setPosition(current!);
      if (Number.isFinite(length) && length! > 0) setDuration(length!);
      const loaded = player.current?.getVideoLoadedFraction?.();
      if (Number.isFinite(loaded)) setBuffered(loaded!);
      const level = player.current?.getVolume?.();
      if (typeof level === "number" && Number.isFinite(level)) setVolume(level);
      if (player.current) setMuted(player.current.isMuted());
    }, 250);
    return () => window.clearInterval(timer);
  }, [playing]);

  // Ask the embed what it can do: quality levels, subtitle tracks and speeds are only known once it plays.
  const refreshCapabilities = () => {
    const instance = player.current;
    if (!instance) return;
    try {
      const levels = (instance.getAvailableQualityLevels?.() ?? []).filter(level => level !== "auto");
      if (levels.length) setQualities(levels);
      const current = instance.getPlaybackQuality?.();
      if (current && current !== "unknown") setQuality(previous => previous === "auto" ? previous : current);
      const list = instance.getOption?.("captions", "tracklist");
      if (Array.isArray(list)) {
        const seen = new Set<string>();
        setTracks(list.flatMap((entry: { languageCode?: string; languageName?: string; displayName?: string }) => {
          if (!entry.languageCode || seen.has(entry.languageCode)) return [];
          seen.add(entry.languageCode);
          return [{ code: entry.languageCode, name: entry.languageName || entry.displayName || entry.languageCode }];
        }));
      }
    } catch { /* The embed may not expose every option yet. */ }
  };
  const refreshRef = useRef(refreshCapabilities);
  useEffect(() => { refreshRef.current = refreshCapabilities; });
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => refreshRef.current(), 800);
    return () => window.clearTimeout(timer);
  }, [playing]);

  const wake = () => { setChrome(true); setActivity(count => count + 1); };
  const chromeVisible = chrome || !playerReady || panel !== null || scrubbing || volumeFocused || volumeDragging;
  useEffect(() => {
    if (!chrome || !playerReady || panel !== null || scrubbing || volumeFocused || volumeDragging) return;
    const timer = window.setTimeout(() => setChrome(false), 3200);
    return () => window.clearTimeout(timer);
  }, [chrome, playerReady, panel, scrubbing, activity, volumeFocused, volumeDragging]);

  useEffect(() => {
    const onChange = () => {
      const active = Boolean(fullscreenElement());
      setFullscreen(active);
      if (!active) {
        fullscreenRequest.current += 1;
        setLandscapeMode(false);
        try { orientation()?.unlock(); } catch { /* Not locked. */ }
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => { document.removeEventListener("fullscreenchange", onChange); document.removeEventListener("webkitfullscreenchange", onChange); };
  }, []);
  const leaveFullscreen = () => {
    fullscreenRequest.current += 1;
    setLandscapeMode(false);
    try { if (nativeFullscreen) (streamVideo.current as NativeFullscreenVideo | null)?.webkitExitFullscreen?.(); } catch { /* Native fullscreen may already have ended. */ }
    if (fullscreenElement()) void exitFullscreen();
    try { orientation()?.unlock(); } catch { /* No orientation lock to release. */ }
    wake();
  };
  const toggleFullscreen = async () => {
    if (fullscreenElement() || nativeFullscreen) { leaveFullscreen(); return; }
    if (!dialog.current || closing.current) return;
    const request = ++fullscreenRequest.current;
    const touchScreen = window.matchMedia("(pointer: coarse)").matches;
    setPanel(null);
    setFullscreenError("");
    wake();
    if (!fullscreenSupported) {
      const video = streamVideo.current as NativeFullscreenVideo | null;
      try {
        // Call directly in the tap handler: iPhone requires a user gesture.
        if (!video?.webkitEnterFullscreen) throw new Error("Native fullscreen unavailable");
        video.webkitEnterFullscreen();
      } catch { setFullscreenError("Use the full-screen button inside the video controls."); }
      return;
    }
    // The document contains the modal; a dialog cannot be a Fullscreen API target.
    try { await enterFullscreen(document.documentElement); }
    catch {
      if (request === fullscreenRequest.current && !closing.current) setFullscreenError("Full screen was unavailable. Tap the full-screen button again to retry.");
      return;
    }
    if (request !== fullscreenRequest.current || closing.current) { void exitFullscreen(); return; }
    if (touchScreen) {
      try {
        const deviceOrientation = orientation();
        if (!deviceOrientation?.lock) throw new Error("Orientation lock unavailable");
        await deviceOrientation.lock("landscape");
      } catch {
        // Safari may deny orientation lock. Rotate just the viewer and its controls
        // in portrait, keeping the same iframe, playback position, and audio.
        if (request === fullscreenRequest.current && !closing.current) setLandscapeMode(true);
      }
    }
  };


  useEffect(() => {
    if (!brightnessHud || adjustingBrightness) return;
    const timer = window.setTimeout(() => setBrightnessHud(false), 900);
    return () => window.clearTimeout(timer);
  }, [brightnessHud, adjustingBrightness, brightness]);

  useEffect(() => {
    try { localStorage.setItem(BRIGHTNESS_KEY, String(brightness)); } catch { /* Brightness just won't persist. */ }
  }, [brightness]);

  useEffect(() => {
    const modal = dialog.current!;
    const cover = artwork.current!;
    const { origin } = selection;
    const previousFocus = document.activeElement as HTMLElement | null;
    closing.current = false;
    const clone = origin.cloneNode(true) as HTMLElement;
    clone.inert = true;
    clone.removeAttribute("id");
    clone.removeAttribute("aria-label");
    clone.setAttribute("aria-hidden", "true");
    clone.querySelectorAll("h1,h2,h3,p,span").forEach(node => {
      if (node.textContent?.trim()) (node as HTMLElement).style.visibility = "hidden";
    });
    clone.style.cssText += `;width:${origin.offsetWidth}px;height:${origin.offsetHeight}px;position:absolute;inset:0;margin:0;transform-origin:top left;transform:scale(${window.innerWidth / origin.offsetWidth},${window.innerHeight / origin.offsetHeight});border-radius:0;`;
    cover.prepend(clone);
    modal.showModal();
    dismiss.current = () => {
      if (closing.current) return;
      closing.current = true;
      fullscreenRequest.current += 1;
      player.current?.pauseVideo();
      if (fullscreenElement()) exitFullscreen();
      modal.close();
      onClose();
      previousFocus?.focus({ preventScroll: true });
    };
    return () => {
      fullscreenRequest.current += 1;
      clone.remove();
      if (fullscreenElement()) exitFullscreen();
      modal.close();
    };
  }, [selection, onClose]);

  function skipBy(seconds: number) {
    const current = player.current?.getCurrentTime() ?? 0;
    const length = player.current?.getDuration() ?? 0;
    if (length <= 0) return;
    const next = Math.max(0, Math.min(length, current + seconds));
    player.current?.seekTo(next, true);
    setPosition(next);
  }

  const chooseQuality = (level: string) => {
    setQuality(level);
    player.current?.setPlaybackQuality?.(level);
  };
  const chooseCaption = (code: string | null) => {
    setCaptionLang(code);
    try { player.current?.setOption?.("captions", "track", code ? { languageCode: code } : {}); } catch { /* Captions module unavailable. */ }
  };
  const changeVolume = (next: number) => {
    const level = Math.max(0, Math.min(100, next));
    player.current?.setVolume(level);
    if (level === 0) player.current?.mute();
    else { player.current?.unMute(); lastAudibleVolume.current = level; }
    setVolume(level); setMuted(level === 0); wake();
  };
  const toggleMute = () => {
    if (muted || volume === 0) changeVolume(lastAudibleVolume.current);
    else { lastAudibleVolume.current = volume; player.current?.mute(); setMuted(true); }
  };
  const togglePlay = () => {
    if (!playerReady) return;
    handOffCenterFeedback();
    wake();
    if (playing) player.current?.pauseVideo(); else player.current?.playVideo();
  };
  const commitSeek = (seconds: number) => { player.current?.seekTo(seconds, true); setPosition(seconds); };
  const openPanel = (page: SettingsPage) => {
    if (panel !== null && (page === "root" || page === panel)) { closePanel(); return; }
    refreshCapabilities(); setPanel(page);
  };
  const backgroundTap = (pointerType: string) => {
    if (panel !== null) { closePanel(); return; }
    // Mouse click plays/pauses; a touch tap just shows or hides the controls.
    if (pointerType === "mouse") togglePlay();
    else if (chromeVisible) setChrome(false); else wake();
  };
  // Netflix-style: drag up or down on the left side of the video to change brightness.
  const brightnessDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    brightnessGesture.current = { y: rotatedLandscape ? -event.clientX : event.clientY, start: brightness, height: event.currentTarget.clientHeight, moved: false };
  };
  const brightnessMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = brightnessGesture.current;
    if (!gesture) return;
    const delta = gesture.y - (rotatedLandscape ? -event.clientX : event.clientY);
    if (!gesture.moved && Math.abs(delta) < 8) return;
    if (!gesture.moved) { gesture.moved = true; setAdjustingBrightness(true); }
    setBrightnessHud(true);
    // Dragging the full height of the zone sweeps the whole 50–150% range.
    setBrightness(Math.round(Math.min(150, Math.max(50, gesture.start + (delta / Math.max(1, gesture.height * 0.8)) * 100))));
  };
  const brightnessUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = brightnessGesture.current;
    brightnessGesture.current = null;
    setAdjustingBrightness(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (gesture && !gesture.moved && event.type === "pointerup") backgroundTap(event.pointerType);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDialogElement>) => {
    if ((event.target as HTMLElement).closest("[data-player-settings]")) return;
    if (streamUrl || nativeYouTube || event.metaKey || event.ctrlKey || event.altKey) return;
    wake();
    if ((event.target as HTMLElement).closest("button, [role=slider], input, [role=menu]") && event.key !== "f" && event.key !== "m" && event.key !== "c") return;
    const key = event.key.toLowerCase();
    if (key === " " || key === "k") { event.preventDefault(); togglePlay(); }
    else if (key === "arrowleft") { event.preventDefault(); skipBy(-10); }
    else if (key === "arrowright") { event.preventDefault(); skipBy(10); }
    else if (key === "m") toggleMute();
    else if (key === "f") void toggleFullscreen();
    else if (key === "c") openPanel("captions");
  };

  const controlsOn = !streamUrl && !nativeYouTube && !playerError;
  const customFullscreenAvailable = fullscreenSupported || Boolean(streamUrl && hlsManifestUrl && !streamFallback);
  const pictureFit = tilt.ambientEnabled ? 94 : 100;
  const minimumEmbed = videoId ? 200 : 0;
  const fade = `transition-opacity duration-300 motion-reduce:transition-none ${chromeVisible ? "opacity-100" : "opacity-0"}`;

  const playerOptions = <div className="flex items-center gap-0 sm:gap-1">
          {controlsOn && <PlayerButton type="button" onClick={() => openPanel("captions")} disabled={!playerReady} aria-label="Subtitles and language" aria-haspopup="menu" aria-expanded={panel === "captions"} title="Subtitles (C)" className="grid size-11 place-items-center rounded-full text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-40"><CaptionsIcon /></PlayerButton>}
          <PlayerButton ref={settingsTrigger} type="button" onClick={() => openPanel("root")} aria-label="Player settings" aria-haspopup="menu" aria-expanded={panel !== null} title="Settings" className="grid size-11 place-items-center rounded-full text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"><SettingsIcon /></PlayerButton>
          {customFullscreenAvailable && <PlayerButton type="button" onClick={() => void toggleFullscreen()} aria-label={fullscreenActive ? "Exit full screen" : "Enter full screen"} title="Full screen (F)" className="grid size-11 place-items-center rounded-full text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-40">{fullscreenActive ? <FullscreenExitIcon /> : <FullscreenEnterIcon />}</PlayerButton>}
        </div>;

  return <dialog ref={dialog} aria-label={`${seriesTitle} — Episode ${String(selection.episode).padStart(2, "0")}`} onKeyDown={onKeyDown} onPointerMove={() => { if (!streamUrl && performance.now() - lastWake.current > 300) { lastWake.current = performance.now(); wake(); } }} onCancel={event => { event.preventDefault(); if (panel !== null) closePanel(); else if (fullscreenActive) leaveFullscreen(); else dismiss.current(); }} className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden border-0 bg-transparent p-0 text-white backdrop:bg-transparent">
    <div ref={tiltViewport} className={`${styles.viewport} ${rotatedLandscape ? styles.rotated : ""}`} data-player-landscape={landscapeMode || undefined} data-player-rotated={rotatedLandscape || undefined}>
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-black/70" />
    <div ref={artwork} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden bg-[#302116] [&>*]:origin-top-left">
      <div className="absolute inset-0 z-[1] bg-black/40" />
    </div>
    {(videoId || streamStarted) && <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[5] bg-black" />}
    <PlayerAmbient videoRef={streamVideo} motionRef={ambientMotion} enabled={tilt.ambientEnabled && Boolean(videoId || streamStarted)} playing={playing && !playerError} mode={tilt.effectiveAmbientMode} youtubeId={videoId} palette={tilt.ambientPalette} paletteKey={seriesTitle} sourceKey={hlsManifestUrl ?? streamUrl ?? videoId ?? ""} strength={tilt.ambientStrength} onUnavailable={() => setAmbientBlocked(true)} />
    <div ref={tiltSurface} className={`absolute inset-0 z-10 bg-black ${videoId && !nativeYouTube ? "pointer-events-none" : ""}`} style={videoId || streamUrl ? { inset: "auto", left: `calc(50% - min(${pictureFit / 2}cqw, ${videoAspect * pictureFit / 2}cqh))`, top: `calc(50% - min(${pictureFit / 2}cqh, max(${minimumEmbed / 2}px, ${pictureFit / 2 / videoAspect}cqw)))`, width: `min(${pictureFit}cqw, ${videoAspect * pictureFit}cqh)`, height: `min(${pictureFit}cqh, max(${minimumEmbed}px, ${pictureFit / videoAspect}cqw))` } : undefined}>
      {videoId && <div className="absolute inset-0" style={{ filter: brightness === 100 ? undefined : `brightness(${brightness / 100})` }}><div ref={playerMount} className="absolute inset-0 [&_iframe]:size-full [&_iframe]:border-0" /></div>}
      {streamUrl && streamStarted && <StreamVideo manifestUrl={hlsManifestUrl} fallbackUrl={streamUrl} title={seriesTitle} videoRef={streamVideo} onPlaying={setPlaying} onAspectRatio={setVideoAspect} onVideo={video => {
        const beginFullscreen = () => setNativeFullscreen(true);
        const endFullscreen = () => { setNativeFullscreen(false); setLandscapeMode(false); };
        video.addEventListener("webkitbeginfullscreen", beginFullscreen);
        video.addEventListener("webkitendfullscreen", endFullscreen);
        const stopTelemetry = contentId ? attachVideoTelemetry(video, contentId, () => watch.current.accessToken) : undefined;
        return () => {
          video.removeEventListener("webkitbeginfullscreen", beginFullscreen);
          video.removeEventListener("webkitendfullscreen", endFullscreen);
          try { if ((video as NativeFullscreenVideo).webkitDisplayingFullscreen) (video as NativeFullscreenVideo).webkitExitFullscreen?.(); } catch { /* The native player may already be dismissed. */ }
          stopTelemetry?.();
        };
      }} onFallback={frame => {
        setStreamFallback(true);
        const stopPlayback = observeStreamPlayback(frame, setPlaying);
        const stopTelemetry = contentId ? attachStreamTelemetry(frame, contentId, () => watch.current.accessToken) : undefined;
        return () => { stopPlayback(); stopTelemetry?.(); };
      }} />}
    </div>
    <div className={`absolute inset-0 z-20 ${streamUrl || nativeYouTube ? "pointer-events-none" : ""}`} onClick={event => {
      if (streamUrl || nativeYouTube || event.target !== event.currentTarget) return;
      backgroundTap((event.nativeEvent as PointerEvent).pointerType);
    }}>
      {controlsOn && <div aria-hidden="true" onPointerDown={brightnessDown} onPointerMove={brightnessMove} onPointerUp={brightnessUp} onPointerCancel={brightnessUp} className="absolute inset-y-24 left-0 w-[32%] touch-none" />}
      {controlsOn && <div aria-hidden="true" className="pointer-events-none absolute top-1/2 left-[max(16px,var(--player-safe-left))] z-10 h-[min(240px,46cqh)] w-12 -translate-y-1/2 transition-[opacity,transform] duration-300 motion-reduce:transition-none" style={{ opacity: brightnessHud ? 1 : 0, transform: `translateY(-50%) translateX(${brightnessHud ? 0 : -8}px)` }}>
        <div className="player-controls-shade h-full w-full rounded-full"><div className="relative h-[min(240px,46cqh)] w-12 overflow-hidden rounded-full">
          <div className="absolute inset-x-0 bottom-0 bg-white/80" style={{ height: `${Math.max(0, Math.min(100, brightness - 50))}%`, transition: adjustingBrightness ? "none" : "height 200ms ease-out" }} />
          <SunIcon className="absolute bottom-3 left-1/2 size-5 -translate-x-1/2 text-white mix-blend-difference" />
        </div></div>
      </div>}
      <div inert={!chromeVisible && controlsOn} className={`${styles.header} pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 pt-[max(16px,var(--player-safe-top))] pr-[max(16px,var(--player-safe-right))] pl-[max(16px,var(--player-safe-left))] ${controlsOn ? "bg-gradient-to-b from-black/55 to-transparent pb-12" : ""} ${streamUrl || nativeYouTube ? "" : fade}`}>
        <PlayerButton type="button" autoFocus onClick={() => dismiss.current()} aria-label="Close video and return to episodes" title="Back to episodes" className="grid size-12 place-items-center rounded-full text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          <BackIcon />
        </PlayerButton>
        {(streamUrl || nativeYouTube) && playerOptions}
      </div>
      {fullscreenError && <p role="status" className="pointer-events-none absolute inset-x-6 top-24 rounded-xl bg-black/80 p-3 text-center text-sm text-white">{fullscreenError}</p>}
      {playerError && <p role="alert" className="absolute inset-x-6 top-[38%] text-center text-sm text-white">{playerError}</p>}
      {videoId && !playerReady && !playerError && <p role="status" className="absolute inset-x-6 top-[38%] text-center text-sm text-white">Loading video…</p>}
      {controlsOn && <div data-player-skip-controls inert={!chromeVisible} className={`pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-center gap-[clamp(80px,18vw,200px)] px-4 ${fade}`}>
        <PlayerButton data-player-center-control data-provider-feedback={providerFeedback} onClick={togglePlay} disabled={!playerReady} aria-label={playing ? "Pause" : "Play"} className="player-skip-button absolute left-1/2 grid size-16 -translate-x-1/2 place-items-center rounded-full text-white disabled:opacity-40"
          style={{ position: "absolute", opacity: providerFeedback ? 0 : 1, transition: providerFeedback ? "none" : "opacity 160ms ease" }}>
          {playing ? <svg aria-hidden="true" className="size-9" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg> : <svg aria-hidden="true" className="size-9" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8Z" /></svg>}
        </PlayerButton>
        {([-10, 10] as const).map(seconds => <PlayerButton key={seconds} onClick={() => { skipBy(seconds); wake(); }} disabled={!playerReady} aria-label={seconds < 0 ? "Rewind 10 seconds" : "Forward 10 seconds"} title={seconds < 0 ? "Rewind 10 seconds" : "Forward 10 seconds"} className="player-skip-button grid size-12 place-items-center rounded-full text-white disabled:opacity-40 sm:size-14">
          <svg aria-hidden="true" className="size-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <g transform={seconds > 0 ? "translate(24 0) scale(-1 1)" : undefined}><path d="M16.5 4.2A9 9 0 1 1 7.5 4.2" strokeLinecap="round" /><path d="m5.4 4.2 3.6-1.7-.1 3.6" fill="currentColor" stroke="none" /></g>
            <text x="12" y="13" textAnchor="middle" dominantBaseline="central" fontSize="8" fontWeight="600" fill="currentColor" stroke="none">10</text>
          </svg>
        </PlayerButton>)}
      </div>}
      {controlsOn && <div data-player-toolbar inert={!chromeVisible} className={`${styles.footer} pointer-events-none absolute inset-x-0 bottom-0 flex flex-col bg-gradient-to-t from-black/80 to-transparent pt-12 pr-[max(16px,var(--player-safe-right))] pb-[max(12px,var(--player-safe-bottom))] pl-[max(16px,var(--player-safe-left))] sm:px-8 ${fade}`}>
        <div className="pointer-events-auto flex h-8 w-full items-center">
          <Scrubber rotated={rotatedLandscape} position={position} duration={duration} buffered={buffered} disabled={!playerReady || !duration} onCommit={commitSeek} onScrubChange={setScrubbing} />
        </div>
        <div className={styles.controlRow}>
          <PlayerButton onClick={togglePlay} disabled={!playerReady} aria-label={playing ? "Pause" : "Play"} className="grid size-11 shrink-0 place-items-center rounded-full text-white disabled:opacity-40">
            {playing ? <svg aria-hidden="true" className="size-6" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg> : <svg aria-hidden="true" className="size-6" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8Z" /></svg>}
          </PlayerButton>
          <div role="group" aria-label="Volume controls" className="player-volume pointer-events-auto shrink-0" data-expanded={volumeExpanded || volumeDragging}
            onPointerEnter={event => { if (event.pointerType === "mouse") setVolumeExpanded(true); }} onPointerLeave={() => { setVolumeExpanded(false); setVolumeFocused(false); }}
            onFocusCapture={event => { setVolumeFocused(true); if (event.target.matches(":focus-visible")) setVolumeExpanded(true); }}
            onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setVolumeFocused(false); setVolumeExpanded(false); } }}
            onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setVolumeExpanded(false); } }}>
            <PlayerButton aria-label="Volume" aria-expanded={volumeExpanded || volumeDragging} disabled={!playerReady} className="grid size-11 shrink-0 place-items-center rounded-full text-white" onClick={() => { if (window.matchMedia("(hover: hover)").matches) toggleMute(); else setVolumeExpanded(true); }}>
            <svg role="img" aria-label={muted || volume === 0 ? "Sound off" : volume < 50 ? "Low volume" : "Sound on"} className="size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 5 6 9H3v6h3l5 4V5Z" />
              {muted || volume === 0 ? <path d="m16 9 5 6m0-6-5 6" /> : <><path d="M15 8a6 6 0 0 1 0 8" />{volume >= 50 && <path d="M18 5a10 10 0 0 1 0 14" />}</>}
            </svg>
            </PlayerButton>
            <div className="player-volume-slider" inert={!volumeExpanded && !volumeDragging}>
              <input type="range" aria-label="Volume" aria-valuetext={`${muted ? 0 : volume}%`} min="0" max="100" step="1" value={muted ? 0 : volume} disabled={!playerReady} onChange={event => changeVolume(Number(event.target.value))}
                onPointerDown={() => setVolumeDragging(true)} onPointerUp={() => setVolumeDragging(false)} onPointerCancel={() => setVolumeDragging(false)} />
            </div>
          </div>
          <span className={styles.time} aria-label="Playback time">{formatTime(position)}<span className={styles.duration}> / {formatTime(duration)}</span></span>
          <div className="ml-auto shrink-0">{playerOptions}</div>
        </div>
      </div>}
      <SettingsPanel open={panel !== null} page={panel ?? "root"} onPage={setPanel} onClose={closePanel} qualities={qualities} quality={quality} onQuality={chooseQuality} tracks={tracks} captionLang={captionLang} onCaption={chooseCaption} brightness={brightness} onBrightness={setBrightness} tilt={tilt} playbackSettings={controlsOn} />
    </div>
    </div>
  </dialog>;
}
