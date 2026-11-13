import type { Commitment, Connection, TransactionError } from "@solana/web3.js";

export class BlockhashExpiredError extends Error {}

/**
 * Confirms a signature by polling getSignatureStatuses over HTTP (no WebSocket
 * dependency, so it works behind proxies and on serverless hosts). Throws
 * BlockhashExpiredError once the blockhash can no longer land.
 */
export async function confirmByPolling(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number,
  commitment: Commitment = "confirmed",
  intervalMs = 1000,
): Promise<{ err: TransactionError | null }> {
  for (let i = 0; ; i++) {
    const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: false });
    const st = value[0];
    if (st) {
      if (st.err) return { err: st.err };
      if (st.confirmationStatus === "finalized" || (commitment !== "finalized" && st.confirmationStatus === "confirmed")) return { err: null };
    }
    if (i % 5 === 4) {
      const height = await connection.getBlockHeight(commitment);
      if (height > lastValidBlockHeight) throw new BlockhashExpiredError(`Blockhash expired before ${signature} confirmed`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
