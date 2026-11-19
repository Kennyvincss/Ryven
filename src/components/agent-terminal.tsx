"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, CheckCircle2, CircleAlert, Clock, ExternalLink, Loader2, ShieldCheck, Sparkles, User, XCircle } from "lucide-react";
import { api } from "@/lib/client/api";
import { explorerTx, usdcLabel } from "@/lib/shared/config";
import { shortAddress } from "@/lib/shared/amounts";
import { AgentAvatar, cn } from "./ui";
import { ActionCard, ActionDialog, type ConsoleAction } from "./console-actions";
import type { AgentRef } from "./treasury-actions";

type PaymentView = {
  id: string;
  recipient: string;
  amount: string;
  unit?: string;
  reason: string;
  status: string;
  signature: string | null;
  explorerUrl: string | null;
  policySummary: string;
  error: string | null;
};
type Event =
  | { type: "instruction"; instructionId: string }
  | { type: "status"; status: string; message: string }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "payment"; payment: PaymentView }
  | { type: "action"; action: ConsoleAction }
  | { type: "assistant"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

type Entry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "payment"; payment: PaymentView }
  | { kind: "action"; action: ConsoleAction }
  | { kind: "error"; text: string };

const SUGGESTIONS = [
  "Reward three approved community contributors with 5 USDC each.",
  "Check how much money is left in your treasury.",
  "Show me all payments you made today.",
  "Prepare a reward campaign for our community.",
  "Stop all scheduled payments.",
];

export function PaymentChip({ p }: { p: PaymentView }) {
  const conf: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    executing: { label: "Pending transaction: executing on Solana", cls: "border-info/30 bg-info/5", icon: <Loader2 className="size-3.5 animate-spin text-info" /> },
    approved: { label: "Approved by policy: queued", cls: "border-info/30 bg-info/5", icon: <ShieldCheck className="size-3.5 text-info" /> },
    confirmed: { label: "Confirmed on-chain", cls: "border-accent/30 bg-accent/5", icon: <CheckCircle2 className="size-3.5 text-accent" /> },
    awaiting_approval: { label: "Awaiting your approval", cls: "border-warn/30 bg-warn/5", icon: <Clock className="size-3.5 text-warn" /> },
    rejected: { label: "Rejected by policy engine", cls: "border-danger/30 bg-danger/5", icon: <XCircle className="size-3.5 text-danger" /> },
    failed: { label: "Failed: no funds moved", cls: "border-danger/30 bg-danger/5", icon: <CircleAlert className="size-3.5 text-danger" /> },
    cancelled: { label: "Cancelled", cls: "border-line-2", icon: <XCircle className="size-3.5 text-muted" /> },
  };
  const c = conf[p.status] ?? conf.approved;
  return (
    <div className={cn("rounded-xl border px-3 py-2.5", c.cls)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium">
          {c.icon}
          <span className="truncate">{c.label}</span>
        </div>
        <div className="shrink-0 font-mono text-sm font-semibold">
          {p.amount} <span className="text-xs text-muted">{p.unit ?? usdcLabel}</span>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span>
          → <span className="font-mono text-text/80">{shortAddress(p.recipient, 5)}</span>
        </span>
        <span className="truncate">“{p.reason}”</span>
        {p.status === "confirmed" && p.signature && (
          <a href={p.explorerUrl ?? explorerTx(p.signature)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-info hover:underline">
            {shortAddress(p.signature, 6)} <ExternalLink className="size-3" />
          </a>
        )}
      </div>
      {(p.status === "rejected" || p.status === "awaiting_approval" || p.status === "failed") && (
        <div className="mt-1 text-[11px] text-muted">{p.error ?? p.policySummary}</div>
      )}
    </div>
  );
}

export function AgentTerminal({
  agentId,
  agentName,
  avatarSeed,
  aiEnabled,
  onActivity,
  agent,
}: {
  agentId: string;
  agentName: string;
  avatarSeed: string;
  aiEnabled: boolean;
  onActivity?: () => void;
  /** enables the one-click action popups */
  agent?: AgentRef;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [openAction, setOpenAction] = useState<ConsoleAction | null>(null);
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const lastText = useRef<string>("");
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ messages: { role: string; content: string }[] }>(`/api/agents/${agentId}/terminal`)
      .then((r) => setEntries(r.messages.map((m) => (m.role === "user" ? { kind: "user", text: m.content } : { kind: "assistant", text: m.content }))))
      .catch(() => undefined);
  }, [agentId]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [entries, running]);

  async function send(text: string) {
    if (!text.trim() || running) return;
    setInput("");
    setRunning(true);
    lastText.current = text;
    setEntries((e) => [...e, { kind: "user", text }]);
    try {
      const res = await fetch(`/api/agents/${agentId}/terminal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
        throw new Error(err.error);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as Event;
          handle(ev);
        }
      }
    } catch (e) {
      setEntries((x) => [...x, { kind: "error", text: (e as Error).message }]);
    } finally {
      setRunning(false);
      onActivity?.();
    }
  }

  function handle(ev: Event) {
    switch (ev.type) {
      // Internal steps (tool calls, checks) aren't shown: the terminal just says "Thinking…"
      // until the agent answers. Payments still appear as cards.
      case "status":
      case "tool_call":
        break;
      case "action":
        setEntries((x) => (x.some((e) => e.kind === "action" && e.action.key === ev.action.key) ? x : [...x, { kind: "action", action: ev.action }]));
        // pop it up right away (the first one; the rest wait as cards)
        setOpenAction((cur) => cur ?? ev.action);
        break;
      case "payment":
        setEntries((x) => {
          const i = x.findIndex((e) => e.kind === "payment" && e.payment.id === ev.payment.id);
          if (i >= 0) {
            const copy = [...x];
            copy[i] = { kind: "payment", payment: ev.payment };
            return copy;
          }
          return [...x, { kind: "payment", payment: ev.payment }];
        });
        onActivity?.();
        break;
      case "assistant":
        setEntries((x) => [...x, { kind: "assistant", text: ev.text }]);
        break;
      case "error":
        setEntries((x) => [...x, { kind: "error", text: ev.message }]);
        break;
    }
  }

  return (
    <div className="flex h-[620px] flex-col overflow-hidden rounded-[var(--radius-card)] border border-white/[0.07] bg-[#07090b] shadow-[0_0_60px_-30px_rgba(198,255,61,0.35)]">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2.5">
          <AgentAvatar seed={avatarSeed} size={28} />
          <div>
            <div className="text-sm font-semibold">{agentName} · Terminal</div>
            <div className="text-[11px] text-faint">Natural-language instructions → policy-checked Solana payments</div>
          </div>
        </div>
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]/70" />
          <span className="size-2.5 rounded-full bg-[#febc2e]/70" />
          <span className="size-2.5 rounded-full bg-[#28c840]/70" />
        </div>
      </div>

      <div ref={scroller} className="scrollbar-thin flex-1 space-y-3 overflow-y-auto px-4 py-4 font-mono text-[13px]">
        {entries.length === 0 && (
          <div className="py-6 text-center font-sans">
            <Sparkles className="mx-auto size-5 text-agent" />
            <div className="mt-2 text-sm font-medium">Tell {agentName} what to do</div>
            <div className="mt-1 text-xs text-muted">It can only act within the spending permissions you configured.</div>
            {!aiEnabled && (
              <div className="mx-auto mt-4 max-w-sm rounded-xl border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
                The AI agent is temporarily unavailable. Manual payments still work from the Manual payment tab.
              </div>
            )}
          </div>
        )}
        {entries.map((e, i) => {
          if (e.kind === "user")
            return (
              <div key={i} className="flex items-start gap-2.5">
                <User className="mt-0.5 size-4 shrink-0 text-accent" />
                <div className="whitespace-pre-wrap text-accent">{e.text}</div>
              </div>
            );
          if (e.kind === "assistant")
            return (
              <div key={i} className="flex items-start gap-2.5 font-sans">
                <Bot className="mt-0.5 size-4 shrink-0 text-agent" />
                <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-text">{e.text}</div>
              </div>
            );
          if (e.kind === "action")
            return (
              <div key={i} className="pl-6">
                <ActionCard action={e.action} resolved={resolved[e.action.key]} onOpen={() => setOpenAction(e.action)} />
              </div>
            );
          if (e.kind === "payment")
            return (
              <div key={i} className="pl-6 font-sans">
                <PaymentChip p={e.payment} />
              </div>
            );
          return (
            <div key={i} className="flex items-start gap-2.5 font-sans text-danger">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <div className="text-[13px]">{e.text}</div>
            </div>
          );
        })}
        {running && (
          <div className="flex items-center gap-2.5 font-sans text-[13.5px] text-agent">
            <Bot className="size-4 shrink-0" />
            <ThinkingDots />
          </div>
        )}
      </div>

      {openAction && agent && (
        <ActionDialog
          action={openAction}
          agent={agent}
          onClose={() => {
            setOpenAction(null);
            onActivity?.();
          }}
          onResolved={(key, text) => {
            setResolved((r) => ({ ...r, [key]: text }));
            onActivity?.();
          }}
          onRetry={lastText.current ? () => send(lastText.current) : undefined}
        />
      )}
      <div className="border-t border-line p-3">
        <div className="scrollbar-thin mb-2 flex gap-1.5 overflow-x-auto pb-1">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              disabled={running}
              onClick={() => send(s)}
              className="shrink-0 rounded-full border border-line-2 px-3 py-1 text-[11px] text-muted hover:border-agent/50 hover:text-text disabled:opacity-40"
            >
              {s}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-end gap-2 rounded-xl border border-line-2 bg-panel px-3 py-2 focus-within:border-agent/60"
        >
          <span className="pb-1.5 font-mono text-sm text-agent">›</span>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder={`Instruct ${agentName}…`}
            className="max-h-32 min-h-[28px] flex-1 resize-none bg-transparent py-1 font-mono text-[13px] outline-none placeholder:text-faint"
          />
          <button type="submit" disabled={running || !input.trim()} className="grid size-8 place-items-center rounded-lg bg-accent text-black disabled:opacity-40">
            {running ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </button>
        </form>
      </div>
    </div>
  );
}

/** "Thinking", "Thinking.", "Thinking..", "Thinking..." */
function ThinkingDots() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => (x + 1) % 4), 400);
    return () => clearInterval(t);
  }, []);
  return (
    <span aria-live="polite">
      Thinking<span className="inline-block w-5 text-left">{".".repeat(n)}</span>
    </span>
  );
}
