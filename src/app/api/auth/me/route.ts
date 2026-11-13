import { getSession } from "@/lib/server/auth";
import { handler, json } from "@/lib/server/http";

export const GET = handler(async () => json({ session: await getSession() }));
