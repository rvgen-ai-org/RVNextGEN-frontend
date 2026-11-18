"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import styles from "./PlayerSettingsSelect.module.css";

/** An in-panel picker, so options stay inside the player's scrolling settings card. */
export default function PlayerSettingsSelect<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const selected = Math.max(0, options.findIndex(option => option.value === value));
  const focusOption = (index: number) => root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[index]?.focus();
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    const active = Array.from(root.current?.querySelectorAll('[role="option"]') ?? []).indexOf(document.activeElement!);
    let next: number | undefined;
    if (event.key === "ArrowDown") next = (active + 1) % options.length;
    if (event.key === "ArrowUp") next = (active - 1 + options.length) % options.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = options.length - 1;
    if (next !== undefined) { event.preventDefault(); event.stopPropagation(); focusOption(next); }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === "Tab") setOpen(false);
    if (event.key.length === 1 && event.key !== " ") {
      const match = options.findIndex((option, index) => index > active && option.label.toLowerCase().startsWith(event.key.toLowerCase()));
      const first = options.findIndex(option => option.label.toLowerCase().startsWith(event.key.toLowerCase()));
      if (first >= 0) { event.preventDefault(); focusOption(match >= 0 ? match : first); }
    }
  };

  return <div ref={root} className={styles.picker} onKeyDown={onKeyDown} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <div className={styles.row}>
      <span id={`${id}-label`} className={styles.label}>{label}</span>
      <button ref={trigger} type="button" className={styles.trigger} aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => setOpen(current => !current)} onKeyDown={event => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); setOpen(true); }
        }}>
        <span>{options[selected]?.label}</span>
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={open ? styles.expanded : undefined}><path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
    {open && <div id={id} role="listbox" aria-labelledby={`${id}-label`} className={styles.options}>
      {options.map(option => <button key={option.value} type="button" role="option" aria-selected={option.value === value} tabIndex={-1} className={styles.option}
        onClick={() => { onChange(option.value); close(); }}>
        <span>{option.label}</span>
        {option.value === value && <svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><path d="m5 10 3.5 3.5L15 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </button>)}
    </div>}
  </div>;
}
