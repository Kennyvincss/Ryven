"use client";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    method: init?.method ?? (init?.json !== undefined ? "POST" : "GET"),
    headers: { ...(init?.json !== undefined ? { "content-type": "application/json" } : {}), ...(init?.headers ?? {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    credentials: "same-origin",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const body = data as { error?: string; issues?: { path?: (string | number)[]; message?: string }[] } | null;
    let msg = body?.error ?? `Request failed (${res.status})`;
    // Validation errors: say which field and why, instead of a bare "Invalid input".
    if (body?.issues?.length) msg = body.issues.map((i) => describeIssue(i.path ?? [], i.message ?? "is invalid")).join(" · ");
    throw new ApiError(msg, res.status, data);
  }
  return data as T;
}

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  symbol: "Symbol",
  description: "Description",
  image: "Image",
  website: "Website",
  twitter: "X / Twitter",
  telegram: "Telegram",
  devBuySol: "Dev buy",
  amount: "Amount",
  wallet: "Wallet",
  handle: "Name",
};

/** "Website: enter a link like https://…" (messages that already name the field are kept as is). */
function describeIssue(path: (string | number)[], message: string) {
  const key = String(path[path.length - 1] ?? "");
  const label = FIELD_LABELS[key];
  if (!label || message.toLowerCase().startsWith(label.toLowerCase())) return message;
  return `${label}: ${message}`;
}
