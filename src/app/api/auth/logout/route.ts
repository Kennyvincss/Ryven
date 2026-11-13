import { signOut } from "@/lib/server/auth";
import { handler, json } from "@/lib/server/http";

export const POST = handler(async () => {
  await signOut();
  return json({ ok: true });
});
