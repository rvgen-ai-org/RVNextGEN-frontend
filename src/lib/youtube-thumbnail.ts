export type ThumbnailFrame = { pixels: Uint8ClampedArray; width: number; height: number };

// Share pending requests and tiny decoded color fields, never retain full-size images.
const frames = new Map<string, Promise<ThumbnailFrame | null>>();
const MAX_FRAMES = 32;

export function loadYouTubeAmbientFrame(videoId: string): Promise<ThumbnailFrame | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(videoId)) return Promise.resolve(null);
  const cached = frames.get(videoId);
  if (cached) { frames.delete(videoId); frames.set(videoId, cached); return cached; }
  const pending = new Promise<ThumbnailFrame | null>(resolve => {
    const image = new Image();
    const controller = new AbortController();
    let objectUrl: string | undefined;
    let finished = false;
    const finish = (frame: ThumbnailFrame | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      image.onload = image.onerror = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      resolve(frame);
    };
    const timeout = window.setTimeout(() => { controller.abort(); finish(null); image.removeAttribute("src"); }, 6000);
    image.crossOrigin = "anonymous";
    image.referrerPolicy = "no-referrer";
    image.onload = () => {
      // Missing thumbnails can return a tiny generic placeholder with status 200.
      if (image.naturalWidth < 200 || image.naturalHeight < 100) { finish(null); return; }
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = Math.max(18, Math.min(32, Math.round(32 * image.naturalHeight / image.naturalWidth)));
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) { finish(null); return; }
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        finish({ pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height });
      } catch { finish(null); }
    };
    image.onerror = () => finish(null);
    // Direct CDN image request: no YouTube Data API, proxy, credentials or cache busting.
    void fetch(`https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`, {
      mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal,
    }).then(async response => {
      if (!response.ok) { finish(null); return; }
      const blob = await response.blob();
      if (finished) return;
      objectUrl = URL.createObjectURL(blob);
      image.src = objectUrl;
    }).catch(() => finish(null));
  });
  frames.set(videoId, pending);
  if (frames.size > MAX_FRAMES) frames.delete(frames.keys().next().value!);
  return pending;
}
