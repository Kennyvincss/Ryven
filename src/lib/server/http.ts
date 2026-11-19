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

/** Detailed setup hints only on a developer's machine; visitors of a deployed site get plain messages. */
const DEV = process.env.NODE_ENV !== "production";

export function errorResponse(e: unknown) {
  if (e instanceof AuthError || e instanceof EngineError) return json({ error: e.message }, { status: e.status });
  if (e instanceof ZodError) return json({ error: "Invalid input", issues: e.issues.map((i) => ({ path: i.path, message: i.message })) }, { status: 400 });
  if (e instanceof ConfigError) {
    console.error(e);
    return json({ error: DEV ? e.message : "This feature is temporarily unavailable. Please try again later." }, { status: 503 });
  }
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  if (code === "42703" || code === "42P01" || code === "42704") {
    // undefined column / table / type: the database is older than the code.
    console.error("Database schema is out of date: run npm run db:migrate.", e);
    return json({ error: DEV ? 'The database is out of date. Stop the app, run "npm run db:migrate", then start it again.' : "Ryyven is being updated. Please try again in a few minutes." }, { status: 503 });
  }
  if (code === "ECONNREFUSED" || code === "28P01" || code === "ENOTFOUND") {
    console.error("Cannot connect to the database: check DATABASE_URL.", e);
    return json({ error: DEV ? 'Cannot connect to the database. Check DATABASE_URL in .env (run "npm run db:migrate" to test it).' : "Ryyven is temporarily unavailable. Please try again in a few minutes." }, { status: 503 });
  }
  console.error(e);
  return json({ error: "Something went wrong. Please try again." }, { status: 500 });
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
