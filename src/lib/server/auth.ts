import "server-only";
/**
 * Sign-In With Solana. The wallet signs a human-readable message containing a
 * single-use server nonce; we verify the ed25519 signature and issue an httpOnly JWT.
 */
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "./db";
import { serverEnv } from "./env";

const COOKIE = "ryven_session";
const SESSION_TTL_S = 60 * 60 * 12;

export class AuthError extends Error {
  constructor(
    message: string,
    public status = 401,
  ) {
    super(message);
  }
}

export function isValidWallet(w: string) {
  try {
    return new PublicKey(w).toBase58() === w;
  } catch {
    return false;
  }
}

export async function createNonce(wallet: string, origin: string) {
  if (!isValidWallet(wallet)) throw new AuthError("Invalid wallet address", 400);
  const nonce = randomBytes(16).toString("hex");
  const issued = new Date();
  const expires = new Date(issued.getTime() + 5 * 60 * 1000);
  const host = (() => {
    try {
      return new URL(origin).host;
    } catch {
      return "ryven";
    }
  })();
  const message = [
    `${host} wants you to sign in with your Solana account:`,
    wallet,
    "",
    "Sign in to Ryven. This only proves you own this wallet. It does not send a transaction or cost any fees.",
    "",
    `URI: ${origin}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issued.toISOString()}`,
    `Expiration Time: ${expires.toISOString()}`,
  ].join("\n");
  await db.insert(schema.authNonces).values({ nonce, wallet, message, expiresAt: expires });
  return { nonce, message };
}

export async function verifySignIn(wallet: string, nonce: string, signatureB58: string) {
  const row = await db.query.authNonces.findFirst({
    where: and(
      eq(schema.authNonces.nonce, nonce),
      eq(schema.authNonces.wallet, wallet),
      isNull(schema.authNonces.usedAt),
      gt(schema.authNonces.expiresAt, new Date()),
    ),
  });
  if (!row) throw new AuthError("Sign-in request expired or already used. Please try again.");
  let sig: Uint8Array;
  try {
    sig = bs58.decode(signatureB58);
  } catch {
    throw new AuthError("Malformed signature", 400);
  }
  const ok = nacl.sign.detached.verify(new TextEncoder().encode(row.message), sig, new PublicKey(wallet).toBytes());
  if (!ok) throw new AuthError("Signature verification failed");
  // Single use: mark consumed atomically.
  const consumed = await db
    .update(schema.authNonces)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.authNonces.nonce, nonce), isNull(schema.authNonces.usedAt)))
    .returning();
  if (!consumed.length) throw new AuthError("Sign-in request already used");

  await db
    .insert(schema.users)
    .values({ wallet })
    .onConflictDoUpdate({ target: schema.users.wallet, set: { lastSeenAt: new Date() } });

  const token = await new SignJWT({ wallet })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(wallet)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_S}s`)
    .sign(serverEnv.sessionSecret);
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
  return { wallet };
}

export async function signOut() {
  (await cookies()).delete(COOKIE);
}

/** Returns the signed-in wallet, or null. */
export async function getSession(): Promise<{ wallet: string; isAdmin: boolean } | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, serverEnv.sessionSecret, { algorithms: ["HS256"] });
    const wallet = typeof payload.sub === "string" ? payload.sub : null;
    if (!wallet || !isValidWallet(wallet)) return null;
    return { wallet, isAdmin: serverEnv.adminWallets.includes(wallet) };
  } catch {
    return null;
  }
}

export async function requireSession() {
  const s = await getSession();
  if (!s) throw new AuthError("Sign in with your wallet first");
  return s;
}

export async function requireAdmin() {
  const s = await requireSession();
  if (!s.isAdmin) throw new AuthError("Administrator access required", 403);
  return s;
}
