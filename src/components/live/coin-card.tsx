"use client";
import Link from "next/link";
import { Globe, MessageCircle, Send, Users, Zap } from "lucide-react";
import { TokenImage, cn } from "../ui";
import { age, compact, usd, type LiveCoin } from "@/lib/client/live";

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-faint">{label}</span> <span className={cn("text-text", tone === "good" && "text-accent", tone === "bad" && "text-danger")}>{value}</span>
    </span>
  );
}

/** One coin in a Live column. Click opens its trading page; ⚡ buys instantly with the quick-buy amount. */
export function CoinCard({
  c,
  now,
  fresh,
  quickBuy,
  onQuickBuy,
  buying,
}: {
  c: LiveCoin;
  now: number;
  fresh: boolean;
  quickBuy: string;
  onQuickBuy: (c: LiveCoin) => void;
  buying: boolean;
}) {
  const graduated = c.bondingCurve === null;
  const topHigh = (c.topHoldersPct ?? 0) >= 30;
  const devHigh = (c.devPct ?? 0) >= 10;
  return (
    <div className={cn("group relative border-b border-line/70 px-3 py-2.5 hover:bg-panel-2", fresh && "animate-flash")}>
      <Link href={`/trade/${c.mint}`} className="absolute inset-0" aria-label={`Open ${c.symbol}`} />
      <div className="flex gap-3">
        <TokenImage src={c.icon} symbol={c.symbol} size={48} className="rounded-lg" />
        {/* right padding keeps every line clear of the ⚡ quick-buy button */}
        <div className="min-w-0 flex-1 pr-[4.5rem]">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-sm font-semibold">{c.symbol}</span>
            <span className="shrink-0 font-mono text-[11px] text-accent-2" title={graduated ? "Since graduation" : "Age"}>
              {age(graduated ? (c.graduatedAt ?? c.createdAt) : c.createdAt, now)}
            </span>
            <span className="truncate text-xs text-muted">{c.name}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px]">
            <Metric label="MC" value={usd(c.mcap)} />
            <Metric label="V" value={usd(c.volume1h)} />
            {c.holders !== null && (
              <span className="inline-flex items-center gap-0.5 text-text">
                <Users className="size-3 text-faint" />
                {compact(c.holders)}
              </span>
            )}
            {c.buys1h !== null && (
              <span>
                <span className="text-accent">{c.buys1h}</span>
                <span className="text-faint">/</span>
                <span className="text-danger">{c.sells1h ?? 0}</span>
              </span>
            )}
            {c.change1h !== null && <Metric label="1h" value={`${c.change1h > 0 ? "+" : ""}${c.change1h.toFixed(0)}%`} tone={c.change1h >= 0 ? "good" : "bad"} />}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10.5px]">
            {c.topHoldersPct !== null && <Metric label="Top10" value={`${c.topHoldersPct.toFixed(0)}%`} tone={topHigh ? "bad" : undefined} />}
            {c.devPct !== null && <Metric label="Dev" value={`${c.devPct.toFixed(1)}%`} tone={devHigh ? "bad" : undefined} />}
            {c.sniperPct !== null && c.sniperPct > 0 && <Metric label="Snipers" value={`${c.sniperPct.toFixed(0)}%`} tone={c.sniperPct >= 10 ? "bad" : undefined} />}
            <span className="relative z-10 flex items-center gap-1.5 text-faint">
              {c.twitter && (
                <a href={c.twitter} target="_blank" rel="noreferrer" className="hover:text-text" aria-label="X / Twitter">
                  <MessageCircle className="size-3" />
                </a>
              )}
              {c.website && (
                <a href={c.website} target="_blank" rel="noreferrer" className="hover:text-text" aria-label="Website">
                  <Globe className="size-3" />
                </a>
              )}
              {c.telegram && (
                <a href={c.telegram} target="_blank" rel="noreferrer" className="hover:text-text" aria-label="Telegram">
                  <Send className="size-3" />
                </a>
              )}
            </span>
          </div>
          {!graduated && c.bondingCurve !== null && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-panel-3">
                <div className={cn("h-full rounded-full", c.bondingCurve >= 85 ? "bg-warn" : "bg-accent")} style={{ width: `${c.bondingCurve}%` }} />
              </div>
              <span className="font-mono text-[10px] text-muted">{c.bondingCurve.toFixed(0)}%</span>
            </div>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onQuickBuy(c)}
        disabled={buying}
        className="absolute right-3 top-1/2 z-10 inline-flex -translate-y-1/2 items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-black opacity-90 hover:opacity-100 disabled:opacity-50"
        aria-label={`Buy ${quickBuy} SOL of ${c.symbol}`}
      >
        <Zap className="size-3" />
        {buying ? "…" : quickBuy}
      </button>
    </div>
  );
}
