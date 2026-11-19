import { z } from "zod";
import { descriptionField, nameField, socialField, symbolField } from "@/lib/server/launch-input";
import { requireSession } from "@/lib/server/auth";
import { enforceRateLimit, handler, json } from "@/lib/server/http";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, storeBlob } from "@/lib/server/metadata";
import { EngineError } from "@/lib/server/engine/payments";
import { TOKEN_LIMITS } from "@/lib/solana/launch";
import { serverEnv } from "@/lib/server/env";
import { APP_NETWORK, publicConfig } from "@/lib/shared/config";

const Body = z.object({
  name: nameField.max(TOKEN_LIMITS.name, `Name can be at most ${TOKEN_LIMITS.name} characters`),
  symbol: symbolField(TOKEN_LIMITS.symbol),
  description: descriptionField,
  image: z.string().startsWith("data:", "Add a coin image"),
  website: socialField("website"),
  twitter: socialField("twitter"),
  telegram: socialField("telegram"),
});

/** Uploads the token image + Metaplex-style JSON metadata and returns their URIs. */
export const POST = handler(async (req: Request) => {
  const { wallet } = await requireSession();
  enforceRateLimit(req, "metadata", 10, 60_000, wallet);
  const b = Body.parse(await req.json());
  if (APP_NETWORK === "mainnet" && !serverEnv.pinataJwt && /localhost|127\.0\.0\.1/.test(publicConfig.appUrl)) {
    throw new EngineError(
      process.env.NODE_ENV !== "production"
        ? "The coin's image and metadata must be publicly reachable. Set PINATA_JWT (free at app.pinata.cloud) or deploy Ryyven to a public URL (NEXT_PUBLIC_APP_URL)."
        : "Coin images can't be uploaded right now. Please try again later.",
      503,
    );
  }
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
    createdOn: "Ryyven",
  };
  const meta = await storeBlob(Buffer.from(JSON.stringify(metadata)), "application/json", wallet, `${b.symbol}.json`);
  if (meta.uri.length > TOKEN_LIMITS.uri) throw new EngineError("Metadata URI too long; set a shorter NEXT_PUBLIC_APP_URL");
  return json({ metadataUri: meta.uri, imageUri: image.uri, storage: meta.storage });
});
