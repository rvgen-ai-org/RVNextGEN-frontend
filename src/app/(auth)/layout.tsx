import type { ReactNode } from "react";
import ArtworkImage from "@/components/ArtworkImage";

export default function AuthFlowLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative mx-auto h-dvh min-h-[560px] w-full max-w-[430px] overflow-hidden bg-[#0e0d0f] text-white lg:min-h-0 lg:max-w-none">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[62%] lg:inset-0 lg:h-full">
        <ArtworkImage asset="scene" alt="" fill sizes="100vw" preload className="object-cover object-top lg:object-center" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_52%,#0e0d0f_100%)] lg:hidden" />
        <div className="absolute inset-0 hidden bg-[linear-gradient(180deg,rgba(5,9,8,.32)_0%,rgba(5,9,8,.12)_39%,rgba(4,7,6,.68)_100%)] lg:block" />
      </div>
      <div className="relative z-10 h-full">{children}</div>
    </div>
  );
}
