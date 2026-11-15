import { desc, eq } from "drizzle-orm";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getMint } from "@solana/spl-token";
import { db, schema } from "@/lib/server/db";
import { handler, json } from "@/lib/server/http";
import { agentStats, agentView, tokenView } from "@/lib/server/queries";
import { connection, mainnetConnection } from "@/lib/server/solana";
import { EngineError } from "@/lib/server/engine/payments";
import { fromBaseUnits } from "@/lib/shared/amounts";

const holderCache = new Map<string, { n: number; at: number }>();

async function holderCount(mint: string): Promise<number | null> {
  const c = holderCache.get(mint);
  if (c && Date.now() - c.at < 60_000) return c.n;
  try {
    const accounts = await connection().getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
      commitment: "confirmed",
      dataSlice: { offset: 64, length: 8 }, // amount field
      filters: [{ memcmp: { offset: 0, bytes: mint } }],
    });
    const n = accounts.filter((a) => a.account.data.length === 8 && a.account.data.readBigUInt64LE(0) > 0n).length;
    holderCache.set(mint, { n, at: Date.now() });
    return n;
  } catch {
    return null;
  }
}

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
  const treasury = agent ? await db.query.treasuries.findFirst({ where: eq(schema.treasuries.agentId, agent.id) }) : null;
  const stats = agent ? (await agentStats([agent.id])).get(agent.id) : undefined;
  const isMainnet = token.network === "mainnet";
  const conn = isMainnet ? mainnetConnection() : connection();
  const [onchain, holders, trades] = await Promise.all([
    getMint(conn, new PublicKey(mint), "confirmed", new PublicKey(token.tokenProgram)).catch(() => null),
    // Counting holders needs getProgramAccounts, which public mainnet RPC doesn't allow.
    isMainnet ? Promise.resolve(null) : holderCount(mint),
    db.select().from(schema.tokenTrades).where(eq(schema.tokenTrades.tokenId, token.id)).orderBy(desc(schema.tokenTrades.blockTime)).limit(100),
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
    trades: trades.map((t) => ({ ...t, blockTime: t.blockTime.toISOString() })),
    agent: agent ? agentView(agent, treasury, stats) : null,
  });
});
