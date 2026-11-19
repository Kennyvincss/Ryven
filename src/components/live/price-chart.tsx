"use client";
import { useEffect, useRef, useState } from "react";
import { CandlestickSeries, ColorType, HistogramSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { cn } from "../ui";
import { smallNumber, type Candle } from "@/lib/client/live";

const INTERVALS = ["1s", "15s", "1m", "5m", "15m", "1h", "4h", "1d"] as const;
type Interval = (typeof INTERVALS)[number];
const REFRESH_MS: Record<Interval, number> = { "1s": 2000, "15s": 3000, "1m": 4000, "5m": 8000, "15m": 15000, "1h": 30000, "4h": 60000, "1d": 120000 };

const C = { bg: "#0a0c0f", grid: "#151920", text: "#8a90a2", up: "#c6ff3d", down: "#ff6b7a", line: "#1e2230" };

function fmtAxis(v: number, kind: "price" | "mcap") {
  if (kind === "mcap" || Math.abs(v) >= 1000) {
    return "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v);
  }
  return "$" + smallNumber(v);
}

/** Live candlestick chart (market cap or price, USD) with volume, refreshed automatically. */
export function PriceChart({ mint, height = 420 }: { mint: string; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const [interval, setIntervalKey] = useState<Interval>("1m");
  const [kind, setKind] = useState<"mcap" | "price">("mcap");
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [last, setLast] = useState<Candle | null>(null);

  // Create the chart once.
  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: C.bg }, textColor: C.text, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.line },
      timeScale: { borderColor: C.line, timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: 0 },
    });
    candles.current = c.addSeries(CandlestickSeries, {
      upColor: C.up,
      downColor: C.down,
      wickUpColor: C.up,
      wickDownColor: C.down,
      borderVisible: false,
      priceFormat: { type: "custom", minMove: 1e-12, formatter: (v: number) => fmtAxis(v, "mcap") },
    });
    volume.current = c.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.current = c;
    return () => {
      c.remove();
      chart.current = candles.current = volume.current = null;
    };
  }, []);

  // Load + poll candles for the selected interval / kind.
  useEffect(() => {
    let stop = false;
    let first = true;
    candles.current?.applyOptions({ priceFormat: { type: "custom", minMove: 1e-12, formatter: (v: number) => fmtAxis(v, kind) } });
    chart.current?.applyOptions({ timeScale: { secondsVisible: interval === "1s" || interval === "15s" } });
    queueMicrotask(() => !stop && setState("loading"));
    async function load() {
      try {
        const r = await fetch(`/api/live/chart/${mint}?interval=${interval}&kind=${kind}&candles=300`);
        if (!r.ok) throw new Error(String(r.status));
        const { candles: data } = (await r.json()) as { candles: Candle[] };
        if (stop || !candles.current || !volume.current) return;
        if (!data.length) {
          candles.current.setData([]);
          volume.current.setData([]);
          setLast(null);
          setState("empty");
          return;
        }
        candles.current.setData(data.map((d) => ({ time: d.time as UTCTimestamp, open: d.open, high: d.high, low: d.low, close: d.close })));
        volume.current.setData(
          data.map((d) => ({ time: d.time as UTCTimestamp, value: d.volume, color: d.close >= d.open ? "rgba(198,255,61,0.35)" : "rgba(255,107,122,0.35)" })),
        );
        if (first) {
          chart.current?.timeScale().fitContent();
          first = false;
        }
        setLast(data[data.length - 1]);
        setState("ready");
      } catch {
        if (!stop && first) setState("error");
      }
    }
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS[interval]);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [mint, interval, kind]);

  const change = last && last.open ? ((last.close - last.open) / last.open) * 100 : null;

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-white/[0.07] bg-[#07090b]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex flex-wrap gap-0.5">
          {INTERVALS.map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIntervalKey(i)}
              className={cn("rounded-md px-2 py-1 font-mono text-[11px]", interval === i ? "bg-panel-3 text-text" : "text-muted hover:text-text")}
            >
              {i}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {last && (
            <span className="font-mono text-[11px] text-muted">
              {fmtAxis(last.close, kind)}{" "}
              {change !== null && <span className={change >= 0 ? "text-accent" : "text-danger"}>{change >= 0 ? "+" : ""}{change.toFixed(2)}%</span>}
            </span>
          )}
          <div className="flex rounded-md border border-line-2 p-0.5">
            {(["mcap", "price"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)} className={cn("rounded px-2 py-0.5 text-[11px]", kind === k ? "bg-panel-3 text-text" : "text-muted hover:text-text")}>
                {k === "mcap" ? "Market cap" : "Price"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="relative" style={{ height }}>
        <div ref={box} className="absolute inset-0" />
        {state !== "ready" && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center text-xs text-muted">
            {state === "loading" ? "Loading chart…" : state === "empty" ? "No trades in this timeframe yet." : "Chart data is temporarily unavailable."}
          </div>
        )}
      </div>
    </div>
  );
}
