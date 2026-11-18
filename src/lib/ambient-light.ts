export type FrameBounds = { x: number; y: number; width: number; height: number };

export const ambientPalettes = {
  ocean: { label: "Ocean", colors: ["#247ac4", "#13a39a", "#6250a5", "#173764"] },
  ember: { label: "Ember", colors: ["#d26a30", "#a73558", "#65508e", "#704525"] },
  aurora: { label: "Aurora", colors: ["#7358c6", "#2299b7", "#b04488", "#225e8b"] },
} as const;
export type AmbientPalette = "auto" | keyof typeof ambientPalettes;
export type AmbientMode = "auto" | "thumbnail" | "cinematic" | "live";
export type AmbientRenderMode = Exclude<AmbientMode, "auto">;

export function resolveAmbientMode(mode: AmbientMode, thumbnail: boolean, live: boolean): AmbientRenderMode {
  if (mode === "auto") return thumbnail ? "thumbnail" : "cinematic";
  if (mode === "thumbnail" && !thumbnail || mode === "live" && !live) return "cinematic";
  return mode;
}

export function paintAmbientFallback(ctx: CanvasRenderingContext2D) {
  ctx.filter = "none";
  const glow = ctx.createRadialGradient(96, 54, 0, 96, 54, 130);
  glow.addColorStop(0, "#34505a");
  glow.addColorStop(1, "#080e15");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 192, 108);
}

/** Stable per title; signed playback URLs and playback position never affect the palette. */
export function resolveAmbientPalette(palette: AmbientPalette, title: string) {
  if (palette !== "auto") return ambientPalettes[palette];
  let hash = 0;
  for (const letter of title) hash = (Math.imul(hash, 31) + letter.charCodeAt(0)) >>> 0;
  const keys = Object.keys(ambientPalettes) as (keyof typeof ambientPalettes)[];
  return ambientPalettes[keys[hash % keys.length]];
}

/** Paint a bounded texture once. The browser animates its transform during playback. */
export function paintAmbientPalette(ctx: CanvasRenderingContext2D, palette: AmbientPalette, title: string, variation: number) {
  const { colors } = resolveAmbientPalette(palette, title);
  ctx.filter = "none";
  ctx.fillStyle = "#03050c";
  ctx.fillRect(0, 0, 192, 108);
  const points = [[25, 22], [166, 30], [132, 98], [30, 95]];
  colors.forEach((color, i) => {
    const [x, y] = points[(i + variation) % points.length];
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 125);
    glow.addColorStop(0, color);
    glow.addColorStop(.4, `${color}b0`);
    glow.addColorStop(1, `${color}00`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 192, 108);
  });
}

/** Trim continuous near-black letterbox borders, without zooming a mostly dark scene. */
export function ambientFrameBounds(pixels: Uint8ClampedArray, width: number, height: number): FrameBounds {
  const dark = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) < 12;
  };
  const rowDark = (y: number) => { for (let x = 0; x < width; x++) if (!dark(x, y)) return false; return true; };
  const columnDark = (x: number) => { for (let y = 0; y < height; y++) if (!dark(x, y)) return false; return true; };
  let top = 0, bottom = height - 1, left = 0, right = width - 1;
  while (top < height / 4 && rowDark(top)) top++;
  while (bottom >= height * .75 && rowDark(bottom)) bottom--;
  while (left < width / 4 && columnDark(left)) left++;
  while (right >= width * .75 && columnDark(right)) right--;
  // Darkness should produce darkness, rather than magnify a tiny bright detail.
  if (top >= height / 4 || left >= width / 4 || bottom < height * .75 || right < width * .75) return { x: 0, y: 0, width, height };
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}
