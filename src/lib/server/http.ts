import "server-only";
import { NextResponse, connection } from "next/server";
import { ZodError } from "zod";
import { AuthError } from "./auth";
import { EngineError } from "./engine/payments";
import { ConfigError } from "./env";
import { rateLimit, clientIp } from "./ratelimit";

/** JSON with bigint support (bigints become decimal strings). */
export function json(data: unknown, init?: ResponseInit) {
  return new NextResponse(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

export function errorResponse(e: unknown) {
  if (e instanceof AuthError || e instanceof EngineError) return json({ error: e.message }, { status: e.status });
  if (e instanceof ZodError) return json({ error: "Invalid input", issues: e.issues }, { status: 400 });
  if (e instanceof ConfigError) return json({ error: e.message, config: true }, { status: 503 });
  console.error(e);
  return json({ error: "Internal error" }, { status: 500 });
}

export function handler<A extends unknown[]>(fn: (req: Request, ...args: A) => Promise<Response>) {
  return async (req: Request, ...args: A) => {
    await connection(); // always dynamic: API responses are never prerendered
    try {
      return await fn(req, ...args);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function enforceRateLimit(req: Request, bucket: string, limit: number, windowMs = 60_000, id?: string) {
  const r = rateLimit(`${bucket}:${id ?? clientIp(req)}`, limit, windowMs);
  if (!r.ok) throw new EngineError(`Too many requests. Try again in ${r.retryAfter}s.`, 429);
}
