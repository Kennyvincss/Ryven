/**
 * Hosts Ryyven's image relay (/api/img) may fetch coin images from. Coin icons come from
 * Jupiter's image CDN, IPFS/Arweave gateways and DexScreener. Anything else is refused,
 * so the relay can't be used to reach arbitrary or internal addresses.
 */
const EXACT = new Set([
  "static.datapi.jup.ag",
  "static.jup.ag",
  "ipfs.io",
  "cf-ipfs.com",
  "dweb.link",
  "w3s.link",
  "nftstorage.link",
  "gateway.pinata.cloud",
  "arweave.net",
  "gateway.irys.xyz",
  "dd.dexscreener.com",
  "cdn.dexscreener.com",
  "raw.githubusercontent.com",
]);
const SUFFIXES = [".jup.ag", ".mypinata.cloud", ".ipfs.dweb.link", ".ipfs.w3s.link", ".ipfs.nftstorage.link", ".arweave.net"];

/** Returns the URL if the relay may fetch it (https, allowed host, default port, no credentials), else null. */
export function allowedImageUrl(raw: string | null | undefined): URL | null {
  if (!raw || raw.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.port || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  return EXACT.has(host) || SUFFIXES.some((s) => host.endsWith(s)) ? u : null;
}

/** Image types the relay passes through. SVG is excluded: it can carry scripts. */
export const RELAY_IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|avif)$/i;

/** The relay URL for an external image, or null when it can't be relayed. */
export function relayedImageSrc(src: string): string | null {
  return allowedImageUrl(src) ? `/api/img?u=${encodeURIComponent(src)}` : null;
}
