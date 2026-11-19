import { and, desc, eq } from "drizzle-orm";
import { PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { db, schema } from "@/lib/server/db";
import { handler, json } from "@/lib/server/http";
import { agentStats, agentView, tokenView } from "@/lib/server/queries";
import { connection, mainnetConnection } from "@/lib/server/solana";
import { holderCount } from "@/lib/server/chain-reads";
import { getMarketData } from "@/lib/server/market";
import { EngineError } from "@/lib/server/engine/payments";
import { fromBaseUnits } from "@/lib/shared/amounts";

export const GET = handler(async (_req: Request, { params }: { params: Promise<{ mint: string }> }) => {
  const { mint } = await params;
  try {
    new PublicKey(mint);
  } catch {
    throw new EngineError("Not a valid token address", 404);
  }
  const token = await db.query.tokens.findFirst({ where: eq(schema.tokens.mint, mint) });
  if (!token) throw new EngineError("Token not found", 404);
  const agent = await db.query.agents.findFirst({ where: eq(schema.agents.tokenId, token.id) });
  const treasury = agent ? await db.query.treasuries.findFirst({ where: and(eq(schema.treasuries.agentId, agent.id), eq(schema.treasuries.asset, agent.primaryAsset)) }) : null;
  const stats = agent ? (await agentStats([agent.id])).get(agent.id) : undefined;
  const isMainnet = token.network === "mainnet";
  const conn = isMainnet ? mainnetConnection() : connection();
  const [onchain, holders, trades, market] = await Promise.all([
    getMint(conn, new PublicKey(mint), "confirmed", new PublicKey(token.tokenProgram)).catch(() => null),
    // Uses an indexed RPC when available, else rebuilds holders from recent transactions.
    holderCount(mint, new PublicKey(token.tokenProgram), conn),
    db.select().from(schema.tokenTrades).where(eq(schema.tokenTrades.tokenId, token.id)).orderBy(desc(schema.tokenTrades.blockTime)).limit(100),
    isMainnet ? getMarketData(mint).catch(() => null) : Promise.resolve(null),
  ]);
  return json({
    token: tokenView(token),
    onchain: onchain
      ? {
          supply: fromBaseUnits(onchain.supply, onchain.decimals),
          mintAuthority: onchain.mintAuthority?.toBase58() ?? null,
          freezeAuthority: onchain.freezeAuthority?.toBase58() ?? null,
        }
      : null,
    holders,
    market,
    trades: trades.map((t) => ({ ...t, blockTime: t.blockTime.toISOString() })),
    agent: agent ? agentView(agent, treasury, stats) : null,
  });
});

/** Waits on the AI and/or Solana confirmation: allow up to 5 minutes on serverless hosts (Vercel). */
export const maxDuration = 300;
