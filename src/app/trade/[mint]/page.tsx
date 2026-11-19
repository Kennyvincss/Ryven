"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Globe, MessageCircle, Send, ShieldAlert, ShieldCheck } from "lucide-react";
import { TradeView } from "@/components/live/trade-view";
import { AddressLink, Alert, Card, Stat, TokenImage, cn } from "@/components/ui";
import { age, compact, pct, usd, type LiveCoin } from "@/lib/client/live";

function useLiveToken(mint: string) {
  const [token, setToken] = useState<LiveCoin | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const r = await fetch(`/api/live/token/${mint}`);
        if (r.status === 404 || r.status === 400) {
          if (!stop) setState((s) => (s === "ready" ? s : "missing"));
          return;
        }
        if (!r.ok) throw new Error();
        const d = (await r.json()) as { token: LiveCoin };
        if (!stop) {
          setToken(d.token);
          setState("ready");
        }
      } catch {
        if (!stop) setState((s) => (s === "ready" ? s : "error"));
      }
    }
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [mint]);
  return { token, state };
}

export default function TradePage() {
  const { mint } = useParams<{ mint: string }>();
  const { token: t, state } = useLiveToken(mint);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const c = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(c);
  }, []);
  const symbol = t?.symbol ?? "token";
  const safe = t?.mintAuthorityDisabled !== false && t?.freezeAuthorityDisabled !== false;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <Link href="/live" className="mb-4 inline-flex items-center gap-1 text-xs text-muted hover:text-text">
        <ArrowLeft className="size-3.5" /> Live
      </Link>

      {state === "error" && !t && <Alert tone="danger">Market data is temporarily unavailable. Retrying…</Alert>}
      {state === "missing" && <Alert tone="warn">No market data for this token yet. If it was just created, give it a moment.</Alert>}

      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center">
        <TokenImage src={t?.icon} symbol={symbol} size={64} className="rounded-2xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{t?.name ?? "…"}</h1>
            <span className="font-mono text-muted">{t ? `$${t.symbol}` : ""}</span>
            {t && t.bondingCurve !== null && <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px] text-accent">On bonding curve</span>}
            {t && t.bondingCurve === null && t.graduatedAt && <span className="rounded-full border border-info/30 bg-info/10 px-2 py-0.5 text-[11px] text-info">Graduated</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <AddressLink address={mint} chars={6} network="mainnet" />
            {t?.createdAt && <span>Created {age(t.createdAt, now)} ago</span>}
            {t?.dev && (
              <span>
                Dev <AddressLink address={t.dev} network="mainnet" />
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2 text-muted">
          {t?.twitter && (
            <a href={t.twitter} target="_blank" rel="noreferrer" className="grid size-9 place-items-center rounded-xl border border-line-2 hover:text-text" aria-label="X / Twitter">
              <MessageCircle className="size-4" />
            </a>
          )}
          {t?.website && (
            <a href={t.website} target="_blank" rel="noreferrer" className="grid size-9 place-items-center rounded-xl border border-line-2 hover:text-text" aria-label="Website">
              <Globe className="size-4" />
            </a>
          )}
          {t?.telegram && (
            <a href={t.telegram} target="_blank" rel="noreferrer" className="grid size-9 place-items-center rounded-xl border border-line-2 hover:text-text" aria-label="Telegram">
              <Send className="size-4" />
            </a>
          )}
        </div>
      </div>

      {t && (
        <Card className="mb-4 grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Market cap" value={usd(t.mcap)} />
          <Stat label="Price" value={usd(t.priceUsd, { compact: false })} hint={t.change1h !== null ? <span className={t.change1h >= 0 ? "text-accent" : "text-danger"}>{pct(t.change1h)} 1h</span> : undefined} />
          <Stat label="Liquidity" value={usd(t.liquidity)} />
          <Stat label="Volume 24h" value={usd(t.volume24h)} />
          <Stat label="Holders" value={compact(t.holders)} />
          {t.bondingCurve !== null ? (
            <Stat label="Bonding curve" value={`${t.bondingCurve.toFixed(1)}%`} hint="to graduation" />
          ) : (
            <Stat label="Buys / sells 1h" value={`${t.buys1h ?? "—"} / ${t.sells1h ?? "—"}`} />
          )}
        </Card>
      )}

      {t && (
        <div className={cn("mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-4 py-2 text-xs", safe ? "border-line text-muted" : "border-danger/30 bg-danger/5 text-danger")}>
          <span className="inline-flex items-center gap-1 font-medium">
            {safe ? <ShieldCheck className="size-3.5 text-accent" /> : <ShieldAlert className="size-3.5" />} Safety
          </span>
          <span>Mint authority {t.mintAuthorityDisabled === false ? "ENABLED (supply can grow)" : "disabled"}</span>
          <span>Freeze authority {t.freezeAuthorityDisabled === false ? "ENABLED (can freeze you)" : "disabled"}</span>
          {t.topHoldersPct !== null && <span>Top 10 hold {t.topHoldersPct.toFixed(1)}%</span>}
          {t.devPct !== null && <span>Dev holds {t.devPct.toFixed(2)}%</span>}
        </div>
      )}

      <TradeView mint={mint} symbol={symbol} decimals={t?.decimals} />
    </div>
  );
}
