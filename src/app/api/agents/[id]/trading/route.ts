import { requireCreator } from "@/lib/server/agents";
import { listTrades, tradeView, tradingSnapshot, tradingWallet } from "@/lib/server/engine/trading";
import { handler, json } from "@/lib/server/http";

/** Creator-only: trading settings, the agent's mainnet trading wallet, and trades. */
export const GET = handler(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { agent } = await requireCreator(id);
  const [trades, snap, wallet] = await Promise.all([
    listTrades(id),
    tradingSnapshot(id),
    tradingWallet(agent).catch((e: Error) => ({ error: e.message })),
  ]);
  return json({
    settings: {
      mode: agent.tradingMode,
      maxSolPerTrade: Number(agent.tradeMaxSol) / 1e9,
      dailySol: Number(agent.tradeDailySol) / 1e9,
      mints: agent.tradeMints,
    },
    spentTodaySol: Number(snap.spentTodayLamports) / 1e9,
    wallet:
      "error" in wallet
        ? { address: agent.signerPubkey, error: wallet.error }
        : { address: wallet.address, sol: wallet.sol, tokens: wallet.tokens.map((t) => ({ mint: t.mint, amount: t.amount })) },
    trades: trades.map(tradeView),
  });
});
