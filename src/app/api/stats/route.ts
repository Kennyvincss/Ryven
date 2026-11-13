import { handler, json } from "@/lib/server/http";
import { platformStats } from "@/lib/server/queries";

export const GET = handler(async () => json(await platformStats()));
