import "server-only";
import { PublicKey } from "@solana/web3.js";
import { EngineError } from "./engine/payments";

/** Validates a mint from a URL (any valid Solana address). */
export function mintParam(v: string | undefined | null): string {
  try {
    return new PublicKey(v ?? "").toBase58();
  } catch {
    throw new EngineError("Invalid token address", 400);
  }
}

/** Market data is fine to cache briefly at the edge/browser. */
export const shortCache = { headers: { "cache-control": "public, max-age=2, stale-while-revalidate=5" } };

/** Upstream market-data failures become a plain 502 (details go to the server log). */
export async function upstream<T>(what: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (e) {
    console.error(`${what} failed:`, (e as Error).message);
    throw new EngineError("Live market data is temporarily unavailable.", 502);
  }
}
