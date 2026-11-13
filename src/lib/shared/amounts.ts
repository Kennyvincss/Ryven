/**
 * Exact decimal <-> base-unit conversion. Money is NEVER handled as a float.
 */
export function toBaseUnits(value: string | number, decimals: number): bigint {
  const str = typeof value === "number" ? value.toString() : value.trim();
  if (!/^\d+(\.\d+)?$/.test(str)) throw new Error(`Invalid amount: "${value}"`);
  const [whole, frac = ""] = str.split(".");
  if (frac.length > decimals) throw new Error(`Amount "${value}" has more than ${decimals} decimal places`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

export function fromBaseUnits(value: bigint | string | number, decimals: number): string {
  const v = BigInt(value);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

/** Human formatting for display only. */
export function formatAmount(value: bigint | string | number, decimals: number, maxFrac = 2): string {
  const s = fromBaseUnits(value, decimals);
  const [w, f = ""] = s.split(".");
  const wholeFmt = BigInt(w.replace("-", "")).toLocaleString("en-US");
  const frac = f.slice(0, maxFrac);
  return `${s.startsWith("-") ? "-" : ""}${wholeFmt}${frac ? "." + frac : ""}`;
}

export function formatCompact(n: number): string {
  if (!isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
}

export function shortAddress(a: string | null | undefined, n = 4) {
  if (!a) return "";
  return a.length <= n * 2 + 1 ? a : `${a.slice(0, n)}…${a.slice(-n)}`;
}
