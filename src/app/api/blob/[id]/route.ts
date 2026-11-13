import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { db, schema } from "@/lib/server/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const row = await db.query.metadataBlobs.findFirst({ where: eq(schema.metadataBlobs.id, id) });
  if (!row) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(row.bytes), {
    headers: {
      "content-type": row.contentType,
      "cache-control": "public, max-age=31536000, immutable",
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
    },
  });
}
