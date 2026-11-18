export type StreamPlayer = {
  currentTime: number;
  duration: number;
  paused: boolean;
  addEventListener: (event: string, listener: () => void) => void;
  removeEventListener: (event: string, listener: () => void) => void;
};

declare global { interface Window { Stream?: (iframe: HTMLIFrameElement) => StreamPlayer } }

let sdk: Promise<void> | undefined;
const players = new WeakMap<HTMLIFrameElement, StreamPlayer>();

/** Share the SDK and its iframe bridge between playback state and watch telemetry. */
export async function getStreamPlayer(iframe: HTMLIFrameElement): Promise<StreamPlayer> {
  if (!window.Stream) {
    sdk ??= new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://embed.cloudflarestream.com/embed/sdk.latest.js";
      script.async = true;
      const timeout = window.setTimeout(() => fail(), 15000);
      const fail = () => {
        window.clearTimeout(timeout);
        script.remove();
        sdk = undefined;
        reject(new Error("Could not load the video controls."));
      };
      script.onload = () => { window.clearTimeout(timeout); resolve(); };
      script.onerror = fail;
      document.head.appendChild(script);
    });
    await sdk;
  }
  if (!window.Stream) throw new Error("Video controls unavailable.");
  let player = players.get(iframe);
  if (!player) { player = window.Stream(iframe); players.set(iframe, player); }
  return player;
}

export function observeStreamPlayback(iframe: HTMLIFrameElement, onPlaying: (playing: boolean) => void): () => void {
  let cancelled = false;
  let cleanup: (() => void) | undefined;
  void getStreamPlayer(iframe).then(player => {
    if (cancelled) return;
    let seeking = false;
    let previousTime = player.currentTime;
    const play = () => onPlaying(true);
    const stop = () => onPlaying(false);
    const onSeeking = () => { seeking = true; stop(); };
    const onSeeked = () => { seeking = false; previousTime = player.currentTime; };
    // Autoplay can begin before the SDK loads. Advancing playback recovers a missed
    // 'playing' event, without assuming a loaded iframe means a video is playing.
    const onTime = () => {
      if (!seeking && player.paused === false && player.currentTime > previousTime) play();
      previousTime = player.currentTime;
    };
    const stops = ["pause", "waiting", "stalled", "ended", "error", "abort"];
    player.addEventListener("playing", play);
    player.addEventListener("seeking", onSeeking);
    player.addEventListener("seeked", onSeeked);
    player.addEventListener("timeupdate", onTime);
    stops.forEach(event => player.addEventListener(event, stop));
    cleanup = () => {
      player.removeEventListener("playing", play);
      player.removeEventListener("seeking", onSeeking);
      player.removeEventListener("seeked", onSeeked);
      player.removeEventListener("timeupdate", onTime);
      stops.forEach(event => player.removeEventListener(event, stop));
    };
  }).catch(() => { /* Normal playback still works if the SDK is unavailable. */ });
  return () => { cancelled = true; cleanup?.(); };
}
