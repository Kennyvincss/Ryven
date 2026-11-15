import "server-only";
/**
 * Token metadata storage. Uses Pinata (IPFS) when PINATA_JWT is configured; otherwise
 * stores the bytes in Postgres and serves them from /api/blob/:id (clearly app-hosted).
 */
import { db, schema } from "./db";
import { serverEnv } from "./env";
import { outboundFetch } from "./net";
import { publicConfig } from "../shared/config";

export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const MAX_IMAGE_BYTES = 512 * 1024;

/**
 * Pinata v3 upload (https://uploads.pinata.cloud/v3/files, network=public), the flow
 * PumpPortal documents for pump.fun launches. Returns an ipfs.io gateway URL.
 */
export async function pinataUpload(bytes: Buffer, contentType: string, filename: string): Promise<string> {
  if (!serverEnv.pinataJwt) throw new Error("PINATA_JWT is not configured");
  const form = new FormData();
  form.append("network", "public");
  form.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), filename);
  const res = await outboundFetch("https://uploads.pinata.cloud/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${serverEnv.pinataJwt}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Pinata upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { data?: { cid?: string } };
  if (!json.data?.cid) throw new Error("Pinata upload returned no CID");
  return `https://ipfs.io/ipfs/${json.data.cid}`;
}

export async function storeBlob(bytes: Buffer, contentType: string, uploader: string, filename: string) {
  if (serverEnv.pinataJwt) return { uri: await pinataUpload(bytes, contentType, filename), storage: "ipfs" as const };
  const [row] = await db.insert(schema.metadataBlobs).values({ contentType, bytes, uploaderWallet: uploader }).returning({ id: schema.metadataBlobs.id });
  return { uri: `${publicConfig.appUrl.replace(/\/$/, "")}/api/blob/${row.id}`, storage: "app" as const };
}
