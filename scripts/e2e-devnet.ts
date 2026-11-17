/**
 * End-to-end hackathon demo against a RUNNING Ryven server on Solana devnet.
 * Every step is a real HTTP call / real devnet transaction. Nothing is mocked.
 *
 *   1. npm run test-usdc        (once: creates a Test-USDC mint, add it to .env)
 *   2. npm run dev              (in another terminal)
 *   3. npx tsx scripts/e2e-devnet.ts
 *
 * Requires FEE_PAYER_SECRET_KEY with ≥0.3 devnet SOL and the Test-USDC faucet enabled.
 */
import "dotenv/config";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  ACCOUNT_SIZE,
  getAccountLenForMint,
  getMint,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, type Signer } from "@solana/web3.js";
import { confirmByPolling } from "../src/lib/solana/confirm";
import { buildLaunchTransaction } from "../src/lib/solana/launch";
import { buildFundTreasuryInstructions } from "../src/lib/solana/treasury";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const conn = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
const parseKey = (v: string) => (v.trim().startsWith("[") ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(v))) : Keypair.fromSecretKey(bs58.decode(v)));
const feePayer = parseKey(process.env.FEE_PAYER_SECRET_KEY!);
const usdcAuthority = parseKey(process.env.TEST_USDC_MINT_AUTHORITY_SECRET_KEY ?? process.env.FEE_PAYER_SECRET_KEY!);
const USDC = new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT!);

/** send + confirm via HTTP polling (works without WebSockets) */
async function sendAndConfirmTransaction(c: Connection, tx: Transaction, signers: Signer[]) {
  const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = signers[0].publicKey;
  tx.sign(...signers);
  const sig = await c.sendRawTransaction(tx.serialize());
  const r = await confirmByPolling(c, sig, lastValidBlockHeight);
  if (r.err) throw new Error(`tx ${sig} failed: ${JSON.stringify(r.err)}`);
  return sig;
}

let cookie = "";
async function call<T = unknown>(path: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(BASE + path, {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers: { "content-type": "application/json", cookie, origin: BASE },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text}`);
  return data as T;
}
const step = (n: number, s: string) => console.log(`\n\x1b[32mSTEP ${n}\x1b[0m ${s}`);
const ok = (s: string) => console.log(`  ✓ ${s}`);
const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error("ASSERTION FAILED: " + m);
  ok(m);
}

async function main() {
  if (process.env.NEXT_PUBLIC_SOLANA_CLUSTER !== "devnet") {
    throw new Error("This test spends funds and only runs in test mode: set NEXT_PUBLIC_SOLANA_CLUSTER=devnet (and a devnet Test-USDC mint) in .env.");
  }
  const creator = Keypair.generate();
  const contributors = [Keypair.generate(), Keypair.generate(), Keypair.generate(), Keypair.generate()];
  console.log("Creator wallet:", creator.publicKey.toBase58());

  step(0, "Fund creator with devnet SOL (from fee payer) and 100 Test USDC");
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(SystemProgram.transfer({ fromPubkey: feePayer.publicKey, toPubkey: creator.publicKey, lamports: 0.06 * LAMPORTS_PER_SOL })),
    [feePayer],
  );
  const creatorAta = getAssociatedTokenAddressSync(USDC, creator.publicKey);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(feePayer.publicKey, creatorAta, creator.publicKey, USDC),
      createMintToInstruction(USDC, creatorAta, usdcAuthority.publicKey, 100_000_000n),
    ),
    usdcAuthority.publicKey.equals(feePayer.publicKey) ? [feePayer] : [feePayer, usdcAuthority],
  );
  ok("creator funded");

  step(1, "Connect wallet: Sign-In With Solana");
  const { nonce, message } = await call<{ nonce: string; message: string }>("/api/auth/nonce", { wallet: creator.publicKey.toBase58() });
  const sig = nacl.sign.detached(new TextEncoder().encode(message), creator.secretKey);
  await call("/api/auth/verify", { wallet: creator.publicKey.toBase58(), nonce, signature: bs58.encode(sig) });
  const me = await call<{ session: { wallet: string } }>("/api/auth/me");
  assert(me.session?.wallet === creator.publicKey.toBase58(), "server session established by ed25519 signature");

  step(2, "Launch $DOGE2 (Token-2022 + on-chain metadata, fixed supply)");
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const meta = await call<{ metadataUri: string; imageUri: string }>("/api/metadata", { name: "Doge Two", symbol: "DOGE2", description: "The sequel. Run by an AI.", image: png });
  const { tx: launchTx, mint } = await buildLaunchTransaction({ connection: conn, creator: creator.publicKey, name: "Doge Two", symbol: "DOGE2", uri: meta.metadataUri, supply: 1_000_000_000_000_000n });
  const launchSig = await sendAndConfirmTransaction(conn, launchTx, [creator, mint]);
  const tok = await call<{ token: { mint: string } }>("/api/tokens", { mint: mint.publicKey.toBase58(), signature: launchSig, metadataUri: meta.metadataUri, imageUri: meta.imageUri, description: "The sequel. Run by an AI." });
  assert(tok.token.mint === mint.publicKey.toBase58(), `token verified on-chain & recorded: ${explorer(launchSig)}`);

  step(3, "Deploy DOGE2 Assistant (max 5 / payment, daily 20)");
  const { agent } = await call<{ agent: { id: string; signerPubkey: string; treasury: { address: string } } }>("/api/agents", {
    tokenMint: mint.publicKey.toBase58(),
    name: "DOGE2 Assistant",
    description: "Treasury agent for $DOGE2",
    personality: "Upbeat, precise",
    objectives: "Manage community rewards, monitor contributor activity and distribute approved rewards.",
    instructions: "",
    mode: "autonomous",
    maxPerTx: "5",
    autoApproveLimit: "5",
    dailyLimit: "20",
    categories: ["community_rewards"],
    recipientPolicy: "allowlist_only",
  });
  ok(`agent ${agent.id} · delegate key ${agent.signerPubkey} · treasury ${agent.treasury.address}`);

  step(4, "Fund treasury with 100 USDC and delegate a 100 USDC on-chain allowance (creator-signed)");
  const fundTx = new Transaction().add(
    ...buildFundTreasuryInstructions({
      owner: creator.publicKey,
      agentId: agent.id,
      agentSigner: new PublicKey(agent.signerPubkey),
      mint: USDC,
      createAccount: true,
      rentLamports: await conn.getMinimumBalanceForRentExemption(ACCOUNT_SIZE),
      depositAmount: 100_000_000n,
      allowance: 100_000_000n,
    }),
  );
  const fundSig = await sendAndConfirmTransaction(conn, fundTx, [creator]);
  await call(`/api/agents/${agent.id}/treasury`, { signature: fundSig });
  const t1 = await call<{ onchain: { balance: string; allowance: string; delegatedToAgent: boolean } }>(`/api/agents/${agent.id}/treasury`);
  assert(t1.onchain.balance === "100" && t1.onchain.delegatedToAgent, `treasury holds 100 on-chain, agent delegated: ${explorer(fundSig)}`);

  step(5, "Register three approved contributors (verifiable registry)");
  for (const [i, c] of contributors.slice(0, 3).entries()) {
    await call(`/api/agents/${agent.id}/contributors`, { wallet: c.publicKey.toBase58(), handle: `contributor${i + 1}`, role: "community", activityScore: 30 - i * 5 });
  }
  ok("3 contributors approved");

  const ai = (await call<{ aiEnabled: boolean }>("/api/config")).aiEnabled;
  const confirmedSigs: string[] = [];
  if (ai) {
    step(6, 'AI terminal: "Reward three approved community contributors with 5 USDC each."');
    const res = await fetch(`${BASE}/api/agents/${agent.id}/terminal`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ text: "Reward three approved community contributors with 5 USDC each." }),
    });
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    for (const e of lines) {
      if (e.type === "status") console.log(`    [${e.status}] ${e.message}`);
      if (e.type === "assistant") console.log(`    agent: ${e.text}`);
      if (e.type === "payment" && e.payment.status === "confirmed") confirmedSigs.push(e.payment.signature);
      if (e.type === "error") console.log(`    error: ${e.message}`);
    }
  } else {
    step(6, "AI not configured (no ANTHROPIC_API_KEY): issuing the same 3 payments through the manual route (same policy engine & signer)");
    for (const [i, c] of contributors.slice(0, 3).entries()) {
      const r = await call<{ payment: { status: string; signature: string; error: string | null } }>(`/api/agents/${agent.id}/payments`, {
        recipient: c.publicKey.toBase58(),
        amount: "5",
        category: "community_rewards",
        reason: `Community reward #${i + 1}`,
        idempotencyKey: crypto.randomUUID(),
      });
      if (r.payment.status === "confirmed") confirmedSigs.push(r.payment.signature);
      else console.log("   ", r.payment);
    }
  }
  assert(confirmedSigs.length === 3, "three payments confirmed on-chain");
  confirmedSigs.forEach((s) => console.log("    " + explorer(s)));

  step(7, "Verify recipients and treasury directly on Solana");
  for (const c of contributors.slice(0, 3)) {
    const bal = await conn.getTokenAccountBalance(getAssociatedTokenAddressSync(USDC, c.publicKey));
    assert(bal.value.amount === "5000000", `${c.publicKey.toBase58().slice(0, 6)}… holds 5 USDC`);
  }
  const t2 = await call<{ onchain: { balance: string; allowance: string }; budget: { usedToday: string; remainingToday: string } }>(`/api/agents/${agent.id}/treasury`);
  assert(t2.onchain.balance === "85", "treasury balance is 85 on-chain");
  assert(t2.onchain.allowance === "85", "remaining on-chain allowance is 85");
  assert(t2.budget.remainingToday === "5", "remaining daily budget is 5");

  step(8, "Policy enforcement (negative tests)");
  const pay = (recipient: PublicKey, amount: string) =>
    call<{ payment: { status: string; error: string | null } }>(`/api/agents/${agent.id}/payments`, {
      recipient: recipient.toBase58(),
      amount,
      category: "community_rewards",
      reason: "policy test",
      idempotencyKey: crypto.randomUUID(),
    });
  assert((await pay(contributors[0].publicKey, "10")).payment.status === "rejected", "10 USDC > max per tx → rejected");
  assert((await pay(contributors[3].publicKey, "1")).payment.status === "rejected", "unlisted recipient → rejected");
  assert((await pay(contributors[0].publicKey, "1")).payment.status === "awaiting_approval", "repeat payment to same recipient within 24h → needs approval");
  await call(`/api/agents/${agent.id}/status`, { action: "pause" });
  assert((await pay(contributors[1].publicKey, "1")).payment.status === "rejected", "paused agent → rejected");
  await call(`/api/agents/${agent.id}/status`, { action: "resume" });

  step(9, "Token rewards: pay a contributor in $DOGE2 from a creator-owned Token-2022 treasury");
  await call(`/api/agents/${agent.id}`, { tokenPolicy: { maxPerTx: "1000", autoApproveLimit: "1000", dailyLimit: "5000" } }, "PATCH");
  const tt = await call<{ address: string; mint: string; tokenProgram: string; decimals: number; enabled: boolean }>(`/api/agents/${agent.id}/treasury?asset=token`);
  assert(tt.enabled && tt.mint === mint.publicKey.toBase58(), "token rewards enabled; token treasury derived for $DOGE2");
  const t22 = new PublicKey(tt.tokenProgram);
  const mintInfo = await getMint(conn, mint.publicKey, "confirmed", t22);
  const size = getAccountLenForMint(mintInfo);
  const fundTokTx = new Transaction().add(
    ...buildFundTreasuryInstructions({
      owner: creator.publicKey,
      agentId: agent.id,
      agentSigner: new PublicKey(agent.signerPubkey),
      mint: mint.publicKey,
      createAccount: true,
      rentLamports: await conn.getMinimumBalanceForRentExemption(size),
      depositAmount: 10_000_000_000n, // 10,000 DOGE2
      allowance: 5_000_000_000n, // 5,000 DOGE2
      asset: "token",
      programId: t22,
      decimals: 6,
      accountSize: size,
    }),
  );
  const fundTokSig = await sendAndConfirmTransaction(conn, fundTokTx, [creator]);
  await call(`/api/agents/${agent.id}/treasury`, { signature: fundTokSig });
  const tt2 = await call<{ onchain: { balance: string; allowance: string; delegatedToAgent: boolean } }>(`/api/agents/${agent.id}/treasury?asset=token`);
  assert(tt2.onchain.balance === "10000" && tt2.onchain.allowance === "5000" && tt2.onchain.delegatedToAgent, `token treasury holds 10,000 $DOGE2, 5,000 delegated: ${explorer(fundTokSig)}`);
  const tokPay = await call<{ payment: { status: string; signature: string; error: string | null; unit: string } }>(`/api/agents/${agent.id}/payments`, {
    recipient: contributors[1].publicKey.toBase58(),
    amount: "1000",
    category: "community_rewards",
    reason: "Token reward",
    idempotencyKey: crypto.randomUUID(),
    asset: "token",
  });
  assert(tokPay.payment.status === "confirmed" && tokPay.payment.unit === "$DOGE2", `1,000 $DOGE2 paid on-chain: ${explorer(tokPay.payment.signature)}`);
  const recvTok = await conn.getTokenAccountBalance(getAssociatedTokenAddressSync(mint.publicKey, contributors[1].publicKey, false, t22));
  assert(recvTok.value.uiAmountString === "1000", "recipient holds 1,000 $DOGE2 (read from Solana)");
  const overTok = await call<{ payment: { status: string } }>(`/api/agents/${agent.id}/payments`, {
    recipient: contributors[2].publicKey.toBase58(),
    amount: "2000",
    category: "community_rewards",
    reason: "too much",
    idempotencyKey: crypto.randomUUID(),
    asset: "token",
  });
  assert(overTok.payment.status === "rejected", "2,000 $DOGE2 > token max per payment → rejected");
  const usdcStill = await call<{ onchain: { balance: string } }>(`/api/agents/${agent.id}/treasury`);
  assert(usdcStill.onchain.balance === "85", "USDC treasury untouched by token payments (still 85)");

  console.log("\n\x1b[32mE2E PASSED\x1b[0m. Agent console:", `${BASE}/console/${agent.id}`);
}

main().catch((e) => {
  console.error("\n\x1b[31mE2E FAILED\x1b[0m", e);
  process.exit(1);
});
