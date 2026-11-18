import { requireCreator } from "@/lib/server/agents";
import { briefView, generateBrief, listBriefs } from "@/lib/server/ai/brief";
import { enforceRateLimit, handler, json } from "@/lib/server/http";

type P = { params: Promise<{ id: string }> };

/** Creator-only: recent wallet briefs and the brief schedule. */
export const GET = handler(async (_req: Request, { params }: P) => {
  const { id } = await params;
  const { agent } = await requireCreator(id);
  const briefs = await listBriefs(id, 10);
  return json({
    settings: { enabled: agent.briefEnabled, hourUtc: agent.briefHourUtc, lastAt: agent.briefLastAt?.toISOString() ?? null },
    briefs: briefs.map(briefView),
  });
});

/** Creator-only: generate a brief now. */
export const POST = handler(async (req: Request, { params }: P) => {
  const { id } = await params;
  const { session } = await requireCreator(id);
  enforceRateLimit(req, "brief", 3, 10 * 60_000, session.wallet);
  return json({ brief: briefView(await generateBrief(id, "manual")) });
});
