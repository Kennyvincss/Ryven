"use client";
import { PriceChart } from "./price-chart";
import { TradeBox } from "./trade-box";
import { TradesFeed } from "./trades-feed";
import { Card, CardHeader } from "../ui";

/** Chart + trades + buy/sell for any Solana token (used by Live and token pages). */
export function TradeView({ mint, symbol, decimals }: { mint: string; symbol: string; decimals?: number | null }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-4">
        <PriceChart mint={mint} />
        <Card>
          <CardHeader title="Trades" subtitle="Live" />
          <TradesFeed mint={mint} />
        </Card>
      </div>
      <Card className="h-fit p-4">
        <TradeBox mint={mint} symbol={symbol} decimals={decimals} />
      </Card>
    </div>
  );
}
