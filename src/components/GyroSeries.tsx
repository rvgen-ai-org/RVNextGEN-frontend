import { memo, type CSSProperties } from "react";
import ArtworkImage from "./ArtworkImage";
import type { ArtworkAsset } from "@/lib/artwork";

export const GYRO_SERIES = [
  { id: "desert", title: "A bond beyond words.", lead: "A bond", emphasis: "beyond", end: "words.", description: "A quiet journey across the desert brings an unexpected bond to life.", historyKey: "gyro-desert-recent-episodes" },
  { id: "camel", title: "Beyond the dunes.", lead: "Beyond", emphasis: "the", end: "dunes.", description: "Across shifting sands, a lone traveller follows the light of a restless sky.", historyKey: "gyro-camel-recent-episodes" },
] as const;

/**
 * Backend slugs the home artwork maps to, index-aligned with {@link GYRO_SERIES}. Overridable per
 * environment; the defaults match the seeded series (see backend `seed:home-series`). Single source
 * of truth for both the episode-grid fetch and the per-episode access/payment gate.
 */
export const seriesSlugs = [
  process.env.NEXT_PUBLIC_DESERT_SERIES_ID || "a-bond-beyond-words",
  process.env.NEXT_PUBLIC_CAMEL_SERIES_ID || "beyond-the-dunes",
];

function ArtLayer({ asset, className, position, style, gyro, x, y, card }: { asset: ArtworkAsset; className: string; position: string; style: CSSProperties; gyro: boolean; x: number; y: number; card: boolean }) {
  return <div data-gyro-layer={gyro || undefined} data-gyro-x={gyro ? x : undefined} data-gyro-y={gyro ? y : undefined} className={className} style={{ ...style, willChange: gyro ? "translate" : undefined }}>
    <ArtworkImage asset={asset} alt="" fill sizes={card ? "(max-width: 767px) 42vw, (max-width: 1024px) 32vw, 260px" : "100vw"} loading={gyro && !card ? "eager" : "lazy"} fetchPriority={gyro && !card ? "high" : "low"} className={`pointer-events-none object-cover ${position}`} />
  </div>;
}

export const SeriesArtwork = memo(function SeriesArtwork({ index, tilt = { x: 0, y: 0 }, focus = 0, drift = 0, motion = 1, gyro = false, card = false }: { index: number; tilt?: { x: number; y: number }; focus?: number; drift?: number; motion?: number; gyro?: boolean; card?: boolean }) {
  const x = (amount: number) => `${gyro ? 0 : tilt.x * amount * drift}px`;
  const y = (amount: number, offset = 0) => `${(gyro ? 0 : tilt.y * amount * drift) + offset}px`;
  const moving = gyro && drift > 0;
  const soft = focus > 0 && motion > 0 ? "-soft" : "";
  if (index === 1) return <div aria-hidden="true" className="absolute inset-0 isolate overflow-hidden bg-[#9a8998]">
    <ArtLayer asset={`sky${soft}`} gyro={moving} x={-.4 * drift} y={-.4 * drift} card={card} position="object-[60%_top]" className="absolute inset-[-40px]" style={{ transform: `translate3d(${x(-.4)},${y(-.4)},0) scale(${1.08 + focus * .12})` }} />
    <ArtLayer asset={`dunes${soft}`} gyro={moving} x={-.75 * drift} y={-.6 * drift} card={card} position="object-center" className="absolute inset-x-[-40px] top-[28%] bottom-[-40px] [mask-image:linear-gradient(to_bottom,transparent,black_25%)]" style={{ transform: `translate3d(${x(-.75)},${y(-.6)},0) scale(${1.05 + focus * .14})` }} />
    <ArtLayer asset="camel" gyro={moving} x={1.3 * drift} y={drift} card={card} position="object-[27%_bottom]" className="absolute inset-x-[-35px] top-[8%] bottom-[-25px] mix-blend-multiply" style={{ transform: `translate3d(${x(1.3)},${y(1)},0) scale(${1.03 + focus * .05})` }} />
  </div>;
  return <>
    <ArtLayer asset={`distant-desert${soft}`} gyro={moving} x={-.7 * drift} y={-.7 * drift} card={card} position="object-[58%_center]" className="absolute inset-[-48px]" style={{ transform: `translate3d(${x(-.7)},${y(-.7)},0) scale(${1.06 + focus * .24 * motion})` }} />
    <ArtLayer asset="foreground-dune" gyro={moving} x={1.25 * drift} y={drift} card={card} position={card ? "object-[10%_bottom]" : "object-[10%_bottom] sm:object-bottom lg:object-top"} className={`absolute inset-[-50px] origin-bottom scale-80 ${card ? "" : "lg:scale-100"}`} style={{ transform: `translate3d(${x(1.25)},${y(1, focus * 28 * motion)},0) scale(${1.04 + focus * .07 * motion})` }} />
  </>;
});
