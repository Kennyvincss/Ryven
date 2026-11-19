import "server-only";
/**
 * Deleting an agent.
 *
 * The agent's signing key is destroyed with it, so nothing may be left where only that key can
 * reach it. Before deleting, the creator:
 *   1. empties the agent's trading wallet back to their own wallet (server signs, fixed destination);
 *   2. empties and closes each treasury (they own these; one wallet approval returns funds + rent).
 * The server re-reads both from Solana and refuses to delete while either still holds funds.
 * The coin itself is untouched; the creator can deploy a new agent for it later.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { connectionFor, readTreasuryState } from "./solana";
import { EngineError, assetLabel, ensureSolTreasury, ensureTokenTreasury, reconcileAgent } from "./engine/payments";
import { tradingWallet } from "./engine/trading";
import { fromBaseUnits } from "../shared/amounts";

type Agent = typeof schema.agents.$inferSelect;

/** Below this the trading wallet counts as empty (a network fee is 0.000005 SOL). */
export const TRADING_DUST_LAMPORTS = 10_000;

export type CloseoutTreasury = {
  asset: "usdc" | "sol" | "token";
  address: string;
  mint: string;
  tokenProgram: string;
  decimals: number;
  unit: string;
  exists: boolean;
  /** Display amount. */
  balance: string;
  /** Base units, as a string (the client builds the close transaction with it). */
  rawBalance: string;
};

export type Closeout = {
  treasuries: CloseoutTreasury[];
  tradingWallet: { address: string; sol: number; tokens: number };
  inFlight: number;
  /** What still blocks deletion (empty = ready). */
  blockers: string[];
};

async function allTreasuries(agent: Agent) {
  // Make sure every kind of treasury has a row, so none is overlooked.
  await Promise.all([ensureSolTreasury(agent).catch(() => null), ensureTokenTreasury(agent).catch(() => null)]);
  return db.select().from(schema.treasuries).where(eq(schema.treasuries.agentId, agent.id));
}

export async function agentCloseout(agent: Agent): Promise<Closeout> {
  await reconcileAgent(agent.id).catch(() => undefined);
  const conn = connectionFor(agent.network);
  const rows = await allTreasuries(agent);
  let states;
  let wallet;
  try {
    [states, wallet] = await Promise.all([Promise.all(rows.map((t) => readTreasuryState(t.address, conn))), tradingWallet(agent)]);
  } catch {
    throw new EngineError("Couldn't read balances from Solana right now. Please try again in a moment.", 503);
  }
  const [payments, trades] = await Promise.all([
    db
      .select({ id: schema.payments.id })
      .from(schema.payments)
      .where(and(eq(schema.payments.agentId, agent.id), inArray(schema.payments.status, ["executing"]))),
    db
      .select({ id: schema.agentTrades.id })
      .from(schema.agentTrades)
      .where(and(eq(schema.agentTrades.agentId, agent.id), eq(schema.agentTrades.status, "executing"))),
  ]);

  const treasuries: CloseoutTreasury[] = rows.map((t, i) => ({
    asset: t.asset,
    address: t.address,
    mint: t.mint,
    tokenProgram: t.tokenProgram,
    decimals: t.decimals,
    unit: assetLabel(t),
    exists: states[i].exists,
    balance: fromBaseUnits(states[i].balance, t.decimals),
    rawBalance: states[i].balance.toString(),
  }));
  const lamports = Math.round(wallet.sol * 1e9);
  const blockers: string[] = [];
  const inFlight = payments.length + trades.length;
  if (inFlight) blockers.push(`${inFlight} payment(s) or trade(s) are still being sent. Wait a minute and try again.`);
  if (wallet.tokens.length || lamports > TRADING_DUST_LAMPORTS) blockers.push("The agent's trading wallet still holds funds.");
  for (const t of treasuries) if (t.exists && t.rawBalance !== "0") blockers.push(`The ${t.unit} treasury still holds ${t.balance} ${t.unit}.`);
  return { treasuries, tradingWallet: { address: wallet.address, sol: wallet.sol, tokens: wallet.tokens.length }, inFlight, blockers };
}

/** Permanently deletes the agent (settings, signer key, history) once nothing of value is left behind. */
export async function deleteAgent(agent: Agent) {
  const c = await agentCloseout(agent);
  if (c.blockers.length) throw new EngineError(c.blockers.join(" "), 409);
  // Cascades remove the signer key, treasuries rows, payments, contributors, alerts, briefs, messages and trades.
  await db.delete(schema.agents).where(eq(schema.agents.id, agent.id));
}
