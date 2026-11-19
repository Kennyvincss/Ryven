"use client";
import { PAYMENT_CATEGORIES, usdcLabel } from "@/lib/shared/config";
import { Field, Input, cn } from "./ui";

export type PolicyState = {
  mode: "autonomous" | "approval";
  maxPerTx: string;
  autoApproveLimit: string;
  dailyLimit: string;
  categories: string[];
  recipientPolicy: "allowlist_only" | "allowlist_or_approval";
};

export const DEFAULT_POLICY: PolicyState = {
  mode: "autonomous",
  maxPerTx: "5",
  autoApproveLimit: "5",
  dailyLimit: "20",
  categories: ["community_rewards"],
  recipientPolicy: "allowlist_only",
};

/** SOL defaults for a new agent's limits (the main treasury is SOL). */
export const DEFAULT_SOL_LIMITS = { maxPerTx: "0.05", autoApproveLimit: "0.05", dailyLimit: "0.2" };

export function PolicyForm({ value, onChange, unit = usdcLabel }: { value: PolicyState; onChange: (v: PolicyState) => void; unit?: string }) {
  const set = (p: Partial<PolicyState>) => onChange({ ...value, ...p });
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-1.5 text-[13px] font-medium">Execution mode</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["autonomous", "Autonomous", "Executes payments within the limits below without asking."],
              ["approval", "Approval", "Prepares every payment; you approve each one before it's sent."],
            ] as const
          ).map(([id, title, desc]) => (
            <button
              type="button"
              key={id}
              onClick={() => set({ mode: id })}
              className={cn(
                "rounded-xl border p-3.5 text-left transition-colors",
                value.mode === id ? "border-agent/60 bg-agent/10" : "border-line-2 bg-panel-2 hover:bg-panel-3",
              )}
            >
              <div className="text-sm font-semibold">{title} mode</div>
              <div className="mt-0.5 text-xs text-muted">{desc}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Max per payment" hint={`${unit}, hard cap`}>
          <Input inputMode="decimal" value={value.maxPerTx} onChange={(e) => set({ maxPerTx: e.target.value })} />
        </Field>
        <Field label="Autonomous up to" hint="above → approval">
          <Input inputMode="decimal" value={value.autoApproveLimit} onChange={(e) => set({ autoApproveLimit: e.target.value })} disabled={value.mode === "approval"} />
        </Field>
        <Field label="Daily limit" hint="resets 00:00 UTC">
          <Input inputMode="decimal" value={value.dailyLimit} onChange={(e) => set({ dailyLimit: e.target.value })} />
        </Field>
      </div>
      <div>
        <div className="mb-1.5 text-[13px] font-medium">Approved payment categories</div>
        <div className="flex flex-wrap gap-2">
          {PAYMENT_CATEGORIES.map((c) => {
            const on = value.categories.includes(c.id);
            return (
              <button
                type="button"
                key={c.id}
                onClick={() => set({ categories: on ? value.categories.filter((x) => x !== c.id) : [...value.categories, c.id] })}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  on ? "border-accent/50 bg-accent/10 text-accent" : "border-line-2 text-muted hover:text-text",
                )}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-[13px] font-medium">Recipients</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["allowlist_only", "Approved contributors only", "Payments to anyone else are rejected."],
              ["allowlist_or_approval", "Others need my approval", "Unlisted wallets are queued for you to approve."],
            ] as const
          ).map(([id, title, desc]) => (
            <button
              type="button"
              key={id}
              onClick={() => set({ recipientPolicy: id })}
              className={cn(
                "rounded-xl border p-3.5 text-left transition-colors",
                value.recipientPolicy === id ? "border-agent/60 bg-agent/10" : "border-line-2 bg-panel-2 hover:bg-panel-3",
              )}
            >
              <div className="text-sm font-semibold">{title}</div>
              <div className="mt-0.5 text-xs text-muted">{desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function policyPayload(p: PolicyState) {
  return { ...p, autoApproveLimit: p.mode === "approval" ? "0" : p.autoApproveLimit };
}
