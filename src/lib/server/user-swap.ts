import "server-only";
/**
 * Buy / sell / swap for any visitor's own wallet (Live terminal and token pages). Ryven never
 * signs or holds anything here: it gets a Jupiter route, builds the transaction for the
 * user's wallet, checks it (single signer = the user, known programs only, no transfers to
 * anyone else) and simulates it on mainnet so the wallet can't lose more than the quoted
 * input plus fees. The user's wallet shows it and signs it.
 */
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { SwapError, buildSwapTransactionWithMeta, getQuote, simulateSwapSpend, type Quote } from "./jupiter";
import { EngineError } from "./engine/payments";

const pubkey = z.string().refine((v) => {
  try {
    new PublicKey(v);
    return true;
  } catch {
    return false;
  }
}, "Invalid address");

export const SwapRequest = z.object({
  input: pubkey,
  output: pubkey,
  /** raw base units of the input token */
  amount: z.string().regex(/^\d{1,30}$/).refine((v) => BigInt(v) > 0n, "Amount must be greater than zero"),
  /** 0.1% - 50% */
  slippageBps: z.number().int().min(10).max(5000),
});
export type SwapRequest = z.infer<typeof SwapRequest>;

export function quoteSummary(q: Quote) {
  return {
    inputMint: q.inputMint,
    outputMint: q.outputMint,
    inAmount: q.inAmount,
    outAmount: q.outAmount,
    minOut: q.otherAmountThreshold,
    priceImpactPct: Number(q.priceImpactPct) || 0,
    route: q.routePlan.map((r) => r.swapInfo.label).filter(Boolean),
  };
}

const asEngine = (e: unknown) => (e instanceof SwapError ? new EngineError(e.message.replace("The swapping wallet", "Your wallet"), 400) : e);

export async function userQuote(r: SwapRequest) {
  try {
    return quoteSummary(await getQuote(r.input, r.output, BigInt(r.amount), r.slippageBps));
  } catch (e) {
    throw asEngine(e);
  }
}

export async function buildUserSwap(r: SwapRequest & { wallet: string }) {
  try {
    const quote = await getQuote(r.input, r.output, BigInt(r.amount), r.slippageBps);
    const { tx, lastValidBlockHeight } = await buildSwapTransactionWithMeta(quote, r.wallet, { priority: true });
    await simulateSwapSpend(tx, r.wallet, quote);
    return { transaction: Buffer.from(tx.serialize()).toString("base64"), lastValidBlockHeight, quote: quoteSummary(quote) };
  } catch (e) {
    throw asEngine(e);
  }
}
