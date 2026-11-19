"use client";
/**
 * "Before you continue" notice in the Ryyven style (same language as the sign-in screen):
 * glass card, Volt icon chip, mono eyebrow, numbered timeline, and a Volt confirm toggle.
 */
import { Check, ShieldCheck } from "lucide-react";
import { cn } from "./ui";

export function RiskNotice({
  eyebrow = "Before you launch",
  title,
  items,
  checked,
  onChange,
  confirmLabel,
}: {
  eyebrow?: string;
  title: string;
  items: React.ReactNode[];
  checked: boolean;
  onChange: (v: boolean) => void;
  confirmLabel: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-[22px] border border-white/[0.08] bg-panel bg-gradient-to-b from-accent/[0.07] via-white/[0.02] to-transparent p-5">
      <div className="pointer-events-none absolute -top-16 left-1/2 h-32 w-2/3 -translate-x-1/2 rounded-full bg-accent/10 blur-3xl" aria-hidden />
      <div className="relative flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/25">
          <ShieldCheck className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="font-mono text-[10px] font-medium uppercase tracking-[0.26em] text-faint">{eyebrow}</div>
          <div className="mt-1 font-display text-[17px] font-semibold leading-snug text-text">{title}</div>
        </div>
      </div>

      <ol className="relative mt-4 space-y-2.5 pl-1">
        <span className="absolute bottom-3 left-[13px] top-3 w-px bg-white/10" aria-hidden />
        {items.map((it, i) => (
          <li key={i} className="relative flex items-start gap-3">
            <span className="relative z-10 grid size-[26px] shrink-0 place-items-center rounded-full border border-accent/35 bg-bg font-mono text-[10px] font-medium text-accent">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="pt-1 text-[13px] leading-relaxed text-text/80">{it}</span>
          </li>
        ))}
      </ol>

      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-4 flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left text-[13px] transition",
          checked ? "border-accent/45 bg-accent/[0.07] text-text" : "border-white/10 bg-white/[0.02] text-muted hover:border-white/20 hover:text-text",
        )}
      >
        <span
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-full border transition",
            checked ? "border-accent bg-accent text-black shadow-[0_0_14px_rgba(198,255,61,0.55)]" : "border-white/25",
          )}
        >
          {checked && <Check className="size-3" strokeWidth={3} />}
        </span>
        {confirmLabel}
      </button>
    </div>
  );
}
