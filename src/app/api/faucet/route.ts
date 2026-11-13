import { PublicKey, Transaction } from "@solana/web3.js";
import { confirmByPolling } from "@/lib/solana/confirm";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { requireSession } from "@/lib/server/auth";
import { EngineError } from "@/lib/server/engine/payments";
import { getFeePayer, getTestUsdcAuthority, serverEnv } from "@/lib/server/env";
import { enforceRateLimit, handler, json } from "@/lib/server/http";
import { connection } from "@/lib/server/solana";
import { CIRCLE_DEVNET_USDC, USDC_DECIMALS, publicConfig } from "@/lib/shared/config";
import { toBaseUnits } from "@/lib/shared/amounts";

/**
 * Test-USDC faucet. Only works when this deployment uses its OWN test mint (created by
 * scripts/create-test-usdc.ts). It can never mint Circle USDC.
 */
export const POST = handler(async (req: Request) => {
  const { wallet } = await requireSession();
  enforceRateLimit(req, "faucet", 3, 60 * 60_000, wallet);
  const authority = getTestUsdcAuthority();
  if (!serverEnv.testUsdcFaucetEnabled || !authority || publicConfig.usdcMint === CIRCLE_DEVNET_USDC) {
    throw new EngineError("The test USDC faucet is not enabled on this deployment. Use faucet.circle.com for devnet USDC.", 404);
  }
  const mint = new PublicKey(publicConfig.usdcMint);
  const owner = new PublicKey(wallet);
  const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID);
  const feePayer = getFeePayer();
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(feePayer.publicKey, ata, owner, mint, TOKEN_PROGRAM_ID),
    createMintToInstruction(mint, ata, authority.publicKey, toBaseUnits("100", USDC_DECIMALS), [], TOKEN_PROGRAM_ID),
  );
  const signers = authority.publicKey.equals(feePayer.publicKey) ? [feePayer] : [feePayer, authority];
  const conn = connection();
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = feePayer.publicKey;
  tx.sign(...signers);
  const signature = await conn.sendRawTransaction(tx.serialize());
  const res = await confirmByPolling(conn, signature, lastValidBlockHeight);
  if (res.err) throw new EngineError("Faucet transaction failed on-chain", 502);
  return json({ signature, amount: "100" });
});
