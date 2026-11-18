import Image, { type ImageProps } from "next/image";
import { artworkSources, type ArtworkAsset } from "@/lib/artwork";

/** Original artwork stays intact; Next.js caches responsive delivery copies. */
export default function ArtworkImage({ asset, alt, ...props }: Omit<ImageProps, "src"> & { asset: ArtworkAsset }) {
  return <Image {...props} alt={alt} src={artworkSources[asset]} quality={80} />;
}
