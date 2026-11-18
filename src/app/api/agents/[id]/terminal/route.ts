import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireCreator } from "@/lib/server/agents";
import { runInstruction, type AgentEvent } from "@/lib/server/ai/agent";
import { db, schema } from "@/lib/server/db";
import { enforceRateLimit, handler, json } from "@/lib/server/http";

type P = { params: Promise<{ id: string }> };
const Body = z.object({ text: z.string().trim().min(1).max(2000) });

export const GET = handler(async (_req: Request, { params }: P) => {
  const { id } = await params;
  await requireCreator(id);
  const rows = await db.select().from(schema.agentMessages).where(eq(schema.agentMessages.agentId, id)).orderBy(desc(schema.agentMessages.createdAt)).limit(40);
  return json({ messages: rows.reverse().map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })) });
});

/** Streams agent events as newline-delimited JSON while the instruction runs. */
export const POST = handler(async (req: Request, { params }: P) => {
  const { id } = await params;
  const { session } = await requireCreator(id);
  enforceRateLimit(req, "terminal", 12, 60_000, session.wallet);
  const { text } = Body.parse(await req.json());
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AgentEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await runInstruction(id, text, emit);
      } catch (e) {
        emit({ type: "error", message: (e as Error).message });
        emit({ type: "done" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
});

/** Waits on the AI and/or Solana confirmation: allow up to 5 minutes on serverless hosts (Vercel). */
export const maxDuration = 300;
