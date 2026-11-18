import { requireCreator } from "@/lib/server/agents";
import { alertView, cancelAlert } from "@/lib/server/alerts";
import { handler, json } from "@/lib/server/http";

type P = { params: Promise<{ id: string; alertId: string }> };

/** Creator-only: cancel an active alert. */
export const DELETE = handler(async (_req: Request, { params }: P) => {
  const { id, alertId } = await params;
  await requireCreator(id);
  return json({ alert: alertView(await cancelAlert(id, alertId)) });
});
