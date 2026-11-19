"use client";
import { useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, VersionedTransaction, type Connection } from "@solana/web3.js";
import { api } from "./api";
import { useNetworkConnection } from "./network";
import { friendlyError } from "./wallet-tx";
import { BlockhashExpiredError, confirmByPolling } from "../solana/confirm";

export type SwapQuote = { inputMint: string; outputMint: string; inAmount: string; outAmount: string; minOut: string; priceImpactPct: number; route: string[] };
export type SwapArgs = { input: string; output: string; amount: bigint; slippageBps: number };

const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/**
 * Buy / sell / swap from the connected wallet on mainnet. Ryyven builds and checks the
 * transaction (it must only move the user's own funds) and simulates it; the user's wallet
 * shows it and signs. Returns the confirmed signature.
 */
export function useSwap() {
  const wallet = useWallet();
  const conn = useNetworkConnection("mainnet");

  const quote = useCallback(async (a: SwapArgs) => {
    const q = new URLSearchParams({ input: a.input, output: a.output, amount: a.amount.toString(), slippageBps: String(a.slippageBps) });
    return (await api<{ quote: SwapQuote }>(`/api/swap/quote?${q}`)).quote;
  }, []);

  const execute = useCallback(
    async (a: SwapArgs, onStatus?: (s: string) => void) => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first.");
      if (!wallet.signTransaction) throw new Error("This wallet can't sign here. Try Phantom or Solflare.");
      onStatus?.("Preparing and checking the transaction…");
      const built = await api<{ transaction: string; lastValidBlockHeight: number | null; quote: SwapQuote }>("/api/swap/build", {
        json: { input: a.input, output: a.output, amount: a.amount.toString(), slippageBps: a.slippageBps, wallet: wallet.publicKey.toBase58() },
      });
      const tx = VersionedTransaction.deserialize(decode(built.transaction));
      onStatus?.("Approve in your wallet…");
      let signed: VersionedTransaction;
      try {
        signed = await wallet.signTransaction(tx);
      } catch (e) {
        throw new Error(friendlyError(e));
      }
      onStatus?.("Sending…");
      const sig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: true, maxRetries: 3 });
      onStatus?.("Confirming on Solana…");
      const lastValid = built.lastValidBlockHeight ?? (await conn.getBlockHeight("confirmed")) + 150;
      try {
        const r = await confirmByPolling(conn, sig, lastValid, "confirmed");
        if (r.err) throw new Error("The transaction failed on-chain (price moved past your slippage, or not enough balance).");
      } catch (e) {
        if (e instanceof BlockhashExpiredError) throw new Error("The transaction didn't land in time. Nothing was spent; try again.");
        throw e;
      }
      return { signature: sig, quote: built.quote };
    },
    [wallet, conn],
  );

  return { quote, execute, connected: !!wallet.publicKey, publicKey: wallet.publicKey };
}

/** SOL and one token's balance (raw units) of a wallet, read through the RPC relay. */
export async function readBalances(conn: Connection, owner: PublicKey, mint: string) {
  const [lamports, accounts] = await Promise.all([conn.getBalance(owner, "confirmed"), conn.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) }, "confirmed")]);
  let raw = 0n;
  let decimals: number | null = null;
  for (const a of accounts.value) {
    const info = (a.account.data as { parsed: { info: { tokenAmount: { amount: string; decimals: number } } } }).parsed.info;
    raw += BigInt(info.tokenAmount.amount);
    decimals = info.tokenAmount.decimals;
  }
  return { lamports: BigInt(lamports), tokenRaw: raw, tokenDecimals: decimals };
}
