"use client";
import { useEffect, useMemo, useState } from "react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { ExternalLink, Settings2 } from "lucide-react";
import { useNetworkConnection } from "@/lib/client/network";
import { readBalances, useSwap, type SwapQuote } from "@/lib/client/swap";
import { SOL_MINT, compact, fromRaw, smallNumber, toRaw } from "@/lib/client/live";
import { APP_NETWORK, explorerTx } from "@/lib/shared/config";
import { Alert, Button, cn } from "../ui";

const BUY_PRESETS = ["0.01", "0.05", "0.1", "0.5", "1"];
const SELL_PRESETS = [25, 50, 75, 100];
const SLIPPAGES = [100, 500, 1000, 2000];

/** Buy / sell any Solana token from the connected wallet (Jupiter route, checked + simulated by Ryven). */
export function TradeBox({ mint, symbol, decimals: knownDecimals }: { mint: string; symbol: string; decimals?: number | null }) {
  const { setVisible } = useWalletModal();
  const conn = useNetworkConnection("mainnet");
  const { quote, execute, connected, publicKey } = useSwap();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("0.05");
  const [sellPct, setSellPct] = useState(50);
  const [slippage, setSlippage] = useState(500);
  const [showSettings, setShowSettings] = useState(false);
  const [bal, setBal] = useState<{ lamports: bigint; tokenRaw: bigint; tokenDecimals: number | null } | null>(null);
  const [q, setQ] = useState<SwapQuote | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string; sig?: string } | null>(null);
  const [tick, setTick] = useState(0);

  const decimals = bal?.tokenDecimals ?? knownDecimals ?? 6;

  // Balances (refresh after trades and every 15s).
  useEffect(() => {
    if (!publicKey) return;
    let stop = false;
    const load = () => readBalances(conn, publicKey, mint).then((b) => !stop && setBal(b)).catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [conn, publicKey, mint, tick]);

  // What goes in, in raw units.
  const input = useMemo(() => {
    if (side === "buy") {
      const raw = toRaw(amount, 9);
      return raw && raw > 0n ? { input: SOL_MINT, output: mint, amount: raw } : null;
    }
    if (!bal || bal.tokenRaw === 0n) return null;
    const raw = (bal.tokenRaw * BigInt(sellPct)) / 100n;
    return raw > 0n ? { input: mint, output: SOL_MINT, amount: raw } : null;
  }, [side, amount, sellPct, bal, mint]);

  // Live quote (debounced, refreshed every 10s).
  useEffect(() => {
    if (!input) {
      queueMicrotask(() => {
        setQ(null);
        setQErr(null);
      });
      return;
    }
    let stop = false;
    const run = () =>
      quote({ ...input, slippageBps: slippage })
        .then((r) => {
          if (stop) return;
          setQ(r);
          setQErr(null);
        })
        .catch((e) => !stop && setQErr((e as Error).message));
    const first = setTimeout(run, 350);
    const t = setInterval(run, 10_000);
    return () => {
      stop = true;
      clearTimeout(first);
      clearInterval(t);
    };
  }, [input, slippage, quote]);

  async function submit() {
    if (!connected) return setVisible(true);
    if (!input) return;
    setResult(null);
    try {
      const r = await execute({ ...input, slippageBps: slippage }, setBusy);
      setResult({
        ok: true,
        sig: r.signature,
        text:
          side === "buy"
            ? `Bought ≈${compact(fromRaw(r.quote.outAmount, decimals))} ${symbol}`
            : `Sold for ≈${smallNumber(fromRaw(r.quote.outAmount, 9))} SOL`,
      });
      setTick((x) => x + 1);
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  if (APP_NETWORK !== "mainnet") return <Alert tone="info">Trading is available on Solana mainnet.</Alert>;

  const solBal = bal ? fromRaw(bal.lamports, 9) : null;
  const tokBal = bal ? fromRaw(bal.tokenRaw, decimals) : null;
  const out = q ? (side === "buy" ? `${compact(fromRaw(q.outAmount, decimals))} ${symbol}` : `${smallNumber(fromRaw(q.outAmount, 9))} SOL`) : null;
  const impact = q?.priceImpactPct ? q.priceImpactPct * 100 : 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-panel-2 p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setSide(s);
              setResult(null);
            }}
            className={cn("rounded-lg py-2 text-sm font-semibold", side === s ? (s === "buy" ? "bg-accent text-black" : "bg-danger text-black") : "text-muted hover:text-text")}
          >
            {s === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      {side === "buy" ? (
        <div>
          <div className="mb-1 flex justify-between text-[11px] text-muted">
            <span>Amount (SOL)</span>
            {solBal !== null && (
              <button type="button" className="hover:text-text" onClick={() => setAmount(String(Math.max(0, Math.floor((solBal - 0.01) * 1e4) / 1e4)))}>
                Balance {smallNumber(solBal)} SOL
              </button>
            )}
          </div>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(",", "."))}
            className="w-full rounded-xl border border-line-2 bg-panel-2 px-3 py-2.5 font-mono text-lg outline-none focus:border-accent/60"
          />
          <div className="mt-2 grid grid-cols-5 gap-1">
            {BUY_PRESETS.map((p) => (
              <button key={p} type="button" onClick={() => setAmount(p)} className={cn("rounded-lg border py-1.5 font-mono text-xs", amount === p ? "border-accent/60 text-accent" : "border-line-2 text-muted hover:text-text")}>
                {p}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-1 flex justify-between text-[11px] text-muted">
            <span>Sell % of holdings</span>
            {tokBal !== null && <span>Balance {compact(tokBal)} {symbol}</span>}
          </div>
          <div className="grid grid-cols-4 gap-1">
            {SELL_PRESETS.map((p) => (
              <button key={p} type="button" onClick={() => setSellPct(p)} className={cn("rounded-lg border py-2 font-mono text-sm", sellPct === p ? "border-danger/60 text-danger" : "border-line-2 text-muted hover:text-text")}>
                {p}%
              </button>
            ))}
          </div>
          {connected && bal && bal.tokenRaw === 0n && <div className="mt-2 text-xs text-muted">You don&apos;t hold any {symbol}.</div>}
        </div>
      )}

      <div className="rounded-xl border border-line bg-panel-2 px-3 py-2 text-xs">
        <div className="flex justify-between">
          <span className="text-muted">You receive (est.)</span>
          <span className="font-mono">{out ?? (qErr ? "—" : input ? "…" : "—")}</span>
        </div>
        {q && (
          <>
            <div className="mt-1 flex justify-between text-muted">
              <span>Price impact</span>
              {/* Jupiter reports ~100% when it can't price a brand-new coin: show n/a rather than a misleading figure. */}
              <span className={cn("font-mono", impact > 5 && impact < 99.9 && "text-warn", impact > 15 && impact < 99.9 && "text-danger")}>
                {impact >= 99.9 ? "n/a" : `${impact.toFixed(2)}%`}
              </span>
            </div>
            <div className="mt-1 flex justify-between text-muted">
              <span>Route</span>
              <span className="truncate pl-3 text-right">{q.route.join(" → ")}</span>
            </div>
          </>
        )}
        <div className="mt-1 flex items-center justify-between text-muted">
          <span>Slippage</span>
          <button type="button" onClick={() => setShowSettings((s) => !s)} className="flex items-center gap-1 font-mono hover:text-text">
            {slippage / 100}% <Settings2 className="size-3" />
          </button>
        </div>
        {showSettings && (
          <div className="mt-2 grid grid-cols-4 gap-1">
            {SLIPPAGES.map((s) => (
              <button key={s} type="button" onClick={() => setSlippage(s)} className={cn("rounded-md border py-1 font-mono", slippage === s ? "border-accent/60 text-accent" : "border-line-2 text-muted")}>
                {s / 100}%
              </button>
            ))}
          </div>
        )}
        {qErr && <div className="mt-1 text-danger">{qErr}</div>}
      </div>

      <Button
        className="w-full"
        size="lg"
        variant={side === "buy" ? "primary" : "danger"}
        loading={!!busy}
        disabled={connected && (!input || !!qErr)}
        onClick={submit}
      >
        {!connected ? "Connect wallet" : busy ? busy : side === "buy" ? `Buy ${symbol}` : `Sell ${sellPct}% of ${symbol}`}
      </Button>

      {result && (
        <Alert tone={result.ok ? "accent" : "danger"}>
          {result.text}
          {result.sig && (
            <a href={explorerTx(result.sig, "mainnet")} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 underline">
              View <ExternalLink className="size-3" />
            </a>
          )}
        </Alert>
      )}
      <p className="text-[11px] leading-relaxed text-faint">
        Real SOL on Solana mainnet. Ryven checks every transaction before your wallet signs it: it can only swap your own funds, and a mainnet simulation
        must show you won&apos;t lose more than the amount you entered plus fees. Memecoins are extremely risky.
      </p>
    </div>
  );
}
