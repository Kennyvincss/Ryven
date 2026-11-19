import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { PolicyInput, ProfileInput } from "@/lib/server/agents";
import { db, schema } from "@/lib/server/db";
import { logActivity } from "@/lib/server/engine/activity";
import { EngineError } from "@/lib/server/engine/payments";
import { enforceRateLimit, handler, json } from "@/lib/server/http";
import { agentView, listAgents } from "@/lib/server/queries";
import { generateAgentSigner } from "@/lib/server/signer";
import { deriveTreasuryAddress, treasurySeed } from "@/lib/solana/treasury";
import { usdcMintFor } from "@/lib/shared/config";

export const GET = handler(async (req: Request) => {
  const u = new URL(req.url);
  return json({
    agents: await listAgents({ sort: u.searchParams.get("sort") ?? "recent", creator: u.searchParams.get("creator") ?? undefined }),
  });
});

const Body = z.object({ tokenMint: z.string(), acknowledgeMainnet: z.boolean().optional() }).and(ProfileInput).and(PolicyInput);

/** Deploys an agent for a token the caller created: new delegate key + treasury address. */
export const POST = handler(async (req: Request) => {
  const { wallet } = await requireSession();
  enforceRateLimit(req, "deploy", 5, 60_000, wallet);
  const b = Body.parse(await req.json());
  const token = await db.query.tokens.findFirst({ where: eq(schema.tokens.mint, b.tokenMint) });
  if (!token) throw new EngineError("Token not found. Launch it first.", 404);
  if (token.creatorWallet !== wallet) throw new EngineError("Only the token's creator can deploy its agent", 403);
  if (token.network === "mainnet" && b.acknowledgeMainnet !== true) {
    throw new EngineError("This agent will move real USDC. Confirm you understand to deploy it.", 400);
  }
  const existing = await db.query.agents.findFirst({ where: eq(schema.agents.tokenId, token.id) });
  if (existing) throw new EngineError("This token already has an agent", 409);

  const id = randomUUID();
  const signer = generateAgentSigner(id);
  const treasury = deriveTreasuryAddress(new PublicKey(wallet), id).toBase58();

  const agent = await db.transaction(async (tx) => {
    const [a] = await tx
      .insert(schema.agents)
      .values({
        id,
        tokenId: token.id,
        creatorWallet: wallet,
        network: token.network,
        name: b.name,
        description: b.description,
        personality: b.personality,
        objectives: b.objectives,
        instructions: b.instructions,
        avatarSeed: id.slice(0, 8),
        mode: b.mode,
        maxPerTx: b.maxPerTx,
        autoApproveLimit: b.autoApproveLimit,
        dailyLimit: b.dailyLimit,
        categories: b.categories,
        recipientPolicy: b.recipientPolicy,
        signerPubkey: signer.publicKey,
      })
      .returning();
    await tx.insert(schema.agentSigners).values({ agentId: id, ...signer.encrypted });
    const [t] = await tx
      .insert(schema.treasuries)
      .values({ agentId: id, address: treasury, seed: treasurySeed(id), ownerWallet: wallet, mint: usdcMintFor(token.network) })
      .returning();
    return { a, t };
  });
  await logActivity({
    agentId: id,
    type: "deployed",
    status: "completed",
    message: `${b.name} deployed for $${token.symbol}${token.network === "mainnet" ? " (real USDC)" : ""}`,
  });
  return json({ agent: agentView(agent.a, agent.t) });
});
