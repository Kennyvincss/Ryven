"use client";
import { useEffect, useRef, useState } from "react";
import { explorerAddress, explorerTx } from "@/lib/shared/config";
import { age, compact, usd, type LiveTrade } from "@/lib/client/live";
import { cn } from "../ui";

/** Latest trades of a token, refreshed every few seconds; new ones flash in. */
export function TradesFeed({ mint, refreshMs = 3000 }: { mint: string; refreshMs?: number }) {
  const [trades, setTrades] = useState<LiveTrade[] | null>(null);
  const known = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState(false);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const r = await fetch(`/api/live/trades/${mint}`);
        if (!r.ok) throw new Error();
        const d = (await r.json()) as { trades: LiveTrade[] };
        if (stop) return;
        // Highlight trades that weren't in the previous refresh (not on first load).
        const isFirst = known.current.size === 0;
        setFresh(new Set(isFirst ? [] : d.trades.filter((t) => !known.current.has(t.signature)).map((t) => t.signature)));
        for (const t of d.trades) known.current.add(t.signature);
        if (known.current.size > 2000) known.current = new Set(d.trades.map((t) => t.signature));
        setTrades(d.trades);
        setError(false);
      } catch {
        if (!stop) setError(true);
      }
    }
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), refreshMs);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop = true;
      clearInterval(t);
      clearInterval(clock);
    };
  }, [mint, refreshMs]);

  if (!trades) return <div className="px-4 py-6 text-center text-xs text-muted">{error ? "Trades are temporarily unavailable." : "Loading trades…"}</div>;
  if (!trades.length) return <div className="px-4 py-6 text-center text-xs text-muted">No trades yet.</div>;
  return (
    <div className="max-h-[420px] overflow-y-auto">
      <table className="w-full text-[12px]">
        <thead className="sticky top-0 bg-panel text-[10px] uppercase tracking-wider text-faint">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Age</th>
            <th className="px-3 py-2 text-left font-medium">Type</th>
            <th className="px-3 py-2 text-right font-medium">USD</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
            <th className="px-3 py-2 text-right font-medium">Trader</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {trades.map((t) => (
            <tr key={t.signature} className={cn("border-t border-line/60", fresh.has(t.signature) && "animate-flash")}>
              <td className="px-3 py-1.5 text-muted">
                <a href={explorerTx(t.signature, "mainnet")} target="_blank" rel="noreferrer" className="hover:text-text">
                  {age(t.time, now)}
                </a>
              </td>
              <td className={cn("px-3 py-1.5", t.side === "buy" ? "text-accent" : "text-danger")}>{t.side === "buy" ? "Buy" : "Sell"}</td>
              <td className={cn("px-3 py-1.5 text-right", t.side === "buy" ? "text-accent" : "text-danger")}>{usd(t.usd)}</td>
              <td className="px-3 py-1.5 text-right text-muted">{compact(t.amount)}</td>
              <td className="px-3 py-1.5 text-right">
                <a href={explorerAddress(t.trader, "mainnet")} target="_blank" rel="noreferrer" className="text-muted hover:text-text">
                  {t.trader.slice(0, 4)}…{t.trader.slice(-3)}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
