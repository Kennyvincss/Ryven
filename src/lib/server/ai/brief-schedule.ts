/** Start of today's brief slot (today at hourUtc), or null if that hour hasn't come yet. */
export function dueSince(now: Date, hourUtc: number): Date | null {
  const slot = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc));
  return now >= slot ? slot : null;
}

/** Whether an agent's daily brief should be generated now. */
export function isBriefDue(now: Date, hourUtc: number, lastAt: Date | null): boolean {
  const since = dueSince(now, hourUtc);
  return !!since && (!lastAt || lastAt < since);
}
