export const artworkSources = {
  scene: "/images/image.png",
  "distant-desert": "/images/distant-desert.png",
  "foreground-dune": "/images/foreground-dune.png",
  sky: "/images/sky.jpeg",
  dunes: "/images/dunes_bg.jpeg",
  camel: "/images/camel_foreground.jpeg",
  "distant-desert-soft": "/images/optimized/distant-desert-soft.webp",
  "sky-soft": "/images/optimized/sky-soft.webp",
  "dunes-soft": "/images/optimized/dunes-soft.webp",
} as const;
export type ArtworkAsset = keyof typeof artworkSources;
