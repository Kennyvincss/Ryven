/**
 * Generates the server secrets Ryven needs and prints them as .env lines.
 *   npm run keys
 * Never share this output (screenshots included): it contains private keys.
 */
import { Keypair } from "@solana/web3.js";
import { randomBytes } from "node:crypto";
import bs58 from "bs58";

const feePayer = Keypair.generate();
console.log("# ── paste into .env (KEEP SECRET: never share or screenshot these) ──");
console.log(`SESSION_SECRET=${randomBytes(32).toString("hex")}`);
console.log(`AGENT_KEY_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`);
console.log(`FEE_PAYER_SECRET_KEY=${bs58.encode(feePayer.secretKey)}`);
console.log(`\n# Fee payer public address (safe to share). Send it about 0.05 SOL on Solana mainnet:`);
console.log(`# ${feePayer.publicKey.toBase58()}`);
