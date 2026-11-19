import { RELAY_IMAGE_TYPES, allowedImageUrl } from "@/lib/shared/image-hosts";
import { enforceRateLimit, handler } from "@/lib/server/http";
import { outboundFetch } from "@/lib/server/net";

const MAX_BYTES = 3 * 1024 * 1024;

function fail(status: number) {
  return new Response(null, { status, headers: { "cache-control": "public, max-age=300" } });
}

/**
 * Coin image relay. Some image hosts refuse images embedded on other sites, so when a
 * coin icon fails to load directly the browser asks for it here. Only https images from
 * known coin-image hosts, only raster types, max 3 MB; cached by the CDN.
 */
export const GET = handler(async (req: Request) => {
  enforceRateLimit(req, "img", 900, 60_000);
  let url = allowedImageUrl(new URL(req.url).searchParams.get("u"));
  if (!url) return fail(400);
  let res: Response | null = null;
  // Follow at most 3 redirects, re-checking every hop against the allowlist (IPFS gateways redirect).
  for (let hop = 0; hop < 4; hop++) {
    res = await outboundFetch(url.href, { redirect: "manual", signal: AbortSignal.timeout(8000), headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" } }).catch(() => null);
    if (!res) return fail(502);
    if (res.status >= 300 && res.status < 400) {
      const next = allowedImageUrl(res.headers.get("location") ? new URL(res.headers.get("location")!, url).href : null);
      if (!next) return fail(502);
      url = next;
      res = null;
      continue;
    }
    break;
  }
  if (!res || !res.ok) return fail(res?.status === 404 ? 404 : 502);
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!RELAY_IMAGE_TYPES.test(type)) return fail(415);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return fail(413);
  const body = await res.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return fail(413);
  return new Response(body, {
    headers: {
      "content-type": type,
      "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
});
