/**
 * Generates the server secrets Ryven needs and prints them as .env lines.
 *   npm run keys
 */
import { Keypair } from "@solana/web3.js";
import { randomBytes } from "node:crypto";
import bs58 from "bs58";

const feePayer = Keypair.generate();
console.log("# ── paste into .env ──");
console.log(`SESSION_SECRET=${randomBytes(32).toString("hex")}`);
console.log(`AGENT_KEY_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`);
console.log(`FEE_PAYER_SECRET_KEY=${bs58.encode(feePayer.secretKey)}`);
console.log(`\n# Fee payer public address (fund it with devnet SOL at https://faucet.solana.com):`);
console.log(`# ${feePayer.publicKey.toBase58()}`);
