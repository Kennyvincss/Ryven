import "server-only";
import {
  AccountLayout,
  ACCOUNT_SIZE,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, PublicKey, type ParsedTransactionWithMeta, type VersionedTransactionResponse } from "@solana/web3.js";
import { publicConfig } from "../shared/config";
import { serverEnv } from "./env";
import { outboundFetch } from "./net";

function makeConnection(url: string) {
  return new Connection(url, {
    commitment: "confirmed",
    // Behind a corporate/sandbox proxy, route RPC through HTTPS_PROXY.
    ...(process.env.HTTPS_PROXY ? { fetch: ((u: string, i?: RequestInit) => outboundFetch(u, i)) as unknown as typeof fetch } : {}),
  });
}

let conn: Connection | null = null;
/** The app's main cluster (devnet): agents, treasuries, payments, Ryven launches. */
export function connection(): Connection {
  return (conn ??= makeConnection(serverEnv.rpcUrl));
}

let mainnetConn: Connection | null = null;
/** Solana mainnet: pump.fun launches, trading, and mainnet agents. */
export function mainnetConnection(): Connection {
  return (mainnetConn ??= makeConnection(serverEnv.mainnetRpcUrl));
}

export function connectionFor(network: "devnet" | "mainnet"): Connection {
  return network === "mainnet" ? mainnetConnection() : connection();
}

export const usdcMint = () => new PublicKey(publicConfig.usdcMint);

export type TreasuryState = {
  exists: boolean;
  owner: string | null;
  mint: string | null;
  balance: bigint;
  delegate: string | null;
  allowance: bigint;
  frozen: boolean;
};

/** Reads the treasury token account directly from chain (authoritative). */
export async function readTreasuryState(address: string, conn: Connection = connection()): Promise<TreasuryState> {
  const info = await conn.getAccountInfo(new PublicKey(address), "confirmed");
  if (!info) return { exists: false, owner: null, mint: null, balance: 0n, delegate: null, allowance: 0n, frozen: false };
  if (!(info.owner.equals(TOKEN_PROGRAM_ID) || info.owner.equals(TOKEN_2022_PROGRAM_ID)) || info.data.length < ACCOUNT_SIZE) {
    throw new Error("Treasury address is not an SPL token account");
  }
  const a = AccountLayout.decode(info.data.subarray(0, ACCOUNT_SIZE));
  const hasDelegate = a.delegateOption === 1;
  return {
    exists: true,
    owner: a.owner.toBase58(),
    mint: a.mint.toBase58(),
    balance: a.amount,
    delegate: hasDelegate ? a.delegate.toBase58() : null,
    allowance: hasDelegate ? a.delegatedAmount : 0n,
    frozen: a.state === 2,
  };
}

export async function getConfirmedTransaction(signature: string, conn: Connection = connection()): Promise<VersionedTransactionResponse | null> {
  return conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
}

export async function getParsedTx(signature: string): Promise<ParsedTransactionWithMeta | null> {
  return connection().getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
}

/** Net change of `mint` tokens owned by `owner` (summed over all their token accounts) in a tx. */
export function tokenDeltaForOwner(
  tx: Pick<VersionedTransactionResponse, "meta">,
  owner: string,
  mint: string,
): bigint {
  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];
  const sum = (list: typeof pre) =>
    list.filter((b) => b.owner === owner && b.mint === mint).reduce((acc, b) => acc + BigInt(b.uiTokenAmount.amount), 0n);
  return sum(post) - sum(pre);
}

/** Net change of a specific token account (by address) in a tx. */
export function tokenDeltaForAccount(tx: VersionedTransactionResponse, account: string): bigint {
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses }).staticAccountKeys;
  const allKeys = [
    ...keys,
    ...(tx.meta?.loadedAddresses?.writable ?? []),
    ...(tx.meta?.loadedAddresses?.readonly ?? []),
  ].map((k) => k.toBase58());
  const idx = allKeys.indexOf(account);
  if (idx < 0) return 0n;
  const find = (list: NonNullable<VersionedTransactionResponse["meta"]>["preTokenBalances"]) =>
    BigInt(list?.find((b) => b.accountIndex === idx)?.uiTokenAmount.amount ?? "0");
  return find(tx.meta?.postTokenBalances) - find(tx.meta?.preTokenBalances);
}

export function txSigners(tx: VersionedTransactionResponse): string[] {
  const msg = tx.transaction.message;
  const n = msg.header.numRequiredSignatures;
  return msg.staticAccountKeys.slice(0, n).map((k) => k.toBase58());
}
