"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Pause, Radio, Search, SlidersHorizontal, Zap } from "lucide-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { CoinCard } from "@/components/live/coin-card";
import { FilterPanel } from "@/components/live/filter-panel";
import { activeCount, cleanFilter, type ColumnFilter, type PulseFilters } from "@/lib/shared/live-filters";
import { Alert, cn } from "@/components/ui";
import { SOL_MINT, compact, fromRaw, toRaw, type LiveCoin, type Pulse } from "@/lib/client/live";
import { useSwap } from "@/lib/client/swap";
import { APP_NETWORK, explorerTx } from "@/lib/shared/config";

type ColumnKey = "newPairs" | "aboutToGraduate" | "graduated";
const COLUMNS: { key: ColumnKey; title: string; hint: string }[] = [
  { key: "newPairs", title: "New pairs", hint: "Just launched" },
  { key: "aboutToGraduate", title: "About to graduate", hint: "Bonding curve almost complete" },
  { key: "graduated", title: "Graduated", hint: "Moved to a DEX pool" },
];

const QB_KEY = "ryven:quickbuy";
const FILTERS_KEY = "ryven:live-filters";

function Column({
  column,
  filter,
  onFilter,
  title,
  hint,
  coins,
  now,
  quickBuy,
  onQuickBuy,
  buying,
  search,
  pending,
}: {
  title: string;
  hint: string;
  coins: LiveCoin[];
  now: number;
  quickBuy: string;
  onQuickBuy: (c: LiveCoin) => void;
  buying: string | null;
  search: string;
  column: ColumnKey;
  filter: ColumnFilter;
  onFilter: (f: ColumnFilter) => void;
  /** new filters applied, results not in yet */
  pending: boolean;
}) {
  const [showFilters, setShowFilters] = useState(false);
  const nFilters = activeCount(filter);
  // While the pointer is over a column its list is frozen, so cards don't jump under the cursor.
  const [hover, setHover] = useState(false);
  // The paused list remembers which filters it was taken under; a pause from before a filter change is ignored.
  const [frozen, setFrozen] = useState<{ key: string; coins: LiveCoin[] } | null>(null);
  const filterKey = JSON.stringify(filter);
  const known = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const paused = hover && !pending && !!frozen && frozen.key === filterKey;
  const shown = paused ? frozen.coins : coins;

  useEffect(() => {
    const first = known.current.size === 0;
    const next = new Set(first ? [] : coins.filter((c) => !known.current.has(c.mint)).map((c) => c.mint));
    for (const c of coins) known.current.add(c.mint);
    if (known.current.size > 3000) known.current = new Set(coins.map((c) => c.mint));
    queueMicrotask(() => setFresh(next));
  }, [coins]);

  const q = search.trim().toLowerCase();
  const list = q ? shown.filter((c) => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || c.mint.toLowerCase() === q) : shown;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-card)] border border-white/[0.07] bg-panel bg-gradient-to-b from-white/[0.035] to-white/[0.005]">
      <header className="flex items-center justify-between border-b border-line px-3 py-2.5">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-[11px] text-faint">{hint}</p>
        </div>
        <div className="flex items-center gap-2">
          {paused ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-warn">
              <Pause className="size-3" /> Paused
            </span>
          ) : (
            <span className="font-mono text-[11px] text-muted">{list.length}</span>
          )}
          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px]",
              nFilters ? "border-accent/50 text-accent" : "border-line-2 text-muted hover:text-text",
            )}
            aria-expanded={showFilters}
          >
            <SlidersHorizontal className="size-3" /> Filters{nFilters ? ` · ${nFilters}` : ""}
          </button>
        </div>
      </header>
      {showFilters && (
        <FilterPanel
          column={column}
          value={filter}
          onApply={(f) => {
            // show the new results right away, never a paused (stale) list
            setHover(false);
            setFrozen(null);
            onFilter(f);
          }}
          onClose={() => setShowFilters(false)}
        />
      )}
      {/* Pausing only applies while the pointer is over the coin list itself. */}
      <div
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto"
        onMouseEnter={() => {
          // never pause on a list that's about to be replaced by new filter results
          setFrozen(pending ? null : { key: filterKey, coins });
          setHover(true);
        }}
        onMouseLeave={() => {
          setHover(false);
          setFrozen(null);
        }}
      >
        {pending ? (
          <div className="px-4 py-10 text-center text-xs text-muted">Loading…</div>
        ) : list.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-muted">{q ? "No matches." : nFilters ? "No coins match these filters right now." : "Waiting for coins…"}</div>
        ) : (
          list.map((c) => <CoinCard key={c.mint} c={c} now={now} fresh={fresh.has(c.mint)} quickBuy={quickBuy} onQuickBuy={onQuickBuy} buying={buying === c.mint} />)
        )}
      </div>
    </section>
  );
}

export default function LivePage() {
  const [data, setData] = useState<Pulse | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [search, setSearch] = useState("");
  const [mobileCol, setMobileCol] = useState<ColumnKey>("newPairs");
  const [quickBuy, setQuickBuy] = useState("0.05");
  const [buying, setBuying] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string; sig?: string } | null>(null);
  const { execute, connected } = useSwap();
  const { setVisible } = useWalletModal();
  const [filters, setFilters] = useState<PulseFilters>({});
  const filtersRef = useRef<PulseFilters>({});
  const [reloadTick, setReloadTick] = useState(0);
  const [pendingCols, setPendingCols] = useState<Set<ColumnKey>>(new Set());

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FILTERS_KEY) ?? "{}") as PulseFilters;
      const clean: PulseFilters = { newPairs: cleanFilter(saved.newPairs), aboutToGraduate: cleanFilter(saved.aboutToGraduate), graduated: cleanFilter(saved.graduated) };
      filtersRef.current = clean;
      queueMicrotask(() => {
        setFilters(clean);
        setReloadTick((x) => x + 1);
      });
    } catch {
      // storage unavailable or corrupt: no saved filters
    }
  }, []);

  function setColumnFilter(col: ColumnKey, f: ColumnFilter) {
    const next = { ...filtersRef.current, [col]: f };
    filtersRef.current = next;
    setFilters(next);
    setPendingCols((p) => new Set([...p, col]));
    setReloadTick((x) => x + 1); // fetch right away instead of waiting for the next tick
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    try {
      const v = localStorage.getItem(QB_KEY);
      if (v && toRaw(v, 9)) queueMicrotask(() => setQuickBuy(v));
    } catch {
      // storage unavailable: keep the default
    }
  }, []);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const f = filtersRef.current;
        const filtered = activeCount(f.newPairs) + activeCount(f.aboutToGraduate) + activeCount(f.graduated) > 0;
        const r = filtered
          ? await fetch("/api/live/pulse", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) })
          : await fetch("/api/live/pulse");
        if (!r.ok) throw new Error();
        const d = (await r.json()) as Pulse;
        if (!stop) {
          setData(d);
          setError(false);
          setPendingCols(new Set());
        }
      } catch {
        if (!stop) setError(true);
      }
    }
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 3000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop = true;
      clearInterval(t);
      clearInterval(clock);
    };
  }, [reloadTick]);

  function saveQuickBuy(v: string) {
    const clean = v.replace(",", ".");
    setQuickBuy(clean);
    try {
      if (toRaw(clean, 9)) localStorage.setItem(QB_KEY, clean);
    } catch {
      // ignore
    }
  }

  async function onQuickBuy(c: LiveCoin) {
    if (!connected) return setVisible(true);
    const raw = toRaw(quickBuy, 9);
    if (!raw || raw <= 0n) return setToast({ ok: false, text: "Set a quick-buy amount in SOL first." });
    setBuying(c.mint);
    setToast({ ok: true, text: `Buying ${quickBuy} SOL of ${c.symbol}…` });
    try {
      // New coins move fast: 10% slippage for quick buys.
      const r = await execute({ input: SOL_MINT, output: c.mint, amount: raw, slippageBps: 1000 }, (s) => setToast({ ok: true, text: `${c.symbol}: ${s}` }));
      setToast({ ok: true, text: `Bought ≈${compact(fromRaw(r.quote.outAmount, c.decimals ?? 6))} ${c.symbol}`, sig: r.signature });
    } catch (e) {
      setToast({ ok: false, text: `${c.symbol}: ${(e as Error).message}` });
    } finally {
      setBuying(null);
    }
  }

  const cols = useMemo(() => COLUMNS.map((c) => ({ ...c, coins: data?.[c.key] ?? [] })), [data]);

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-3 flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.28em] text-accent">
            <span className="text-faint">Ryyven /</span> Live terminal
            <span className="ml-1 inline-flex items-center gap-1.5 text-accent">
              <span className="animate-pulse-dot size-1.5 rounded-full bg-accent" />
            </span>
          </div>
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight sm:text-4xl">
            <Radio className="size-6 text-accent" /> Live
          </h1>
          <p className="mt-2 text-[15px] text-muted">New coins as they launch, approach graduation and graduate. Updates every few seconds.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-xl border border-line-2 bg-panel-2 px-3 py-2">
            <Search className="size-4 text-faint" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by name or address" className="w-48 bg-transparent text-sm outline-none" />
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-line-2 bg-panel-2 px-3 py-2" title="Amount each ⚡ button buys">
            <Zap className="size-4 text-accent" />
            <span className="text-xs text-muted">Quick buy</span>
            <input inputMode="decimal" value={quickBuy} onChange={(e) => saveQuickBuy(e.target.value)} className="w-14 bg-transparent text-right font-mono text-sm outline-none" />
            <span className="text-xs text-muted">SOL</span>
          </label>
        </div>
      </div>

      {APP_NETWORK !== "mainnet" && <Alert tone="info">Live data is not available in test mode.</Alert>}
      {error && !data && <Alert tone="danger">Live data is temporarily unavailable. Retrying…</Alert>}
      {data?.partial && <Alert tone="warn">Showing new pairs only right now: the full live feed is temporarily unavailable.</Alert>}
      {toast && (
        <div className={cn("mb-3 flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-sm", toast.ok ? "border-accent/30 bg-accent/5" : "border-danger/30 bg-danger/5 text-danger")}>
          <span>
            {toast.text}
            {toast.sig && (
              <a href={explorerTx(toast.sig, "mainnet")} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 underline">
                View <ExternalLink className="size-3" />
              </a>
            )}
          </span>
          <button type="button" className="text-xs text-muted hover:text-text" onClick={() => setToast(null)}>
            Close
          </button>
        </div>
      )}

      {/* phones: one column at a time */}
      <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-panel-2 p-1 lg:hidden">
        {COLUMNS.map((c) => (
          <button key={c.key} type="button" onClick={() => setMobileCol(c.key)} className={cn("rounded-lg py-2 text-xs font-medium", mobileCol === c.key ? "bg-panel-3 text-text" : "text-muted")}>
            {c.title}
          </button>
        ))}
      </div>

      <div className="grid h-[calc(100vh-220px)] min-h-[520px] grid-cols-1 gap-3 lg:grid-cols-3">
        {cols.map((c) => (
          <div key={c.key} className={cn("min-h-0 min-w-0", mobileCol === c.key ? "flex" : "hidden", "flex-col lg:flex")}>
            <Column column={c.key} filter={filters[c.key] ?? {}} onFilter={(f) => setColumnFilter(c.key, f)} title={c.title} hint={c.hint} coins={c.coins} now={now} quickBuy={quickBuy} onQuickBuy={onQuickBuy} buying={buying} search={search} pending={pendingCols.has(c.key)} />
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-faint">
        Up to 30 coins per column (the data source&apos;s limit); filters search the whole market. Market data: Jupiter. Buys and sells are real SOL from your wallet; Ryyven checks and simulates every transaction before you sign. Memecoins are extremely risky
        and many go to zero.
      </p>
    </div>
  );
}
