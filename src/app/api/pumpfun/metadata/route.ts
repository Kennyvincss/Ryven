import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { enforceRateLimit, handler, json } from "@/lib/server/http";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, pinataUpload } from "@/lib/server/metadata";
import { EngineError } from "@/lib/server/engine/payments";
import { requirePumpFunEnabled } from "@/lib/server/pumpfun-routes";

const url = z.union([z.literal(""), z.url().max(200)]).optional();
const Body = z.object({
  name: z.string().trim().min(1).max(32),
  symbol: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9$]+$/),
  description: z.string().trim().max(1000).default(""),
  image: z.string().startsWith("data:"),
  website: url,
  twitter: url,
  telegram: url,
});

/** Uploads image + metadata JSON to IPFS (Pinata), in the format PumpPortal documents. */
export const POST = handler(async (req: Request) => {
  requirePumpFunEnabled();
  const { wallet } = await requireSession();
  enforceRateLimit(req, "pump-meta", 6, 60_000, wallet);
  const b = Body.parse(await req.json());
  const m = /^data:([\w/+.-]+);base64,(.+)$/.exec(b.image);
  if (!m || !ALLOWED_IMAGE_TYPES.includes(m[1])) throw new EngineError("Image must be PNG, JPEG, GIF or WebP");
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > MAX_IMAGE_BYTES) throw new EngineError("Image must be 512 KB or smaller");
  const upload = async (data: Buffer, type: string, name: string) => {
    try {
      return await pinataUpload(data, type, name);
    } catch (e) {
      throw new EngineError(`Could not upload to IPFS (Pinata): ${(e as Error).message}. Check PINATA_JWT and your internet connection.`, 502);
    }
  };
  const image = await upload(bytes, m[1], `${b.symbol}.${m[1].split("/")[1]}`);
  const metadata = {
    name: b.name,
    symbol: b.symbol,
    image,
    description: b.description,
    twitter: b.twitter || "",
    telegram: b.telegram || "",
    website: b.website || "",
  };
  const metadataUri = await upload(Buffer.from(JSON.stringify(metadata)), "application/json", `${b.symbol}.json`);
  return json({ metadataUri, imageUri: image });
});
