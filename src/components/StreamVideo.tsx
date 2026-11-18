"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/** One decoder supplies both playback and ambient frames. Keep the iframe as a recovery path. */
export default function StreamVideo({ manifestUrl, fallbackUrl, title, videoRef, onPlaying, onFallback, onVideo, onAspectRatio }: {
  manifestUrl?: string; fallbackUrl: string; title: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  onPlaying: (playing: boolean) => void;
  onFallback?: (iframe: HTMLIFrameElement) => (() => void) | undefined;
  onVideo?: (video: HTMLVideoElement) => (() => void) | undefined;
  onAspectRatio?: (ratio: number) => void;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const fallback = !manifestUrl || failedSource === manifestUrl;
  const frameRef = useRef<HTMLIFrameElement>(null);
  // Callback updates must not reload a stream or discard its playback position.
  const callbacks = useRef({ onPlaying, onFallback, onVideo, onAspectRatio });
  useEffect(() => { callbacks.current = { onPlaying, onFallback, onVideo, onAspectRatio }; });

  useEffect(() => {
    if (fallback) {
      const frame = frameRef.current;
      return frame ? callbacks.current.onFallback?.(frame) : undefined;
    }
    const video = videoRef.current;
    if (!video || !manifestUrl) return;
    let live = true;
    let destroy: (() => void) | undefined;
    const failed = () => {
      if (!live) return;
      callbacks.current.onPlaying(false);
      setFailedSource(manifestUrl);
    };
    const play = () => callbacks.current.onPlaying(true);
    const stop = () => callbacks.current.onPlaying(false);
    const dimensions = () => { if (video.videoWidth && video.videoHeight) callbacks.current.onAspectRatio?.(video.videoWidth / video.videoHeight); };
    const start = () => { if (live) void video.play().catch(() => { /* Native controls recover blocked autoplay. */ }); };
    video.addEventListener("playing", play);
    const stops = ["pause", "waiting", "stalled", "seeking", "ended"];
    stops.forEach(event => video.addEventListener(event, stop));
    video.addEventListener("error", failed);
    video.addEventListener("loadedmetadata", dimensions);
    video.addEventListener("resize", dimensions);
    const detachTelemetry = callbacks.current.onVideo?.(video);
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = manifestUrl;
      start();
    } else {
      void import("hls.js").then(({ default: Hls }) => {
        if (!live) return;
        if (!Hls.isSupported()) { failed(); return; }
        const hls = new Hls({ capLevelToPlayerSize: true, maxBufferLength: 20, maxMaxBufferLength: 40 });
        destroy = () => hls.destroy();
        hls.on(Hls.Events.MANIFEST_PARSED, start);
        hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) failed(); });
        hls.loadSource(manifestUrl);
        hls.attachMedia(video);
      }).catch(failed);
    }
    return () => {
      live = false;
      video.removeEventListener("playing", play);
      stops.forEach(event => video.removeEventListener(event, stop));
      video.removeEventListener("error", failed);
      video.removeEventListener("loadedmetadata", dimensions);
      video.removeEventListener("resize", dimensions);
      detachTelemetry?.();
      destroy?.();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [fallback, manifestUrl, fallbackUrl, videoRef]);

  return fallback
    ? <iframe ref={frameRef} src={fallbackUrl} title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen className="absolute inset-0 size-full border-0" />
    : <video ref={videoRef} aria-label={title} crossOrigin="anonymous" controls playsInline autoPlay preload="metadata" className="absolute inset-0 size-full bg-black object-contain" />;
}
