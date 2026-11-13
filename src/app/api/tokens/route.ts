import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getMint, getTokenMetadata } from "@solana/spl-token";
import { requireSession } from "@/lib/server/auth";
import { db, schema } from "@/lib/server/db";
import { enforceRateLimit, handler, json } from "@/lib/server/http";
import { listTokens, tokenView } from "@/lib/server/queries";
import { connection, getConfirmedTransaction, txSigners } from "@/lib/server/solana";
import { EngineError } from "@/lib/server/engine/payments";
import { LAUNCH_TOKEN_DECIMALS } from "@/lib/shared/config";

export const GET = handler(async (req: Request) => {
  const u = new URL(req.url);
  return json({
    tokens: await listTokens({ sort: u.searchParams.get("sort") ?? "new", creator: u.searchParams.get("creator") ?? undefined }),
  });
});

const url = z.union([z.literal(""), z.url().max(200)]).optional();
const Body = z.object({
  mint: z.string(),
  signature: z.string(),
  metadataUri: z.url(),
  imageUri: z.url().optional(),
  description: z.string().max(1000).default(""),
  website: url,
  twitter: url,
  telegram: url,
});

/**
 * Records a launch ONLY after verifying it on-chain: the transaction landed, was signed
 * by the session wallet, and the mint has the expected metadata, decimals and a
 * permanently revoked mint authority.
 */
export const POST = handler(async (req: Request) => {
  const { wallet } = await requireSession();
  enforceRateLimit(req, "launch", 10, 60_000, wallet);
  const b = Body.parse(await req.json());
  const mintPk = new PublicKey(b.mint);

  let tx = await getConfirmedTransaction(b.signature);
  for (let i = 0; !tx && i < 10; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    tx = await getConfirmedTransaction(b.signature);
  }
  if (!tx) throw new EngineError("Launch transaction not found on-chain yet. Retry in a few seconds.", 404);
  if (tx.meta?.err) throw new EngineError("Launch transaction failed on-chain");
  const signers = txSigners(tx);
  if (!signers.includes(wallet) || !signers.includes(b.mint)) throw new EngineError("Launch transaction was not signed by your wallet", 403);

  const conn = connection();
  const mint = await getMint(conn, mintPk, "confirmed", TOKEN_2022_PROGRAM_ID);
  const meta = await getTokenMetadata(conn, mintPk, "confirmed", TOKEN_2022_PROGRAM_ID);
  if (!meta) throw new EngineError("Mint has no on-chain metadata");
  if (meta.updateAuthority?.toBase58() !== wallet) throw new EngineError("You are not the metadata update authority", 403);
  if (meta.uri !== b.metadataUri) throw new EngineError("On-chain metadata URI does not match");
  if (mint.mintAuthority !== null) throw new EngineError("Mint authority must be revoked (fixed supply)");
  if (mint.decimals !== LAUNCH_TOKEN_DECIMALS || mint.supply === 0n) throw new EngineError("Unexpected mint configuration");

  const [row] = await db
    .insert(schema.tokens)
    .values({
      mint: b.mint,
      name: meta.name,
      symbol: meta.symbol,
      description: b.description,
      imageUri: b.imageUri ?? null,
      metadataUri: meta.uri,
      creatorWallet: wallet,
      tokenProgram: TOKEN_2022_PROGRAM_ID.toBase58(),
      decimals: mint.decimals,
      totalSupply: mint.supply,
      launchMode: "fixed_supply",
      launchStatus: "live",
      launchSignature: b.signature,
      website: b.website || null,
      twitter: b.twitter || null,
      telegram: b.telegram || null,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new EngineError("Token already recorded", 409);
  return json({ token: tokenView(row) });
});
