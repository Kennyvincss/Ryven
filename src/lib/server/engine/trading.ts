import "server-only";
/**
 * Agent trading on pump.fun (Solana MAINNET, real SOL).
 *
 *  proposal mode   → the agent proposes; the CREATOR signs each trade in their own wallet.
 *  autonomous mode → the agent trades from its own small trading wallet (its signer key on
 *                    mainnet), funded by the creator, within strict limits.
 *
 * Every trade, in both modes: deterministic policy → PumpPortal tx → program allowlist →
 * mainnet simulation that measures the real SOL spend → send → confirm → record.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { PublicKey, VersionedTransaction, type ParsedAccountData } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { db, schema } from "../db";
import { mainnetConnection } from "../solana";
import { PumpFunError, buildTradeTransaction, sendAndConfirmMainnet, simulateSpend, solDeltaOf, validateTradeTransaction, type TradeRequest } from "../pumpfun";
import { BASE_SWAP_MINTS, SOL_MINT, SwapError, buildSwapTransaction, getQuote, mintInfo, resolveMint, simulateSwapSpend, symbolOf, validateSwapTransaction, type Quote } from "../jupiter";
import { solUsd } from "../market";
import { signAgentSwap, signAgentTrade, signTradingWalletWithdrawal } from "../signer";
import { evaluateTrade, type TradeProposal, type TradingPolicy } from "./trade-policy";
import { fromBaseUnits, toBaseUnits } from "../../shared/amounts";
import { EngineError, isPlatformPaused, startOfUtcDay } from "./payments";
import { logActivity } from "./activity";

type Agent = typeof schema.agents.$inferSelect;
export type Trade = typeof schema.agentTrades.$inferSelect;

const sol = (lamports: bigint) => `${Number(lamports) / 1e9} SOL`;
const short = (m: string) => `${m.slice(0, 4)}…${m.slice(-4)}`;

/** The agent's own coin (if it's on mainnet) is always on the allowlist. */
async function toTradingPolicy(a: Agent): Promise<TradingPolicy> {
  const own = await db.query.tokens.findFirst({ where: eq(schema.tokens.id, a.tokenId) });
  const mints = own?.network === "mainnet" && !a.tradeMints.includes(own.mint) ? [...a.tradeMints, own.mint] : a.tradeMints;
  const swapMints = [...new Set([...mints, ...BASE_SWAP_MINTS])];
  return { agentStatus: a.status, mode: a.tradingMode, maxSolPerTrade: a.tradeMaxSol, dailySol: a.tradeDailySol, mints, swapMints };
}

const proposalOf = (t: Trade): TradeProposal => ({ action: t.action, mint: t.mint, amount: t.amount, inputMint: t.inputMint, inputIsSol: t.inputMint === SOL_MINT });

async function spentToday(agentId: string) {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${schema.agentTrades.amount}), 0)::text` })
    .from(schema.agentTrades)
    .where(
      and(
        eq(schema.agentTrades.agentId, agentId),
        inArray(schema.agentTrades.action, ["buy", "swap"]),
        inArray(schema.agentTrades.status, ["executing", "confirmed"]),
        gte(schema.agentTrades.reservedAt, startOfUtcDay()),
      ),
    );
  return BigInt(row.total);
}

function tradeRequest(t: Pick<Trade, "action" | "mint" | "amount">, wallet: string): TradeRequest {
  if (t.action === "swap") throw new EngineError("Not a pump.fun trade", 500);
  return { wallet, action: t.action, mint: t.mint, amount: t.action === "buy" ? Number(t.amount) / 1e9 : Number(t.amount) };
}

async function loadAgentRow(agentId: string) {
  const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, agentId) });
  if (!agent) throw new EngineError("Agent not found", 404);
  return agent;
}

/** The agent proposes (proposal mode) or executes (autonomous mode) a trade. */
export async function proposeTrade(args: {
  agentId: string;
  instructionId: string;
  action: "buy" | "sell";
  mint: string;
  /** buy: lamports. sell: percent 1-100. */
  amount: bigint;
  reason: string;
}): Promise<{ trade: Trade; duplicate: boolean }> {
  const agent = await loadAgentRow(args.agentId);
  const idempotencyKey = createHash("sha256").update(`trade|${args.agentId}|${args.instructionId}|${args.action}|${args.mint}`).digest("hex");
  const existing = await db.query.agentTrades.findFirst({ where: eq(schema.agentTrades.idempotencyKey, idempotencyKey) });
  if (existing) return { trade: existing, duplicate: true };

  const autonomous = agent.tradingMode === "autonomous";
  const wallet = autonomous ? agent.signerPubkey : agent.creatorWallet;
  const [globalPause, today, walletLamports] = await Promise.all([
    isPlatformPaused(),
    spentToday(agent.id),
    autonomous ? mainnetConnection().getBalance(new PublicKey(wallet), "confirmed").then(BigInt).catch(() => null) : Promise.resolve(undefined),
  ]);
  const decision = evaluateTrade(await toTradingPolicy(agent), { action: args.action, mint: args.mint, amount: args.amount }, { globalPause, spentToday: today, walletLamports });
  const status: Trade["status"] = decision.decision === "reject" ? "rejected" : decision.decision === "needs_approval" ? "awaiting_signature" : "executing";

  const [trade] = await db
    .insert(schema.agentTrades)
    .values({
      agentId: agent.id,
      idempotencyKey,
      instructionId: args.instructionId,
      mode: agent.tradingMode,
      action: args.action,
      mint: args.mint,
      amount: args.amount,
      reason: args.reason,
      wallet,
      status,
      policy: decision,
      reservedAt: status === "executing" ? new Date() : null,
      error: status === "rejected" ? decision.summary : null,
    })
    .returning();

  const what = args.action === "buy" ? `buy ${sol(args.amount)} of ${short(args.mint)}` : `sell ${args.amount}% of ${short(args.mint)}`;
  await logActivity({
    agentId: agent.id,
    instructionId: args.instructionId,
    type: "trade_policy",
    status: status === "rejected" ? "failed" : status === "awaiting_signature" ? "awaiting_approval" : "checking_permissions",
    message:
      status === "rejected"
        ? `Rejected trade (${what}): ${decision.summary}`
        : status === "awaiting_signature"
          ? `Proposed trade: ${what}. Waiting for the creator to sign`
          : `Policy approved autonomous trade: ${what}`,
    data: { tradeId: trade.id },
  });

  if (status === "executing") return { trade: await executeAutonomousTrade(trade, agent), duplicate: false };
  return { trade, duplicate: false };
}

function swapAmountText(t: Trade) {
  const inAmt = t.inputAmount !== null ? fromBaseUnits(t.inputAmount, t.inputDecimals ?? 0) : "?";
  return `${inAmt} ${symbolOf(t.inputMint ?? "")} → ${symbolOf(t.mint)} (≈${Number(t.amount) / 1e9} SOL)`;
}

function describe(t: Trade) {
  if (t.action === "swap") return `swap ${swapAmountText(t)}`;
  return t.action === "buy" ? `buy ${sol(t.amount)} of ${short(t.mint)}` : `sell ${t.amount}% of ${short(t.mint)}`;
}

/** Fresh Jupiter quote for a stored swap (same input mint and amount as proposed). */
async function swapQuoteFor(t: Trade): Promise<Quote> {
  if (!t.inputMint || t.inputAmount === null) throw new EngineError("Swap is missing its input", 500);
  return getQuote(t.inputMint, t.mint, t.inputAmount);
}

/** Amount of `mint` the wallet received in a confirmed transaction (SOL: lamport change + fees). */
async function receivedOf(signature: string, wallet: string, mint: string): Promise<bigint | null> {
  const tx = await mainnetConnection().getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx?.meta) return null;
  if (mint === SOL_MINT) return BigInt(tx.meta.postBalances[0]) - BigInt(tx.meta.preBalances[0]) + BigInt(tx.meta.fee);
  const pick = (list: typeof tx.meta.postTokenBalances) =>
    BigInt(list?.find((b) => b.owner === wallet && b.mint === mint)?.uiTokenAmount.amount ?? "0");
  return pick(tx.meta.postTokenBalances) - pick(tx.meta.preTokenBalances);
}

/**
 * The agent proposes (proposal mode) or executes (autonomous mode) a token swap through
 * Jupiter. `amount` is in INPUT token units (e.g. "0.1" SOL, "25" USDC). The trading limits
 * apply to the swap's value in SOL.
 */
export async function proposeSwap(args: {
  agentId: string;
  instructionId: string;
  input: string;
  output: string;
  amount: string;
  reason: string;
}): Promise<{ trade: Trade; duplicate: boolean }> {
  const agent = await loadAgentRow(args.agentId);
  let inputMint: string, outputMint: string, inDec: number, outDec: number, amountRaw: bigint, quote: Quote;
  try {
    inputMint = resolveMint(args.input);
    outputMint = resolveMint(args.output);
    if (inputMint === outputMint) throw new SwapError("Input and output tokens are the same");
    [{ decimals: inDec }, { decimals: outDec }] = await Promise.all([mintInfo(inputMint), mintInfo(outputMint)]);
    amountRaw = toBaseUnits(args.amount, inDec);
    if (amountRaw <= 0n) throw new SwapError("Amount must be greater than zero");
    quote = await getQuote(inputMint, outputMint, amountRaw);
  } catch (e) {
    if (e instanceof SwapError) throw new EngineError(e.message, 400);
    if (e instanceof Error && /decimal|amount/i.test(e.message)) throw new EngineError(`Invalid amount: ${e.message}`, 400);
    throw e;
  }

  // Value of the swap in lamports, for the SOL limits.
  let valueLamports: bigint;
  if (inputMint === SOL_MINT) valueLamports = BigInt(quote.inAmount);
  else if (outputMint === SOL_MINT) valueLamports = BigInt(quote.outAmount);
  else {
    const usd = Number(quote.swapUsdValue ?? NaN);
    const px = await solUsd().catch(() => null);
    if (!Number.isFinite(usd) || !px?.price) throw new EngineError("Couldn't price this swap in SOL, so the trading limits can't be checked. Try a swap to or from SOL.", 400);
    valueLamports = BigInt(Math.ceil((usd / px.price) * 1e9));
  }

  const idempotencyKey = createHash("sha256").update(`swap|${args.agentId}|${args.instructionId}|${inputMint}|${outputMint}|${amountRaw}`).digest("hex");
  const existing = await db.query.agentTrades.findFirst({ where: eq(schema.agentTrades.idempotencyKey, idempotencyKey) });
  if (existing) return { trade: existing, duplicate: true };

  const autonomous = agent.tradingMode === "autonomous";
  const wallet = autonomous ? agent.signerPubkey : agent.creatorWallet;
  const [globalPause, today, walletLamports] = await Promise.all([
    isPlatformPaused(),
    spentToday(agent.id),
    autonomous ? mainnetConnection().getBalance(new PublicKey(wallet), "confirmed").then(BigInt).catch(() => null) : Promise.resolve(undefined),
  ]);
  const decision = evaluateTrade(
    await toTradingPolicy(agent),
    { action: "swap", mint: outputMint, amount: valueLamports, inputMint, inputIsSol: inputMint === SOL_MINT },
    { globalPause, spentToday: today, walletLamports },
  );
  const status: Trade["status"] = decision.decision === "reject" ? "rejected" : decision.decision === "needs_approval" ? "awaiting_signature" : "executing";

  const [trade] = await db
    .insert(schema.agentTrades)
    .values({
      agentId: agent.id,
      idempotencyKey,
      instructionId: args.instructionId,
      mode: agent.tradingMode,
      action: "swap",
      mint: outputMint,
      amount: valueLamports,
      inputMint,
      inputAmount: amountRaw,
      inputDecimals: inDec,
      outputDecimals: outDec,
      quotedOut: BigInt(quote.outAmount),
      reason: args.reason,
      wallet,
      status,
      policy: decision,
      reservedAt: status === "executing" ? new Date() : null,
      error: status === "rejected" ? decision.summary : null,
    })
    .returning();

  const what = describe(trade);
  await logActivity({
    agentId: agent.id,
    instructionId: args.instructionId,
    type: "trade_policy",
    status: status === "rejected" ? "failed" : status === "awaiting_signature" ? "awaiting_approval" : "checking_permissions",
    message:
      status === "rejected"
        ? `Rejected ${what}: ${decision.summary}`
        : status === "awaiting_signature"
          ? `Proposed ${what}. Waiting for the creator to sign`
          : `Policy approved autonomous ${what}`,
    data: { tradeId: trade.id },
  });

  if (status === "executing") return { trade: await executeAutonomousTrade(trade, agent), duplicate: false };
  return { trade, duplicate: false };
}

async function failTrade(trade: Trade, error: string) {
  const [t] = await db.update(schema.agentTrades).set({ status: "failed", error }).where(eq(schema.agentTrades.id, trade.id)).returning();
  await logActivity({ agentId: trade.agentId, instructionId: trade.instructionId, type: "trade_failed", status: "failed", message: `Trade failed: ${error}`, data: { tradeId: trade.id } });
  return t;
}

async function recordConfirmed(trade: Trade, signature: string) {
  const delta = await solDeltaOf(signature).catch(() => null);
  const outputAmount = trade.action === "swap" ? await receivedOf(signature, trade.wallet, trade.mint).catch(() => null) : null;
  const [t] = await db
    .update(schema.agentTrades)
    .set({ status: "confirmed", signature, solDelta: delta, outputAmount, confirmedAt: new Date(), error: null })
    .where(eq(schema.agentTrades.id, trade.id))
    .returning();
  await logActivity({
    agentId: trade.agentId,
    instructionId: trade.instructionId,
    type: "trade_confirmed",
    status: "completed",
    message:
      trade.action === "swap"
        ? `Swap confirmed on mainnet: ${describe(trade)}${outputAmount !== null ? `, received ${fromBaseUnits(outputAmount, trade.outputDecimals ?? 0)} ${symbolOf(trade.mint)}` : ""}`
        : `Trade confirmed on mainnet: ${trade.action} ${short(trade.mint)}${delta !== null ? ` (SOL change ${Number(delta) / 1e9})` : ""}`,
    data: { tradeId: trade.id, signature, network: "mainnet" },
  });
  return t;
}

/** Autonomous: build → validate → simulate spend → sign with the agent key → send → confirm. */
async function executeAutonomousTrade(trade: Trade, agent: Agent): Promise<Trade> {
  try {
    let tx: VersionedTransaction;
    if (trade.action === "swap") {
      const quote = await swapQuoteFor(trade);
      tx = await buildSwapTransaction(quote, agent.signerPubkey);
      await simulateSwapSpend(tx, agent.signerPubkey, quote);
    } else {
      const req = tradeRequest(trade, agent.signerPubkey);
      tx = await buildTradeTransaction(req);
      await simulateSpend(tx, req);
    }
    // Re-check kill switches right before signing.
    const fresh = await loadAgentRow(agent.id);
    if (fresh.status !== "active" || fresh.tradingMode !== "autonomous") return failTrade(trade, "Halted: agent paused or trading mode changed");
    if (await isPlatformPaused()) return failTrade(trade, "Halted: platform paused");
    const signed = trade.action === "swap" ? await signAgentSwap(agent.id, agent.signerPubkey, tx) : await signAgentTrade(agent.id, agent.signerPubkey, tx);
    const bs58 = (await import("bs58")).default;
    await db.update(schema.agentTrades).set({ signature: bs58.encode(signed.signatures[0]) }).where(eq(schema.agentTrades.id, trade.id));
    const signature = await sendAndConfirmMainnet(signed);
    return recordConfirmed(trade, signature);
  } catch (e) {
    return failTrade(trade, e instanceof PumpFunError || e instanceof SwapError || e instanceof EngineError ? e.message : `Unexpected error: ${(e as Error).message}`);
  }
}

async function loadCreatorTrade(tradeId: string, wallet: string) {
  const trade = await db.query.agentTrades.findFirst({ where: eq(schema.agentTrades.id, tradeId) });
  if (!trade) throw new EngineError("Trade not found", 404);
  const agent = await loadAgentRow(trade.agentId);
  if (agent.creatorWallet !== wallet) throw new EngineError("Only the agent's creator can sign this trade", 403);
  if (trade.mode !== "proposal" || trade.status !== "awaiting_signature") throw new EngineError(`Trade is ${trade.status}`, 409);
  return { trade, agent };
}

/** Proposal mode: re-checks policy, builds the trade for the creator's wallet, validates and simulates it. */
export async function buildCreatorTrade(tradeId: string, wallet: string): Promise<string> {
  const { trade, agent } = await loadCreatorTrade(tradeId, wallet);
  const decision = evaluateTrade(
    { ...(await toTradingPolicy(agent)), mode: agent.tradingMode === "off" ? "off" : "proposal" },
    proposalOf(trade),
    { globalPause: await isPlatformPaused(), spentToday: await spentToday(agent.id) },
  );
  if (decision.decision === "reject") {
    await db.update(schema.agentTrades).set({ status: "rejected", policy: decision, error: decision.summary }).where(eq(schema.agentTrades.id, trade.id));
    throw new EngineError(`No longer allowed: ${decision.summary}`, 409);
  }
  try {
    if (trade.action === "swap") {
      const quote = await swapQuoteFor(trade);
      const tx = await buildSwapTransaction(quote, wallet);
      await simulateSwapSpend(tx, wallet, quote);
      return Buffer.from(tx.serialize()).toString("base64");
    }
    const req = tradeRequest(trade, wallet);
    const tx = await buildTradeTransaction(req);
    await simulateSpend(tx, req);
    return Buffer.from(tx.serialize()).toString("base64");
  } catch (e) {
    if (e instanceof PumpFunError || e instanceof SwapError) throw new EngineError(e.message, 400);
    throw e;
  }
}

/** Proposal mode: the creator's wallet signed; validate again, check the spend, send, confirm. */
export async function submitCreatorTrade(tradeId: string, wallet: string, signedB64: string): Promise<Trade> {
  const { trade } = await loadCreatorTrade(tradeId, wallet);
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(Buffer.from(signedB64, "base64"));
    if (trade.action === "swap") {
      validateSwapTransaction(tx, wallet);
      // Same input mint and amount as proposed; spend measured against the stored amount.
      await simulateSwapSpend(tx, wallet, { inputMint: trade.inputMint!, inAmount: String(trade.inputAmount!) } as Quote);
    } else {
      validateTradeTransaction(tx, wallet);
      await simulateSpend(tx, tradeRequest(trade, wallet));
    }
  } catch (e) {
    throw new EngineError(e instanceof PumpFunError || e instanceof SwapError ? e.message : "Invalid signed transaction", 400);
  }
  const [claimed] = await db
    .update(schema.agentTrades)
    .set({ status: "executing", reservedAt: new Date() })
    .where(and(eq(schema.agentTrades.id, trade.id), eq(schema.agentTrades.status, "awaiting_signature")))
    .returning();
  if (!claimed) throw new EngineError("Trade is already being processed", 409);
  try {
    const signature = await sendAndConfirmMainnet(tx);
    return recordConfirmed(claimed, signature);
  } catch (e) {
    return failTrade(claimed, e instanceof PumpFunError || e instanceof SwapError ? e.message : (e as Error).message);
  }
}

export async function cancelTrade(tradeId: string, wallet: string): Promise<Trade> {
  const { trade } = await loadCreatorTrade(tradeId, wallet);
  const [t] = await db.update(schema.agentTrades).set({ status: "cancelled", error: "Dismissed by creator" }).where(eq(schema.agentTrades.id, trade.id)).returning();
  await logActivity({ agentId: trade.agentId, instructionId: trade.instructionId, type: "trade_cancelled", status: "info", message: `Creator dismissed the proposed ${describe(trade)}` });
  return t;
}

export type TradingWallet = { address: string; sol: number; tokens: { mint: string; amount: string; decimals: number; programId: string; account: string; rawAmount: bigint }[] };

/** Live mainnet balances of the agent's trading wallet. */
export async function tradingWallet(agent: Agent): Promise<TradingWallet> {
  const conn = mainnetConnection();
  const owner = new PublicKey(agent.signerPubkey);
  const [lamports, spl, t22] = await Promise.all([
    conn.getBalance(owner, "confirmed"),
    conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, "confirmed"),
    conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed"),
  ]);
  const tokens = [...spl.value.map((a) => ({ a, p: TOKEN_PROGRAM_ID })), ...t22.value.map((a) => ({ a, p: TOKEN_2022_PROGRAM_ID }))]
    .map(({ a, p }) => {
      const info = (a.account.data as ParsedAccountData).parsed.info;
      return {
        mint: info.mint as string,
        amount: info.tokenAmount.uiAmountString as string,
        decimals: info.tokenAmount.decimals as number,
        rawAmount: BigInt(info.tokenAmount.amount as string),
        programId: p.toBase58(),
        account: a.pubkey.toBase58(),
      };
    })
    .filter((t) => t.rawAmount > 0n);
  return { address: agent.signerPubkey, sol: lamports / 1e9, tokens };
}

/** Creator-only: send all tokens and SOL in the agent trading wallet back to the creator. */
export async function withdrawTradingWallet(agentId: string, wallet: string) {
  const agent = await loadAgentRow(agentId);
  if (agent.creatorWallet !== wallet) throw new EngineError("Only the creator can withdraw", 403);
  const conn = mainnetConnection();
  const w = await tradingWallet(agent);
  const signatures: string[] = [];
  // 1) tokens (agent pays ATA rent for the creator if needed)
  if (w.tokens.length) {
    const { blockhash } = await conn.getLatestBlockhash("confirmed");
    const tx = await signTradingWalletWithdrawal({
      agentId: agent.id,
      agentSignerPubkey: agent.signerPubkey,
      creatorWallet: agent.creatorWallet,
      recentBlockhash: blockhash,
      tokens: w.tokens.slice(0, 6).map((t) => ({ mint: t.mint, programId: t.programId, amount: t.rawAmount, decimals: t.decimals, account: t.account })),
      lamportsToSend: 0n,
    });
    signatures.push(await sendAndConfirmMainnet(new VersionedTransaction(tx.compileMessage(), tx.signatures.map((s) => s.signature!))));
  }
  // 2) all remaining SOL minus the network fee
  const lamports = BigInt(await conn.getBalance(new PublicKey(agent.signerPubkey), "confirmed"));
  const toSend = lamports - 5_000n;
  if (toSend > 0n) {
    const { blockhash } = await conn.getLatestBlockhash("confirmed");
    const tx = await signTradingWalletWithdrawal({
      agentId: agent.id,
      agentSignerPubkey: agent.signerPubkey,
      creatorWallet: agent.creatorWallet,
      recentBlockhash: blockhash,
      tokens: [],
      lamportsToSend: toSend,
    });
    signatures.push(await sendAndConfirmMainnet(new VersionedTransaction(tx.compileMessage(), tx.signatures.map((s) => s.signature!))));
  }
  await logActivity({ agentId, type: "trading_withdrawal", status: "completed", message: `Creator withdrew the agent trading wallet (${signatures.length} transaction(s))`, data: { signatures, network: "mainnet" } });
  return { signatures };
}

export async function listTrades(agentId: string, limit = 50) {
  return db.select().from(schema.agentTrades).where(eq(schema.agentTrades.agentId, agentId)).orderBy(desc(schema.agentTrades.createdAt)).limit(limit);
}

export async function tradingSnapshot(agentId: string) {
  return { spentTodayLamports: await spentToday(agentId) };
}

export function tradeView(t: Trade) {
  return {
    id: t.id,
    mode: t.mode,
    action: t.action,
    mint: t.mint,
    amount: t.action === "buy" ? `${Number(t.amount) / 1e9} SOL` : t.action === "sell" ? `${t.amount}%` : swapAmountText(t),
    swap:
      t.action === "swap"
        ? {
            input: t.inputMint,
            inputSymbol: symbolOf(t.inputMint ?? ""),
            output: t.mint,
            outputSymbol: symbolOf(t.mint),
            inputAmount: t.inputAmount !== null ? fromBaseUnits(t.inputAmount, t.inputDecimals ?? 0) : null,
            quotedOutput: t.quotedOut !== null ? fromBaseUnits(t.quotedOut, t.outputDecimals ?? 0) : null,
            received: t.outputAmount !== null ? fromBaseUnits(t.outputAmount, t.outputDecimals ?? 0) : null,
            valueSol: Number(t.amount) / 1e9,
          }
        : null,
    reason: t.reason,
    wallet: t.wallet,
    status: t.status,
    signature: t.signature,
    solChange: t.solDelta !== null ? Number(t.solDelta) / 1e9 : null,
    policy: t.policy,
    error: t.error,
    createdAt: t.createdAt.toISOString(),
  };
}
