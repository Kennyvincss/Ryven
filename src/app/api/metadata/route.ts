import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { enforceRateLimit, handler, json } from "@/lib/server/http";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, storeBlob } from "@/lib/server/metadata";
import { EngineError } from "@/lib/server/engine/payments";
import { TOKEN_LIMITS } from "@/lib/solana/launch";

const url = z.union([z.literal(""), z.url().max(200)]).optional();
const Body = z.object({
  name: z.string().trim().min(1).max(TOKEN_LIMITS.name),
  symbol: z.string().trim().min(1).max(TOKEN_LIMITS.symbol).regex(/^[A-Za-z0-9$]+$/),
  description: z.string().trim().max(1000).default(""),
  image: z.string().startsWith("data:"),
  website: url,
  twitter: url,
  telegram: url,
});

/** Uploads the token image + Metaplex-style JSON metadata and returns their URIs. */
export const POST = handler(async (req: Request) => {
  const { wallet } = await requireSession();
  enforceRateLimit(req, "metadata", 10, 60_000, wallet);
  const b = Body.parse(await req.json());
  const m = /^data:([\w/+.-]+);base64,(.+)$/.exec(b.image);
  if (!m || !ALLOWED_IMAGE_TYPES.includes(m[1])) throw new EngineError("Image must be PNG, JPEG, GIF or WebP");
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > MAX_IMAGE_BYTES) throw new EngineError("Image must be 512 KB or smaller");

  const image = await storeBlob(bytes, m[1], wallet, `${b.symbol}.${m[1].split("/")[1]}`);
  const metadata = {
    name: b.name,
    symbol: b.symbol,
    description: b.description,
    image: image.uri,
    external_url: b.website || undefined,
    extensions: { website: b.website || undefined, twitter: b.twitter || undefined, telegram: b.telegram || undefined },
    properties: { files: [{ uri: image.uri, type: m[1] }], category: "image" },
    createdOn: "Ryven",
  };
  const meta = await storeBlob(Buffer.from(JSON.stringify(metadata)), "application/json", wallet, `${b.symbol}.json`);
  if (meta.uri.length > TOKEN_LIMITS.uri) throw new EngineError("Metadata URI too long; set a shorter NEXT_PUBLIC_APP_URL");
  return json({ metadataUri: meta.uri, imageUri: image.uri, storage: meta.storage });
});
