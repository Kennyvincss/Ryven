import { requireCreator } from "@/lib/server/agents";
import { agentCloseout } from "@/lib/server/agent-delete";
import { handler, json } from "@/lib/server/http";

/** Creator-only: what must be emptied before this agent can be deleted (read live from Solana). */
export const GET = handler(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { agent } = await requireCreator(id);
  return json(await agentCloseout(agent));
});
