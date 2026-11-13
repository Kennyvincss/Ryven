import "server-only";
/**
 * Token metadata storage. Uses Pinata (IPFS) when PINATA_JWT is configured; otherwise
 * stores the bytes in Postgres and serves them from /api/blob/:id (clearly app-hosted).
 */
import { db, schema } from "./db";
import { serverEnv } from "./env";
import { publicConfig } from "../shared/config";

export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const MAX_IMAGE_BYTES = 512 * 1024;

async function pinataUpload(bytes: Buffer, contentType: string, filename: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), filename);
  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${serverEnv.pinataJwt}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Pinata upload failed (${res.status}): ${await res.text()}`);
  const { IpfsHash } = (await res.json()) as { IpfsHash: string };
  return `${serverEnv.pinataGateway.replace(/\/$/, "")}/ipfs/${IpfsHash}`;
}

export async function storeBlob(bytes: Buffer, contentType: string, uploader: string, filename: string) {
  if (serverEnv.pinataJwt) return { uri: await pinataUpload(bytes, contentType, filename), storage: "ipfs" as const };
  const [row] = await db.insert(schema.metadataBlobs).values({ contentType, bytes, uploaderWallet: uploader }).returning({ id: schema.metadataBlobs.id });
  return { uri: `${publicConfig.appUrl.replace(/\/$/, "")}/api/blob/${row.id}`, storage: "app" as const };
}
