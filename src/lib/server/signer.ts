import "server-only";
/**
 * Agent signer vault. This is the ONLY module that ever decrypts an agent key, and it
 * only exposes `signAgentPayment`, which builds the fixed payment transaction itself.
 * Keys are encrypted with AES-256-GCM using AGENT_KEY_ENCRYPTION_KEY (server env).
 * Nothing here is reachable from the LLM or the browser.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { getFeePayer, serverEnv } from "./env";
import { buildAgentPaymentTransaction } from "../solana/payment";

export type EncryptedKey = { ciphertext: string; iv: string; authTag: string };

export function encryptSecretKey(secret: Uint8Array, key: Buffer, aad: string): EncryptedKey {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}

export function decryptSecretKey(enc: EncryptedKey, key: Buffer, aad: string): Uint8Array {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(enc.iv, "base64"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(enc.authTag, "base64"));
  return new Uint8Array(Buffer.concat([decipher.update(Buffer.from(enc.ciphertext, "base64")), decipher.final()]));
}

/** Generates a new agent delegate key. Returns only the public key + ciphertext. */
export function generateAgentSigner(agentId: string): { publicKey: string; encrypted: EncryptedKey } {
  const kp = Keypair.generate();
  const encrypted = encryptSecretKey(kp.secretKey, serverEnv.agentKeyEncryptionKey, `agent:${agentId}`);
  kp.secretKey.fill(0);
  return { publicKey: kp.publicKey.toBase58(), encrypted };
}

async function loadAgentKeypair(agentId: string, expectedPubkey: string): Promise<Keypair> {
  const row = await db.query.agentSigners.findFirst({ where: eq(schema.agentSigners.agentId, agentId) });
  if (!row) throw new Error("Agent signer not found");
  const secret = decryptSecretKey(row, serverEnv.agentKeyEncryptionKey, `agent:${agentId}`);
  const kp = Keypair.fromSecretKey(secret);
  if (kp.publicKey.toBase58() !== expectedPubkey) throw new Error("Agent signer mismatch");
  return kp;
}

/**
 * Builds and signs the one permitted transaction shape. Called only by the payment
 * executor after the policy engine has reserved the payment.
 */
export async function signAgentPayment(args: {
  paymentId: string;
  agentId: string;
  agentSignerPubkey: string;
  treasury: string;
  mint: string;
  recipient: string;
  amount: bigint;
  recentBlockhash: string;
  tokenProgram: string;
  decimals: number;
}): Promise<{ tx: Transaction; signature: string }> {
  const feePayer = getFeePayer();
  const agentKp = await loadAgentKeypair(args.agentId, args.agentSignerPubkey);
  try {
    const tx = buildAgentPaymentTransaction({
      paymentId: args.paymentId,
      feePayer: feePayer.publicKey,
      agentSigner: agentKp.publicKey,
      treasury: new PublicKey(args.treasury),
      mint: new PublicKey(args.mint),
      recipient: new PublicKey(args.recipient),
      amount: args.amount,
      recentBlockhash: args.recentBlockhash,
      programId: new PublicKey(args.tokenProgram),
      decimals: args.decimals,
    });
    tx.sign(feePayer, agentKp);
    const sig = tx.signature;
    if (!sig) throw new Error("Signing failed");
    const bs58 = (await import("bs58")).default;
    return { tx, signature: bs58.encode(sig) };
  } finally {
    agentKp.secretKey.fill(0);
  }
}

// ───────────────────────────── trading wallet (mainnet) ─────────────────────────────
// In autonomous trading mode the agent's key also acts as its own small mainnet
// trading wallet, funded with SOL by the creator. These two functions are the only
// other things the key can sign, and both are tightly constrained.

/**
 * Signs a pump.fun trade AFTER the trading engine validated it and checked the simulated
 * SOL spend. Re-validates here too (signer set + program allowlist) as defense in depth.
 */
export async function signAgentTrade(agentId: string, agentSignerPubkey: string, tx: import("@solana/web3.js").VersionedTransaction) {
  const { validateTradeTransaction } = await import("./pumpfun");
  validateTradeTransaction(tx, agentSignerPubkey);
  const kp = await loadAgentKeypair(agentId, agentSignerPubkey);
  try {
    tx.sign([kp]);
    return tx;
  } finally {
    kp.secretKey.fill(0);
  }
}

/**
 * Withdraws everything from the agent's trading wallet to the CREATOR (fixed destination):
 * every token balance, then all SOL minus the network fee.
 */
export async function signTradingWalletWithdrawal(args: {
  agentId: string;
  agentSignerPubkey: string;
  creatorWallet: string;
  recentBlockhash: string;
  tokens: { mint: string; programId: string; amount: bigint; decimals: number; account: string }[];
  lamportsToSend: bigint;
}) {
  const { SystemProgram } = await import("@solana/web3.js");
  const spl = await import("@solana/spl-token");
  const kp = await loadAgentKeypair(args.agentId, args.agentSignerPubkey);
  try {
    const creator = new PublicKey(args.creatorWallet);
    const tx = new Transaction({ feePayer: kp.publicKey, recentBlockhash: args.recentBlockhash });
    for (const t of args.tokens) {
      const program = new PublicKey(t.programId);
      const mint = new PublicKey(t.mint);
      const dest = spl.getAssociatedTokenAddressSync(mint, creator, false, program);
      tx.add(
        spl.createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, dest, creator, mint, program),
        spl.createTransferCheckedInstruction(new PublicKey(t.account), mint, dest, kp.publicKey, t.amount, t.decimals, [], program),
      );
    }
    if (args.lamportsToSend > 0n) {
      tx.add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: creator, lamports: args.lamportsToSend }));
    }
    if (!tx.instructions.length) throw new Error("Nothing to withdraw");
    tx.sign(kp);
    return tx;
  } finally {
    kp.secretKey.fill(0);
  }
}
