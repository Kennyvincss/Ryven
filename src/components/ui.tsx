"use client";
import Link from "next/link";
import { forwardRef, useState } from "react";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { explorerAddress, explorerTx, type Network } from "@/lib/shared/config";
import { shortAddress } from "@/lib/shared/amounts";

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-[var(--radius-card)] border border-white/[0.07] bg-panel bg-gradient-to-b from-white/[0.035] to-white/[0.005] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, right, icon }: { title: React.ReactNode; subtitle?: React.ReactNode; right?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
      <div className="flex min-w-0 items-center gap-3">
        {icon && <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20">{icon}</div>}
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "agent";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  href?: string;
};
const btnBase = "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap";
const btnVariants = {
  primary: "bg-gradient-to-b from-[#d6ff70] to-accent font-semibold text-black shadow-[0_8px_28px_-10px_rgba(198,255,61,0.65)] hover:brightness-105",
  secondary: "border border-white/10 bg-white/[0.04] text-text hover:border-white/20 hover:bg-white/[0.08]",
  ghost: "text-muted hover:bg-white/[0.05] hover:text-text",
  danger: "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
  agent: "bg-agent font-semibold text-black hover:brightness-110",
};
const btnSizes = { sm: "h-8 px-3 text-xs", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-[15px]" };

export function Button({ variant = "primary", size = "md", loading, className, children, href, ...rest }: BtnProps) {
  const cls = cn(btnBase, btnVariants[variant], btnSizes[size], className);
  if (href) return <Link href={href} className={cls}>{children}</Link>;
  return (
    <button className={cls} disabled={loading || rest.disabled} {...rest}>
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Badge({ tone = "neutral", children, className, dot }: { tone?: "neutral" | "accent" | "agent" | "warn" | "danger" | "info"; children: React.ReactNode; className?: string; dot?: boolean }) {
  const tones = {
    neutral: "border-line-2 bg-panel-2 text-muted",
    accent: "border-accent/30 bg-accent/10 text-accent",
    agent: "border-agent/30 bg-agent/10 text-agent",
    warn: "border-warn/30 bg-warn/10 text-warn",
    danger: "border-danger/30 bg-danger/10 text-danger",
    info: "border-info/30 bg-info/10 text-info",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em]", tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Stat({ label, value, hint, accent }: { label: string; value: React.ReactNode; hint?: React.ReactNode; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-faint">{label}</div>
      <div className={cn("mt-1.5 truncate font-mono text-xl font-semibold tabular-nums", accent && "text-accent")}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-muted">{hint}</div>}
    </div>
  );
}

const fieldCls = "w-full rounded-xl border border-white/[0.08] bg-[#0c0f13] px-3.5 py-2.5 text-sm text-text placeholder:text-faint outline-none transition focus:border-accent/60 focus:ring-4 focus:ring-accent/10";
export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(fieldCls, className)} {...p} />;
});
export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldCls, "min-h-[84px] resize-y", className)} {...p} />;
}
export function Select({ className, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldCls, "appearance-none", className)} {...p}>
      {children}
    </select>
  );
}
export function Field({ label, hint, children, error }: { label: string; hint?: React.ReactNode; children: React.ReactNode; error?: string | null }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-text">{label}</span>
        {hint && <span className="text-[11px] text-faint">{hint}</span>}
      </div>
      {children}
      {error && <div className="mt-1 text-xs text-danger">{error}</div>}
    </label>
  );
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { id: T; label: React.ReactNode }[]; className?: string }) {
  return (
    <div className={cn("scrollbar-thin flex gap-1 overflow-x-auto rounded-2xl border border-white/[0.07] bg-white/[0.02] p-1", className)}>
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => onChange(it.id)}
          className={cn(
            "shrink-0 rounded-xl px-3 py-1.5 text-[13px] font-medium transition",
            value === it.id ? "bg-accent text-black shadow-[0_4px_18px_-8px_rgba(198,255,61,0.7)]" : "text-muted hover:bg-white/[0.04] hover:text-text",
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 grid size-12 place-items-center rounded-2xl bg-accent/10 text-accent shadow-[0_0_40px_-8px_rgba(198,255,61,0.5)] ring-1 ring-accent/25">{icon}</div>}
      <div className="font-display text-base font-semibold">{title}</div>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-muted", className)} />;
}

export function Alert({ tone = "info", title, children }: { tone?: "info" | "warn" | "danger" | "accent"; title?: string; children: React.ReactNode }) {
  const tones = {
    info: "border-info/25 bg-info/[0.06] text-info",
    warn: "border-warn/25 bg-warn/[0.06] text-warn",
    danger: "border-danger/25 bg-danger/[0.06] text-danger",
    accent: "border-accent/25 bg-accent/[0.06] text-accent",
  };
  return (
    <div className={cn("rounded-xl border px-4 py-3 text-sm", tones[tone])}>
      {title && <div className="mb-0.5 font-semibold">{title}</div>}
      <div className="text-text/80">{children}</div>
    </div>
  );
}

export function CopyButton({ value, className }: { value: string; className?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setOk(true);
        setTimeout(() => setOk(false), 1200);
      }}
      className={cn("text-faint transition hover:text-text", className)}
      aria-label="Copy"
    >
      {ok ? <Check className="size-3.5 text-accent" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export function AddressLink({ address, chars = 4, className, network }: { address: string; chars?: number; className?: string; network?: Network }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-xs", className)}>
      <a href={explorerAddress(address, network)} target="_blank" rel="noreferrer" className="text-muted hover:text-text">
        {shortAddress(address, chars)}
      </a>
      <CopyButton value={address} />
    </span>
  );
}

export function TxLink({ signature, label, network }: { signature: string; label?: string; network?: Network }) {
  return (
    <a
      href={explorerTx(signature, network)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs text-info hover:underline"
    >
      {label ?? shortAddress(signature, 6)}
      <ExternalLink className="size-3" />
    </a>
  );
}

/** Deterministic generated avatar for agents (no external images). */
export function AgentAvatar({ seed, size = 40, className }: { seed: string; size?: number; className?: string }) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const h1 = h % 360;
  const h2 = (h1 + 60 + ((h >> 8) % 120)) % 360;
  const eyes = (h >> 4) % 3;
  return (
    <div
      className={cn("relative shrink-0 overflow-hidden rounded-[30%] ring-1 ring-white/10", className)}
      style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${h1} 85% 62%), hsl(${h2} 75% 45%))` }}
    >
      <svg viewBox="0 0 40 40" className="absolute inset-0 size-full">
        <rect x="9" y="13" width="22" height="15" rx="6" fill="rgba(0,0,0,.55)" />
        {eyes === 0 && (<><circle cx="16" cy="20.5" r="2.4" fill="#fff" /><circle cx="24" cy="20.5" r="2.4" fill="#fff" /></>)}
        {eyes === 1 && (<><rect x="13.5" y="19" width="5" height="3" rx="1.5" fill="#fff" /><rect x="21.5" y="19" width="5" height="3" rx="1.5" fill="#fff" /></>)}
        {eyes === 2 && <rect x="13" y="19" width="14" height="3" rx="1.5" fill="#fff" />}
        <rect x="19" y="7" width="2" height="6" rx="1" fill="rgba(0,0,0,.45)" />
        <circle cx="20" cy="7" r="2" fill="rgba(255,255,255,.85)" />
      </svg>
    </div>
  );
}

export function TokenImage({ src, symbol, size = 44, className }: { src?: string | null; symbol: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={cn("grid shrink-0 place-items-center rounded-xl bg-panel-3 font-mono text-xs font-bold text-muted", className)} style={{ width: size, height: size }}>
        {(size < 28 ? symbol.slice(0, 1) : symbol.slice(0, 3)).toUpperCase()}
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={symbol} onError={() => setFailed(true)} className={cn("shrink-0 rounded-xl object-cover", className)} style={{ width: size, height: size }} />;
}

export function PageHeader({ title, subtitle, right, eyebrow }: { title: React.ReactNode; subtitle?: React.ReactNode; right?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-3 flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.28em] text-accent">
            <span className="text-faint">Ryven /</span> {eyebrow}
          </div>
        )}
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-[15px] text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function timeAgo(iso: string | Date) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
