"use client";

import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes } from "react";

/** Lightweight app chrome: translucent tint and highlights, without live refraction. */
export function GlassSurface({ children, className = "", regular = false, ...props }: HTMLAttributes<HTMLDivElement> & { regular?: boolean }) {
  return <div {...props} data-glass-surface className={`${regular ? "glass-surface-regular" : "glass-surface-clear"} ${className}`}>{children}</div>;
}

export const GlassButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { regular?: boolean; fullWidth?: boolean; wrapperClassName?: string }>(function GlassButton({ children, className = "", regular = false, fullWidth = false, wrapperClassName = "", ...props }, ref) {
  return <GlassSurface className={`glass-button pointer-events-auto inline-flex rounded-full ${fullWidth ? "w-full" : ""} ${wrapperClassName}`} regular={regular}>
    <button {...props} ref={ref} className={`relative z-10 ${className}`}>{children}</button>
  </GlassSurface>;
});
