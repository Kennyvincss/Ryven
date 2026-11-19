/**
 * Prints the fee payer ADDRESS (public, safe to share) and its SOL balance.
 * Never prints the secret key. Usage: npm run fee-payer
 */
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";

function keypair(v: string): Keypair {
  const s = v.trim();
  return Keypair.fromSecretKey(s.startsWith("[") ? Uint8Array.from(JSON.parse(s)) : bs58.decode(s));
}

const rpc = process.env.MAINNET_RPC_URL || process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const conn = new Connection(rpc, "confirmed");

// Mainnet agent payments use MAINNET_FEE_PAYER_SECRET_KEY if set, otherwise FEE_PAYER_SECRET_KEY.
const used = process.env.MAINNET_FEE_PAYER_SECRET_KEY ? "MAINNET_FEE_PAYER_SECRET_KEY" : "FEE_PAYER_SECRET_KEY";
const secret = process.env[used];
if (!secret) {
  console.error(`No ${used} found. Run this from the project folder, where your .env file is.`);
  process.exit(1);
}
let address: string;
try {
  address = keypair(secret).publicKey.toBase58();
} catch {
  console.error(`${used} in .env is not a valid Solana secret key.`);
  process.exit(1);
}
console.log(`Fee payer address: ${address}`);
console.log(`(from ${used} in .env)`);
try {
  const sol = (await conn.getBalance(keypair(secret).publicKey)) / LAMPORTS_PER_SOL;
  console.log(`Balance: ${sol} SOL`);
  if (sol < 0.02) console.log("Low: send it about 0.05–0.1 SOL so agent payments keep working.");
} catch {
  console.log("Balance: could not read it right now (check your RPC URL), but the address above is correct.");
}
