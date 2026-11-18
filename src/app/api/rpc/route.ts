import { serverEnv } from "@/lib/server/env";
import { EngineError } from "@/lib/server/engine/payments";
import { enforceRateLimit, handler, json } from "@/lib/server/http";
import { outboundFetch } from "@/lib/server/net";

/**
 * Solana JSON-RPC relay for the browser. The real RPC URL (with its API key) stays on the
 * server; browsers only ever see /api/rpc. Limited to the methods the app and wallets need,
 * rate-limited per visitor, with a size cap, so the key can't be used as a free general RPC.
 */
const ALLOWED_METHODS = new Set([
  "getAccountInfo",
  "getBalance",
  "getBlockHeight",
  "getEpochInfo",
  "getFeeForMessage",
  "getGenesisHash",
  "getHealth",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
  "getMultipleAccounts",
  "getParsedAccountInfo",
  "getRecentPrioritizationFees",
  "getSignatureStatuses",
  "getSignaturesForAddress",
  "getSlot",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getTokenLargestAccounts",
  "getTokenSupply",
  "getTransaction",
  "getVersion",
  "isBlockhashValid",
  "sendTransaction",
  "simulateTransaction",
]);
const MAX_BODY_BYTES = 256 * 1024;
const MAX_BATCH = 20;

type RpcRequest = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown };

function upstreamFor(network: string | null) {
  if (network === "devnet") return serverEnv.rpcUrl.includes("devnet") ? serverEnv.rpcUrl : "https://api.devnet.solana.com";
  return serverEnv.mainnetRpcUrl;
}

export const POST = handler(async (req: Request) => {
  enforceRateLimit(req, "rpc", 600, 60_000);
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) throw new EngineError("Request too large", 413);
  let body: RpcRequest | RpcRequest[];
  try {
    body = JSON.parse(raw);
  } catch {
    throw new EngineError("Invalid JSON", 400);
  }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > MAX_BATCH) throw new EngineError("Invalid batch size", 400);
  for (const c of calls) {
    if (typeof c?.method !== "string" || !ALLOWED_METHODS.has(c.method)) {
      return json({ jsonrpc: "2.0", id: c?.id ?? null, error: { code: -32601, message: `Method not available: ${String(c?.method)}` } }, { status: 200 });
    }
  }
  const network = new URL(req.url).searchParams.get("network");
  let res: Response;
  try {
    res = await outboundFetch(upstreamFor(network), { method: "POST", headers: { "content-type": "application/json" }, body: raw });
  } catch (e) {
    console.error("RPC relay upstream error:", e);
    throw new EngineError("Solana RPC is unreachable. Try again shortly.", 502);
  }
  // Pass the upstream answer through, without its headers (they can identify the provider).
  return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
});
