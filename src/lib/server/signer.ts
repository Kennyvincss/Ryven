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
