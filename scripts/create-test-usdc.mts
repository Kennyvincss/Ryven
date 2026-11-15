/**
 * OPTIONAL: creates a labelled "Test USDC" mint on devnet (6 decimals) whose mint
 * authority is your fee-payer key, so the in-app faucet can hand out test funds.
 * Use this only if you can't get Circle devnet USDC from https://faucet.circle.com.
 *
 *   npm run test-usdc
 */
import "dotenv/config";
import { Connection, Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { MINT_SIZE, TOKEN_PROGRAM_ID, createInitializeMint2Instruction } from "@solana/spl-token";
import bs58 from "bs58";
import { confirmByPolling } from "../src/lib/solana/confirm";

const secret = process.env.FEE_PAYER_SECRET_KEY;
if (!secret) throw new Error("Set FEE_PAYER_SECRET_KEY in .env first (npm run keys)");
const payer = secret.trim().startsWith("[") ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret))) : Keypair.fromSecretKey(bs58.decode(secret));
const conn = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const msg = (e as Error).message;
      if (attempt >= 4) {
        console.error(`\n❌ Could not ${label}: ${msg}`);
        if (/429|Too Many Requests/i.test(msg)) console.error("   → The public devnet server is rate-limiting you. Wait a minute and retry, or use a free Helius devnet RPC URL in SOLANA_RPC_URL.");
        else if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|network/i.test(msg)) console.error("   → Your computer can't reach api.devnet.solana.com. Check your internet, VPN or firewall/antivirus.");
        console.error("");
        process.exit(1);
      }
      console.log(`  (${label} failed, retrying in ${attempt * 3}s: ${msg.slice(0, 120)})`);
      await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
}

console.log(`Fee payer: ${payer.publicKey.toBase58()}`);
console.log(`RPC: ${process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com"}`);
const bal = await withRetry("read the fee payer's SOL balance", () => conn.getBalance(payer.publicKey));
console.log(`Balance: ${bal / 1e9} SOL`);
if (bal < 5_000_000) {
  console.error(`\n❌ The fee payer has no devnet SOL. Go to https://faucet.solana.com, choose Devnet, and send SOL to:\n   ${payer.publicKey.toBase58()}\n`);
  process.exit(1);
}

const mint = Keypair.generate();
const tx = new Transaction().add(
  SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: mint.publicKey,
    space: MINT_SIZE,
    lamports: await withRetry("read rent cost", () => conn.getMinimumBalanceForRentExemption(MINT_SIZE)),
    programId: TOKEN_PROGRAM_ID,
  }),
  createInitializeMint2Instruction(mint.publicKey, 6, payer.publicKey, null, TOKEN_PROGRAM_ID),
);
const { blockhash, lastValidBlockHeight } = await withRetry("get a recent blockhash", () => conn.getLatestBlockhash("confirmed"));
tx.recentBlockhash = blockhash;
tx.feePayer = payer.publicKey;
tx.sign(payer, mint);
const sig = await conn.sendRawTransaction(tx.serialize());
const res = await confirmByPolling(conn, sig, lastValidBlockHeight);
if (res.err) throw new Error(`Mint creation failed: ${JSON.stringify(res.err)}`);

console.log(`\nTest USDC mint created: ${mint.publicKey.toBase58()}`);
console.log(`Transaction: https://explorer.solana.com/tx/${sig}?cluster=devnet\n`);
console.log("Add these lines to your .env:\n");
console.log(`NEXT_PUBLIC_USDC_MINT=${mint.publicKey.toBase58()}`);
console.log(`TEST_USDC_FAUCET_ENABLED=true`);
console.log(`TEST_USDC_MINT_AUTHORITY_SECRET_KEY=<same value as FEE_PAYER_SECRET_KEY>`);
