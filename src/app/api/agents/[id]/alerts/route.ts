import { requireCreator } from "@/lib/server/agents";
import { alertView, listAlerts } from "@/lib/server/alerts";
import { handler, json } from "@/lib/server/http";

type P = { params: Promise<{ id: string }> };

/** Creator-only: the agent's price alerts (active first, then recent history). */
export const GET = handler(async (_req: Request, { params }: P) => {
  const { id } = await params;
  await requireCreator(id);
  const alerts = await listAlerts(id, { limit: 50 });
  return json({ alerts: alerts.map(alertView) });
});
