import "server-only";
/**
 * AI orchestrator. Claude reasons over natural-language instructions and can call a
 * small allowlist of tools. The only tool that touches money, `propose_payments`, hands
 * proposals to the deterministic payment engine. The model never sees keys, never
 * signs, and has no tool to change limits, approve payments or unpause itself.
 */
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db";
import { serverEnv } from "../env";
import {
  executePayment,
  getSpendingSnapshot,
  loadAgent,
  proposePayments,
  isPlatformPaused,
  type Payment,
} from "../engine/payments";
import { connectionFor, readTreasuryState } from "../solana";
import { getHolders, walletBalances } from "../chain-reads";
import { getMarketData } from "../market";
import { listTrades, proposeTrade, tradeView, tradingSnapshot, tradingWallet } from "../engine/trading";
import { PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { logActivity, type ActivityStatus } from "../engine/activity";
import { fromBaseUnits, toBaseUnits } from "../../shared/amounts";
import { LAUNCH_TOKEN_DECIMALS, PAYMENT_CATEGORY_IDS, USDC_DECIMALS, explorerTx } from "../../shared/config";

export type AgentEvent =
  | { type: "instruction"; instructionId: string }
  | { type: "status"; status: ActivityStatus; message: string }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "payment"; payment: PaymentView }
  | { type: "assistant"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

export type PaymentView = {
  id: string;
  recipient: string;
  amount: string;
  unit: string;
  reason: string;
  category: string;
  status: Payment["status"];
  signature: string | null;
  explorerUrl: string | null;
  policySummary: string;
  error: string | null;
};

export function paymentView(p: Payment): PaymentView {
  return {
    id: p.id,
    recipient: p.recipient,
    amount: fromBaseUnits(p.amount, p.decimals),
    unit: p.asset === "usdc" ? "USDC" : `$${p.symbol}`,
    reason: p.reason,
    category: p.category,
    status: p.status,
    signature: p.status === "confirmed" || p.status === "executing" || p.status === "failed" ? p.signature : null,
    explorerUrl: p.signature && (p.status === "confirmed" || p.status === "executing") ? explorerTx(p.signature, p.network) : null,
    policySummary: p.policy.summary,
    error: p.error,
  };
}

const usd = (v: bigint) => fromBaseUnits(v, USDC_DECIMALS);

// ───────────────────────────── tools ─────────────────────────────
const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "get_treasury_status",
    description:
      "Read the agent's live on-chain treasury balance, remaining on-chain allowance, today's spending, the remaining daily budget and the configured spending policy. Call this before planning payments.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: "list_contributors",
    description:
      "List the creator-approved contributor registry: wallet, handle, role, activity score (higher = more active) and status. Only approved contributors can be paid autonomously.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: "list_payments",
    description: "List payments this agent has made or proposed, with status and Solana transaction signatures.",
    input_schema: {
      type: "object",
      properties: { period: { type: "string", enum: ["today", "7d", "all"] } },
      required: ["period"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "get_pending_approvals",
    description: "List payments waiting for the creator's approval.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: "propose_payments",
    description:
      "Submit payments to the Ryven payment engine, in USDC (asset \"usdc\") or in this agent's own token (asset \"token\", only if the creator enabled token rewards). The engine (not you) checks every payment against the creator's policy for that asset: categories, recipient allowlist, max per transaction, daily limit, on-chain balance & allowance, duplicates. Payments that pass are signed and sent on Solana; others are queued for creator approval or rejected. Results include the real status and transaction signature. Use only wallet addresses that came from list_contributors or that the creator gave you explicitly. Never invent addresses. Up to 10 payments per call. amount is a decimal string like \"5\" or \"2.5\" in units of the chosen asset.",
    input_schema: {
      type: "object",
      properties: {
        campaign: { type: "string", description: "Short name for this batch, e.g. 'Daily contributor rewards'" },
        asset: { type: "string", enum: ["usdc", "token"], description: "usdc, or token = this agent's own token" },
        category: { type: "string", enum: [...PAYMENT_CATEGORY_IDS] },
        payments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              recipient_wallet: { type: "string" },
              amount: { type: "string" },
              reason: { type: "string" },
            },
            required: ["recipient_wallet", "amount", "reason"],
            additionalProperties: false,
          },
        },
      },
      required: ["campaign", "asset", "category", "payments"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "get_token_info",
    description:
      "Read live on-chain data about this agent's own token: total supply, decimals, whether minting is revoked, holder count, the top holders (wallet, amount, % of supply), and whether the token has a tradable market. Use for questions about holders, distribution, supply or price.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: "get_wallet_balances",
    description:
      "Read the live SOL and token balances of a wallet: \"creator\" (the token creator you work for) or any Solana wallet address. Shows USDC and the agent's own token by name. Read-only.",
    input_schema: {
      type: "object",
      properties: { wallet: { type: "string", description: "\"creator\" or a wallet address" } },
      required: ["wallet"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "get_trading_status",
    description:
      "Read the creator's pump.fun trading settings for you (mode off/proposal/autonomous, max SOL per trade, daily SOL limit, allowed coins), SOL spent on buys today, your mainnet trading wallet balances (autonomous mode) and recent trades.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: "propose_trade",
    description:
      "Buy or sell a pump.fun coin on Solana MAINNET (real SOL). Only coins on the creator's trading allowlist. The Ryven trading engine (not you) checks the creator's limits, simulates the trade and refuses anything that would spend more than allowed. In proposal mode the trade waits for the creator to sign it; in autonomous mode it executes from your trading wallet. buy: amount is SOL to spend, e.g. \"0.05\". sell: amount is the percent of holdings to sell, e.g. \"50\". Only trade when the creator asked for it or their standing instructions say so.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["buy", "sell"] },
        mint: { type: "string", description: "Coin mint address (must be on the allowlist)" },
        amount: { type: "string" },
        reason: { type: "string" },
      },
      required: ["action", "mint", "amount", "reason"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "get_market_data",
    description:
      "Live market data for a token on Solana mainnet: price (SOL and USD), market cap, pump.fun bonding-curve progress / graduation, liquidity, 24h volume and 24h price change. For coins still on pump.fun the price is computed from the on-chain bonding curve and SOL/USD from Pyth's on-chain feed; traded coins use DexScreener. Use mint \"own\" for this agent's own token, or any token mint address.",
    input_schema: {
      type: "object",
      properties: { mint: { type: "string", description: "\"own\" or a token mint address" } },
      required: ["mint"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "pause_agent",
    description:
      "Immediately pause this agent so no further payments execute. Use when the creator asks you to stop all payments, or if something looks wrong. Only the creator can resume.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
      additionalProperties: false,
    },
    strict: true,
  },
];

const ProposeInput = z.object({
  campaign: z.string().max(120),
  asset: z.enum(["usdc", "token"]),
  category: z.enum(PAYMENT_CATEGORY_IDS),
  payments: z
    .array(
      z.object({
        recipient_wallet: z.string().min(32).max(44),
        amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
        reason: z.string().min(3).max(300),
      }),
    )
    .min(1)
    .max(10),
});
const PeriodInput = z.object({ period: z.enum(["today", "7d", "all"]) });
const PauseInput = z.object({ reason: z.string().min(1).max(300) });
const WalletInput = z.object({ wallet: z.string().min(1).max(64) });
const MarketInput = z.object({ mint: z.string().min(1).max(64) });
const TradeInput = z.object({
  action: z.enum(["buy", "sell"]),
  mint: z.string().min(32).max(44),
  amount: z.string().regex(/^\d+(\.\d{1,9})?$/),
  reason: z.string().min(3).max(300),
});

type Ctx = { agentId: string; instructionId: string; emit: (e: AgentEvent) => void };

/** Own-token rewards treasury, summarised for the model (or a note that it's disabled). */
async function tokenTreasurySummary(agent: typeof schema.agents.$inferSelect) {
  if (agent.tokenDailyLimit === null) return { enabled: false, note: "The creator has not enabled rewards in the agent's own token." };
  try {
    const { treasury } = await loadAgent(agent.id, "token");
    const [state, snap] = await Promise.all([readTreasuryState(treasury.address, connectionFor(agent.network)), getSpendingSnapshot(agent.id, "token")]);
    const f = (v: bigint) => fromBaseUnits(v, treasury.decimals);
    const delegated = state.delegate === agent.signerPubkey;
    return {
      enabled: true,
      token: `$${treasury.symbol}`,
      onchain_balance: f(state.balance),
      onchain_allowance: delegated ? f(state.allowance) : "0",
      spent_or_reserved_today: f(snap.reservedToday),
      max_per_transaction: f(agent.tokenMaxPerTx ?? 0n),
      autonomous_limit: f(agent.tokenAutoApproveLimit ?? 0n),
      daily_limit: f(agent.tokenDailyLimit),
    };
  } catch (e) {
    return { enabled: true, error: (e as Error).message };
  }
}

async function runTool(name: string, input: unknown, ctx: Ctx): Promise<{ content: string; isError?: boolean }> {
  const { agent, treasury } = await loadAgent(ctx.agentId);
  switch (name) {
    case "get_treasury_status": {
      ctx.emit({ type: "status", status: "analysing", message: "Reading treasury state from Solana" });
      const [state, snap, globalPause] = await Promise.all([
        readTreasuryState(treasury.address, connectionFor(agent.network)),
        getSpendingSnapshot(agent.id),
        isPlatformPaused(),
      ]);
      const delegated = state.delegate === agent.signerPubkey;
      return {
        content: JSON.stringify({
          treasury_address: treasury.address,
          onchain_balance_usdc: usd(state.balance),
          onchain_allowance_usdc: delegated ? usd(state.allowance) : "0",
          allowance_delegated_to_agent: delegated,
          spent_or_reserved_today_usdc: usd(snap.reservedToday),
          remaining_daily_budget_usdc: usd(agent.dailyLimit > snap.reservedToday ? agent.dailyLimit - snap.reservedToday : 0n),
          in_flight_usdc: usd(snap.inFlight),
          policy: {
            agent_status: agent.status,
            platform_payments_paused: globalPause,
            mode: agent.mode,
            max_per_transaction_usdc: usd(agent.maxPerTx),
            autonomous_limit_usdc: usd(agent.autoApproveLimit),
            daily_limit_usdc: usd(agent.dailyLimit),
            approved_categories: agent.categories,
            recipient_policy: agent.recipientPolicy,
          },
          day_resets_at_utc: new Date(snap.dayStartsAt.getTime() + 86400000).toISOString(),
          own_token_rewards: await tokenTreasurySummary(agent),
        }),
      };
    }
    case "list_contributors": {
      ctx.emit({ type: "status", status: "analysing", message: "Loading approved contributor registry" });
      const rows = await db
        .select()
        .from(schema.contributors)
        .where(eq(schema.contributors.agentId, agent.id))
        .orderBy(desc(schema.contributors.activityScore));
      return {
        content: JSON.stringify(
          rows.map((c) => ({
            wallet: c.wallet,
            handle: c.handle,
            role: c.role,
            activity_score: c.activityScore,
            status: c.status,
            note: c.note,
          })),
        ),
      };
    }
    case "list_payments": {
      const { period } = PeriodInput.parse(input);
      const since = period === "today" ? new Date(new Date().setUTCHours(0, 0, 0, 0)) : period === "7d" ? new Date(Date.now() - 7 * 864e5) : new Date(0);
      const rows = await db
        .select()
        .from(schema.payments)
        .where(and(eq(schema.payments.agentId, agent.id), gte(schema.payments.createdAt, since)))
        .orderBy(desc(schema.payments.createdAt))
        .limit(50);
      return {
        content: JSON.stringify(
          rows.map((p) => ({
            recipient: p.recipient,
            amount_usdc: usd(p.amount),
            reason: p.reason,
            status: p.status,
            signature: p.signature,
            created_at: p.createdAt.toISOString(),
          })),
        ),
      };
    }
    case "get_pending_approvals": {
      const rows = await db
        .select()
        .from(schema.payments)
        .where(and(eq(schema.payments.agentId, agent.id), eq(schema.payments.status, "awaiting_approval")))
        .orderBy(desc(schema.payments.createdAt));
      return {
        content: JSON.stringify(rows.map((p) => ({ recipient: p.recipient, amount_usdc: usd(p.amount), reason: p.reason, why: p.policy.summary }))),
      };
    }
    case "propose_payments": {
      const parsed = ProposeInput.safeParse(input);
      if (!parsed.success) return { content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join("; ")}`, isError: true };
      const { campaign, category, payments, asset } = parsed.data;
      ctx.emit({ type: "status", status: "checking_permissions", message: `Checking ${payments.length} payment(s) against the spending policy` });
      const items = payments.map((p) => ({
        recipient: p.recipient_wallet.trim(),
        amount: toBaseUnits(p.amount, asset === "usdc" ? USDC_DECIMALS : LAUNCH_TOKEN_DECIMALS),
        category,
        reason: p.reason,
        campaign,
      }));
      const results = await proposePayments({ agentId: agent.id, instructionId: ctx.instructionId, source: "agent", asset, items });
      const final: Payment[] = [];
      for (const r of results) {
        let p = r.payment;
        if (p.status === "approved") {
          ctx.emit({ type: "status", status: "preparing_payment", message: `Preparing ${usd(p.amount)} USDC → ${p.recipient.slice(0, 4)}…` });
          ctx.emit({ type: "payment", payment: paymentView({ ...p, status: "executing" }) });
          p = await executePayment(p.id);
        }
        ctx.emit({ type: "payment", payment: paymentView(p) });
        final.push(p);
      }
      return {
        content: JSON.stringify(
          final.map((p) => ({
            recipient: p.recipient,
            amount_usdc: usd(p.amount),
            status: p.status,
            signature: p.status === "confirmed" ? p.signature : null,
            policy: p.policy.summary,
            error: p.error,
            already_submitted_for_this_instruction: results.find((r) => r.payment.id === p.id)?.duplicate ?? false,
          })),
        ),
      };
    }
    case "get_token_info": {
      ctx.emit({ type: "status", status: "analysing", message: "Reading token supply and holders from Solana" });
      const token = await db.query.tokens.findFirst({ where: eq(schema.tokens.id, agent.tokenId) });
      if (!token) return { content: "Token not found", isError: true };
      const program = new PublicKey(token.tokenProgram);
      const tconn = connectionFor(token.network);
      const mintInfo = await getMint(tconn, new PublicKey(token.mint), "confirmed", program).catch(() => null);
      const supply = mintInfo ? Number(fromBaseUnits(mintInfo.supply, mintInfo.decimals)) : null;
      const report = await getHolders(token.mint, program, tconn).catch(() => null);
      return {
        content: JSON.stringify({
          name: token.name,
          symbol: token.symbol,
          mint: token.mint,
          network: token.network,
          total_supply: supply,
          decimals: mintInfo?.decimals ?? token.decimals,
          mint_authority_revoked: mintInfo ? mintInfo.mintAuthority === null : null,
          holder_count: report?.count ?? null,
          top_holders: (report?.holders ?? []).slice(0, 10).map((h) => ({
            wallet: h.owner,
            amount: h.amount,
            percent_of_supply: h.percent,
            is_creator: h.owner === agent.creatorWallet,
          })),
          holder_data_source: report
            ? report.source === "index"
              ? "full on-chain index"
              : `rebuilt from the token's transaction history${report.complete ? "" : " (latest 300 transactions only; older holders may be missing)"}, with live balances`
            : "unavailable: the RPC refused the lookup",
          market:
            token.launchMode === "pumpfun"
              ? "Trades on pump.fun (mainnet)."
              : "No Ryven market: fixed-supply token with no bonding curve. It only trades if someone creates a DEX pool for it.",
        }),
      };
    }
    case "get_wallet_balances": {
      const { wallet } = WalletInput.parse(input);
      const token = await db.query.tokens.findFirst({ where: eq(schema.tokens.id, agent.tokenId) });
      const address = wallet === "creator" ? agent.creatorWallet : wallet.trim();
      try {
        new PublicKey(address);
      } catch {
        return { content: `"${wallet}" is not a valid Solana wallet address`, isError: true };
      }
      ctx.emit({ type: "status", status: "analysing", message: `Reading balances of ${address.slice(0, 4)}…${address.slice(-4)}` });
      const b = await walletBalances(address, connectionFor(agent.network));
      const name = (mint: string) => (mint === treasury.mint ? "USDC" : token && mint === token.mint ? `$${token.symbol}` : undefined);
      return {
        content: JSON.stringify({
          wallet: address,
          is_creator: address === agent.creatorWallet,
          sol: b.sol,
          tokens: b.tokens.slice(0, 25).map((t) => ({ mint: t.mint, name: name(t.mint), amount: t.amount })),
          note:
            address === agent.creatorWallet
              ? "The creator also owns the agent's treasury token account, so USDC shown here includes the treasury balance."
              : undefined,
        }),
      };
    }
    case "get_trading_status": {
      ctx.emit({ type: "status", status: "analysing", message: "Reading trading settings and wallet (mainnet)" });
      const [trades, snap, wallet] = await Promise.all([
        listTrades(agent.id, 10),
        tradingSnapshot(agent.id),
        agent.tradingMode === "autonomous" ? tradingWallet(agent).catch((e: Error) => ({ error: e.message })) : Promise.resolve(null),
      ]);
      return {
        content: JSON.stringify({
          mode: agent.tradingMode,
          max_sol_per_trade: Number(agent.tradeMaxSol) / 1e9,
          daily_sol_limit: Number(agent.tradeDailySol) / 1e9,
          sol_spent_on_buys_today: Number(snap.spentTodayLamports) / 1e9,
          allowed_coins: agent.tradeMints,
          trading_wallet:
            wallet && !("error" in wallet)
              ? { address: wallet.address, sol: wallet.sol, tokens: wallet.tokens.map((t) => ({ mint: t.mint, amount: t.amount })) }
              : wallet,
          recent_trades: trades.map((t) => tradeView(t)),
        }),
      };
    }
    case "propose_trade": {
      const parsed = TradeInput.safeParse(input);
      if (!parsed.success) return { content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join("; ")}`, isError: true };
      const { action, mint, amount, reason } = parsed.data;
      if (action === "sell" && (Number(amount) < 1 || Number(amount) > 100)) return { content: "For a sell, amount is a percent from 1 to 100", isError: true };
      ctx.emit({ type: "status", status: "checking_permissions", message: `Checking ${action} against trading limits` });
      const { trade, duplicate } = await proposeTrade({
        agentId: agent.id,
        instructionId: ctx.instructionId,
        action,
        mint,
        amount: action === "buy" ? toBaseUnits(amount, 9) : BigInt(Math.round(Number(amount))),
        reason,
      });
      ctx.emit({
        type: "status",
        status: trade.status === "confirmed" ? "completed" : trade.status === "awaiting_signature" ? "awaiting_approval" : trade.status === "rejected" || trade.status === "failed" ? "failed" : "executing",
        message:
          trade.status === "confirmed"
            ? `Trade confirmed on mainnet`
            : trade.status === "awaiting_signature"
              ? "Trade proposal waiting for the creator to sign"
              : `Trade ${trade.status}: ${trade.error ?? trade.policy.summary}`,
      });
      return { content: JSON.stringify({ ...tradeView(trade), already_submitted_for_this_instruction: duplicate }) };
    }
    case "get_market_data": {
      const { mint: requested } = MarketInput.parse(input);
      const own = await db.query.tokens.findFirst({ where: eq(schema.tokens.id, agent.tokenId) });
      const mint = requested === "own" ? own?.mint : requested.trim();
      if (!mint) return { content: "Token not found", isError: true };
      try {
        new PublicKey(mint);
      } catch {
        return { content: `"${requested}" is not a valid token mint address`, isError: true };
      }
      if (requested === "own" && own?.network === "devnet") {
        return { content: JSON.stringify({ mint, note: "This token is on devnet (test mode); devnet tokens have no market price." }) };
      }
      ctx.emit({ type: "status", status: "analysing", message: `Reading live market data for ${mint.slice(0, 4)}…${mint.slice(-4)}` });
      const m = await getMarketData(mint);
      return { content: JSON.stringify({ ...m, is_own_token: own?.mint === mint }) };
    }
    case "pause_agent": {
      const { reason } = PauseInput.parse(input);
      await db
        .update(schema.agents)
        .set({ status: "paused", pausedReason: `Agent self-paused: ${reason}`, updatedAt: new Date() })
        .where(eq(schema.agents.id, agent.id));
      await logActivity({ agentId: agent.id, instructionId: ctx.instructionId, type: "agent_paused", status: "info", message: `Agent paused itself: ${reason}` });
      ctx.emit({ type: "status", status: "completed", message: "Agent paused. All payments halted" });
      return { content: JSON.stringify({ paused: true }) };
    }
    default:
      return { content: `Unknown tool ${name}`, isError: true };
  }
}

function systemPrompt(agent: typeof schema.agents.$inferSelect, token: { name: string; symbol: string; mint: string }) {
  return `You are ${agent.name}, the autonomous treasury agent for the token $${token.symbol} (${token.name}, mint ${token.mint}) on the Ryven platform (Solana ${agent.network}${agent.network === "mainnet" ? ": payments move REAL money" : ""}).

## Identity
Description: ${agent.description || "(none)"}
Personality: ${agent.personality || "Professional, concise and transparent."}
Objectives: ${agent.objectives || "Manage community rewards responsibly."}
Standing instructions from the creator: ${agent.instructions || "(none)"}

## How you operate
- You talk with the token creator through a terminal. Interpret their instructions, break them into steps, check your budget, and act with your tools.
- You pay in USDC from your treasury. You cannot sign transactions yourself: you submit proposals with propose_payments and the Ryven payment engine enforces the creator's policy (limits, allowlist, categories, balance, duplicates) and executes what is permitted on Solana.
- Only pay wallets that come from list_contributors, or that the creator explicitly gave you in this conversation. Never invent or guess wallet addresses. When asked for "the most active" contributors, rank by activity_score.
- Check get_treasury_status before planning payments, and keep the batch within the remaining daily budget and per-transaction maximum. If the request exceeds the limits, explain the conflict and propose the closest compliant plan instead of submitting payments that will be rejected.
- Report what actually happened, using the engine's results: say "confirmed on-chain" only for status "confirmed", "awaiting approval" for "awaiting_approval", and give the reason for rejections. Never claim a payment happened if the engine did not confirm it.
- You cannot change your own limits, approve payments, or resume after a pause. If asked, explain that only the creator can do that from the Ryven console.
- Recurring/scheduled payments are not supported yet: for "every day" requests, do today's run and say the creator must re-issue the instruction for future days.
- If asked to stop all payments, call pause_agent.
- For price, market cap, volume, liquidity or bonding-curve progress use get_market_data (mint "own" for your token). Quote numbers with their source.
- For holders, supply or distribution questions use get_token_info. For the creator's own holdings use get_wallet_balances with "creator". You can look up any wallet.
- Trading: you CAN buy and sell pump.fun coins on Solana mainnet (on the bonding curve or after graduation) with propose_trade. When the creator asks you to buy or sell, call propose_trade; don't refuse on your own. The engine decides: if trading is off, a coin isn't allowed or a limit is exceeded, it tells you why, and you pass that on (trading is turned on in the console → Permissions → pump.fun trading). Your own coin is always allowed. Proposal mode: the creator signs each trade in the console's Trading tab. Autonomous mode: you trade from your own trading wallet within the creator's limits. Don't trade on your own initiative unless the creator's standing instructions say so. Use get_market_data to check prices before or after a trade.
- Rewards can be paid in USDC or in your own token (asset "token") if the creator enabled token rewards; get_treasury_status shows both.
- Keep replies short (under 120 words), in plain text, no markdown tables. Amounts in USDC.`;
}

/** Runs one natural-language instruction from the creator. Streams events via `emit`. */
export async function runInstruction(agentId: string, text: string, emit: (e: AgentEvent) => void) {
  const instructionId = randomUUID();
  emit({ type: "instruction", instructionId });
  const { agent } = await loadAgent(agentId);
  const token = await db.query.tokens.findFirst({ where: eq(schema.tokens.id, agent.tokenId) });
  if (!token) throw new Error("Token not found");

  await logActivity({ agentId, instructionId, type: "instruction", status: "info", message: `Instruction received: "${text.slice(0, 200)}"`, isPublic: false });

  if (!serverEnv.anthropicApiKey) {
    const msg = "AI is not configured on this server: set ANTHROPIC_API_KEY in your environment (see docs/SETUP.md). You can still send payments manually from the Treasury tab; they go through the same policy engine.";
    emit({ type: "error", message: msg });
    emit({ type: "done" });
    return;
  }

  const history = await db
    .select()
    .from(schema.agentMessages)
    .where(eq(schema.agentMessages.agentId, agentId))
    .orderBy(desc(schema.agentMessages.createdAt))
    .limit(12);
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of history.reverse()) {
    const role = m.role === "assistant" ? "assistant" : "user";
    if (messages.length === 0 && role === "assistant") continue;
    const last = messages[messages.length - 1];
    if (last && last.role === role) continue; // keep strict alternation
    messages.push({ role, content: m.content });
  }
  if (messages.length && messages[messages.length - 1].role === "user") messages.pop();
  messages.push({ role: "user", content: text });
  await db.insert(schema.agentMessages).values({ agentId, instructionId, role: "user", content: text });

  const client = new Anthropic({ apiKey: serverEnv.anthropicApiKey });
  const ctx: Ctx = { agentId, instructionId, emit };
  const replies: string[] = [];

  try {
    for (let step = 0; step < 8; step++) {
      emit({ type: "status", status: "thinking", message: step === 0 ? "Interpreting instruction" : "Reviewing results" });
      const response = await client.beta.messages.create({
        model: serverEnv.anthropicModel,
        max_tokens: 16000,
        system: systemPrompt(agent, token),
        messages,
        tools: TOOLS,
        output_config: { effort: "medium" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });

      for (const block of response.content) {
        if (block.type === "text" && block.text.trim()) {
          replies.push(block.text.trim());
          emit({ type: "assistant", text: block.text.trim() });
        }
      }
      if (response.stop_reason === "refusal") {
        emit({ type: "error", message: "The model declined this request." });
        break;
      }
      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }
      if (response.stop_reason !== "tool_use") break;

      messages.push({ role: "assistant", content: response.content });
      const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        emit({ type: "tool_call", name: block.name, input: block.input });
        try {
          const r = await runTool(block.name, block.input, ctx);
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: r.content, is_error: r.isError });
        } catch (e) {
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: `Tool error: ${(e as Error).message}`, is_error: true });
        }
      }
      messages.push({ role: "user", content: toolResults });
    }
  } catch (e) {
    let message = (e as Error).message;
    if (e instanceof Anthropic.AuthenticationError) message = "Anthropic API key is invalid.";
    else if (e instanceof Anthropic.RateLimitError) message = "AI rate limit reached. Try again shortly.";
    else if (e instanceof Anthropic.APIError) {
      // Pull the human-readable message out of the API error body instead of showing raw JSON.
      const body = e.error as { error?: { message?: string } } | undefined;
      const detail = body?.error?.message ?? e.message;
      message = /credit balance is too low/i.test(detail)
        ? "Your Anthropic account has no API credit. Add credit at console.anthropic.com → Billing, then try again. (Manual payments still work meanwhile.)"
        : `AI service error (${e.status}): ${detail}`;
    }
    emit({ type: "error", message });
    replies.push(`(error: ${message})`);
  }

  await db.insert(schema.agentMessages).values({
    agentId,
    instructionId,
    role: "assistant",
    content: replies.join("\n\n") || "(no response)",
  });
  emit({ type: "status", status: "completed", message: "Done" });
  emit({ type: "done" });
}

export async function instructionPayments(instructionId: string) {
  return db.select().from(schema.payments).where(inArray(schema.payments.instructionId, [instructionId]));
}
