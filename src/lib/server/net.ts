import "server-only";
/**
 * Outbound HTTP for server code. Uses the platform fetch normally; when HTTPS_PROXY is
 * set (corporate networks, sandboxes) it routes through that proxy, because Next.js's
 * patched fetch ignores proxy environment variables.
 */
let dispatcher: import("undici").Dispatcher | null = null;

export async function outboundFetch(input: string, init: RequestInit = {}): Promise<Response> {
  // No proxy, or Node itself routes fetch through it (NODE_USE_ENV_PROXY=1): platform fetch.
  if (!process.env.HTTPS_PROXY || process.env.NODE_USE_ENV_PROXY === "1") return fetch(input, init);
  const undici = await import("undici");
  dispatcher ??= new undici.EnvHttpProxyAgent();
  let { body, headers } = init;
  if (body instanceof FormData) {
    // Serialize multipart bodies ourselves so they work across undici versions.
    const encoded = new Response(body);
    headers = { ...(headers as Record<string, string>), "content-type": encoded.headers.get("content-type")! };
    body = Buffer.from(await encoded.arrayBuffer());
  }
  const res = await undici.fetch(input, { ...(init as object), body, headers, dispatcher } as Parameters<typeof undici.fetch>[1]);
  return res as unknown as Response;
}
