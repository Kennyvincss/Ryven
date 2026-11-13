/**
 * OPTIONAL: creates a labelled "Test USDC" mint on devnet (6 decimals) whose mint
 * authority is your fee-payer key, so the in-app faucet can hand out test funds.
 * Use this only if you can't get Circle devnet USDC from https://faucet.circle.com.
 *
 *   npx tsx scripts/create-test-usdc.mts
 */
import "dotenv/config";
import { Connection, Keypair } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import bs58 from "bs58";

const secret = process.env.FEE_PAYER_SECRET_KEY;
if (!secret) throw new Error("Set FEE_PAYER_SECRET_KEY in .env first (npm run keys)");
const kp = secret.trim().startsWith("[") ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret))) : Keypair.fromSecretKey(bs58.decode(secret));
const conn = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");

const bal = await conn.getBalance(kp.publicKey);
if (bal < 5_000_000) throw new Error(`Fee payer ${kp.publicKey.toBase58()} needs devnet SOL. Get some at https://faucet.solana.com`);
const mint = await createMint(conn, kp, kp.publicKey, null, 6);
console.log(`\nTest USDC mint created: ${mint.toBase58()}\n`);
console.log("Add these lines to your .env:\n");
console.log(`NEXT_PUBLIC_USDC_MINT=${mint.toBase58()}`);
console.log(`TEST_USDC_FAUCET_ENABLED=true`);
console.log(`TEST_USDC_MINT_AUTHORITY_SECRET_KEY=<same value as FEE_PAYER_SECRET_KEY>`);
