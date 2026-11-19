/**
 * Coin launch form fields, accepted the way people actually type them:
 * "x.com/coin", "@coin", "t.me/coin" or full links become proper https:// URLs.
 */
import { z } from "zod";

export type SocialKind = "website" | "twitter" | "telegram";
const LABEL: Record<SocialKind, string> = { website: "Website", twitter: "X / Twitter", telegram: "Telegram" };

/** "" stays ""; "@name" -> profile link; missing scheme -> https://. Pure, unit-tested. */
export function normalizeSocial(kind: SocialKind, raw: string | undefined | null): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  if (v.startsWith("@") && /^@[A-Za-z0-9_]{1,64}$/.test(v)) {
    if (kind === "twitter") return `https://x.com/${v.slice(1)}`;
    if (kind === "telegram") return `https://t.me/${v.slice(1)}`;
  }
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

export function isWebLink(v: string): boolean {
  try {
    const u = new URL(v);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".");
  } catch {
    return false;
  }
}

export const socialField = (kind: SocialKind) =>
  z
    .string()
    .max(200, `${LABEL[kind]} link is too long`)
    .optional()
    .transform((v) => normalizeSocial(kind, v))
    .refine((v) => v === "" || isWebLink(v), `${LABEL[kind]}: enter a link like https://… (or leave it empty)`);

export const nameField = z.string().trim().min(1, "Name is required").max(32, "Name can be at most 32 characters");

/** Any characters except spaces (emoji and $ are fine), up to `max`. */
export const symbolField = (max = 10) =>
  z
    .string()
    .trim()
    .min(1, "Symbol is required")
    .max(max, `Symbol can be at most ${max} characters`)
    .regex(/^[^\s\p{C}]+$/u, "Symbol can't contain spaces");

export const descriptionField = z.string().trim().max(1000, "Description can be at most 1000 characters").default("");
