import { z } from "zod";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getMint, getTokenMetadata } from "@solana/spl-token";
import { requireSession } from "@/lib/server/auth";
import { db, schema } from "@/lib/server/db";
import { EngineError } from "@/lib/server/engine/payments";
import { enforceRateLimit, handler, json } from "@/lib/server/http";
import { PumpFunError, validateCreateTransaction } from "@/lib/server/pumpfun";
import { requirePumpFunEnabled } from "@/lib/server/pumpfun-routes";
import { mainnetConnection } from "@/lib/server/solana";
import { tokenView } from "@/lib/server/queries";
import bs58 from "bs58";

const url = z.union([z.literal(""), z.url().max(200)]).optional();
const Body = z.object({
  signedTransaction: z.string().max(4000),
  mint: z.string().min(32).max(44),
  name: z.string().trim().min(1).max(32),
  symbol: z.string().trim().min(1).max(10),
  description: z.string().max(1000).default(""),
  metadataUri: z.string().startsWith("https://ipfs.io/ipfs/"),
  imageUri: z.string().startsWith("https://ipfs.io/ipfs/").optional(),
  website: url,
  twitter: url,
  telegram: url,
});

/**
 * Re-validates the wallet-signed transaction, sends it to Solana MAINNET, waits for
 * confirmation, checks the mint exists on-chain, then lists the coin on Ryven.
 */
export const POST = handler(async (req: Request) => {
  requirePumpFunEnabled();
  const { wallet } = await requireSession();
  enforceRateLimit(req, "pump-submit", 10, 60_000, wallet);
  const b = Body.parse(await req.json());

  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(Buffer.from(b.signedTransaction, "base64"));
    validateCreateTransaction(tx, wallet, b.mint);
  } catch (e) {
    throw new EngineError(e instanceof PumpFunError ? e.message : "Invalid signed transaction", 400);
  }
  if (tx.signatures.length !== 2 || tx.signatures.some((s) => s.every((x) => x === 0))) {
    throw new EngineError("Transaction is missing a signature (wallet or mint)", 400);
  }
  const signature = bs58.encode(tx.signatures[0]);
  const conn = mainnetConnection();

  try {
    await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 5 });
  } catch (e) {
    const msg = (e as Error).message;
    if (/already been processed/i.test(msg) === false) {
      if (/Blockhash not found/i.test(msg)) throw new EngineError("The transaction expired before it was sent. Please launch again.", 409);
      throw new EngineError(`Solana rejected the launch: ${msg.slice(0, 300)}`, 400);
    }
  }

  // Confirm by polling over HTTP; give up once the blockhash can no longer land.
  let landed = false;
  for (let i = 0; i < 90 && !landed; i++) {
    const { value } = await conn.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const st = value[0];
    if (st?.err) throw new EngineError(`Launch transaction failed on-chain: ${JSON.stringify(st.err)}`, 400);
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) landed = true;
    else {
      if (i % 5 === 4 && !(await conn.isBlockhashValid(tx.message.recentBlockhash, { commitment: "confirmed" })).value) {
        const again = (await conn.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
        if (!again) throw new EngineError("The launch transaction expired without landing (no SOL was spent). Please try again.", 409);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (!landed) throw new EngineError(`Still waiting for confirmation. Check https://solscan.io/tx/${signature} and refresh later.`, 504);

  const mintPk = new PublicKey(b.mint);
  const info = await conn.getAccountInfo(mintPk, "confirmed");
  if (!info) throw new EngineError("The new coin was not found on Solana after confirmation", 502);
  const mint = await getMint(conn, mintPk, "confirmed", info.owner);
  let name = b.name;
  let symbol = b.symbol;
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    const meta = await getTokenMetadata(conn, mintPk, "confirmed", TOKEN_2022_PROGRAM_ID).catch(() => null);
    if (meta) {
      name = meta.name;
      symbol = meta.symbol;
    }
  }

  const [row] = await db
    .insert(schema.tokens)
    .values({
      mint: b.mint,
      name,
      symbol,
      description: b.description,
      imageUri: b.imageUri ?? null,
      metadataUri: b.metadataUri,
      creatorWallet: wallet,
      tokenProgram: info.owner.toBase58(),
      decimals: mint.decimals,
      totalSupply: mint.supply,
      launchMode: "pumpfun",
      launchStatus: "live",
      launchSignature: signature,
      network: "mainnet",
      website: b.website || null,
      twitter: b.twitter || null,
      telegram: b.telegram || null,
    })
    .onConflictDoNothing()
    .returning();
  const token = row ?? (await db.query.tokens.findFirst({ where: (t, { eq }) => eq(t.mint, b.mint) }));
  return json({ token: token ? tokenView(token) : null, signature });
});
