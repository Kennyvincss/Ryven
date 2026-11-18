/** Pure price-alert logic (no I/O, unit-tested). */

export type AlertCondition = "above" | "below" | "rises_pct" | "falls_pct";
export type AlertMetric = "price" | "market_cap";

export class AlertInputError extends Error {}

/**
 * Turns the creator's condition into a fixed direction + target.
 * above/below: `value` is the USD level. rises_pct/falls_pct: `value` is a percent from `current`.
 */
export function resolveAlert(condition: AlertCondition, value: number, current: number | null): { direction: "above" | "below"; target: number } {
  if (!Number.isFinite(value) || value <= 0) throw new AlertInputError("The alert value must be a positive number");
  if (condition === "above" || condition === "below") {
    if (current !== null && condition === "above" && current >= value) throw new AlertInputError(`It's already above that (currently ${fmtUsd(current)})`);
    if (current !== null && condition === "below" && current <= value) throw new AlertInputError(`It's already below that (currently ${fmtUsd(current)})`);
    return { direction: condition, target: value };
  }
  if (current === null || current <= 0) throw new AlertInputError("No current price for this token, so a percentage alert can't be set. Use a fixed level instead.");
  if (condition === "falls_pct" && value >= 100) throw new AlertInputError("A fall must be less than 100%");
  if (value > 10_000) throw new AlertInputError("That percentage is too large");
  return condition === "rises_pct" ? { direction: "above", target: current * (1 + value / 100) } : { direction: "below", target: current * (1 - value / 100) };
}

export function isTriggered(direction: "above" | "below", target: number, current: number | null): boolean {
  if (current === null || !Number.isFinite(current)) return false;
  return direction === "above" ? current >= target : current <= target;
}

/** "$0.0000123", "$1.52", "$4.2M" */
export function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `$${(n / 1e3).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${Number(n.toPrecision(3))}`;
}

export function describeAlert(a: { symbol: string; metric: string; direction: string; target: number; condition: string }) {
  const what = a.metric === "market_cap" ? `${a.symbol} market cap` : `${a.symbol} price`;
  const pct = a.condition.match(/^(rises|falls) (.+)%$/);
  return `${what} ${a.direction} ${fmtUsd(a.target)}${pct ? ` (${a.condition})` : ""}`;
}
