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

const bal = await conn.getBalance(payer.publicKey);
if (bal < 5_000_000) throw new Error(`Fee payer ${payer.publicKey.toBase58()} needs devnet SOL. Get some at https://faucet.solana.com`);

const mint = Keypair.generate();
const tx = new Transaction().add(
  SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: mint.publicKey,
    space: MINT_SIZE,
    lamports: await conn.getMinimumBalanceForRentExemption(MINT_SIZE),
    programId: TOKEN_PROGRAM_ID,
  }),
  createInitializeMint2Instruction(mint.publicKey, 6, payer.publicKey, null, TOKEN_PROGRAM_ID),
);
const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
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
