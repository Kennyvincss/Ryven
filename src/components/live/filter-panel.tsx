"use client";
import { useState } from "react";
import { FILTER_FIELDS, parseShort, type ColumnFilter, type LiveColumn } from "@/lib/shared/live-filters";
import { cn } from "../ui";

type Draft = Record<string, string>;

const fmt = (v: number | undefined) => {
  if (v === undefined) return "";
  if (v >= 1e9 && v % 1e9 === 0) return `${v / 1e9}b`;
  if (v >= 1e6 && v % 1e5 === 0) return `${v / 1e6}m`;
  if (v >= 1e3 && v % 100 === 0) return `${v / 1e3}k`;
  return String(v);
};

function toDraft(f: ColumnFilter): Draft {
  const d: Draft = {};
  for (const fld of FILTER_FIELDS) {
    if (fld.min) d[fld.min] = fmt(f[fld.min] as number | undefined);
    if (fld.max) d[fld.max] = fmt(f[fld.max] as number | undefined);
  }
  return d;
}

/** Per-column filters. Amounts accept shorthand: 10k, 1.5m. Empty = no limit. */
export function FilterPanel({ column, value, onApply, onClose }: { column: LiveColumn; value: ColumnFilter; onApply: (f: ColumnFilter) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(value));
  const [socials, setSocials] = useState(!!value.socials);
  const fields = FILTER_FIELDS.filter((f) => !f.columns || f.columns.includes(column));

  const bad = (k: string) => draft[k]?.trim() && parseShort(draft[k]) === undefined;
  const anyBad = Object.keys(draft).some(bad);

  function apply() {
    const out: ColumnFilter = {};
    for (const [k, v] of Object.entries(draft)) {
      const n = parseShort(v);
      if (n !== undefined) (out as Record<string, number>)[k] = n;
    }
    if (socials) out.socials = true;
    onApply(out);
    onClose();
  }

  const input = (k: string, placeholder: string) => (
    <input
      value={draft[k] ?? ""}
      onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
      placeholder={placeholder}
      inputMode="decimal"
      className={cn("w-full rounded-lg border bg-panel-2 px-2 py-1.5 font-mono text-xs outline-none focus:border-accent/60", bad(k) ? "border-danger/60" : "border-line-2")}
    />
  );

  return (
    <div className="border-b border-line bg-panel-2/60 px-3 py-3">
      <div className="grid grid-cols-[1fr_76px_76px] items-center gap-x-2 gap-y-1.5 text-[11px]">
        <span />
        <span className="text-center text-faint">Min</span>
        <span className="text-center text-faint">Max</span>
        {fields.map((f) => (
          <div key={f.id} className="contents">
            <span className="text-muted">{f.label}</span>
            {f.min ? input(f.min, "—") : <span />}
            {f.max ? input(f.max, "—") : <span />}
          </div>
        ))}
      </div>
      <label className="mt-2.5 flex items-center gap-2 text-[11px] text-muted">
        <input type="checkbox" checked={socials} onChange={(e) => setSocials(e.target.checked)} />
        Has socials (X, website or Telegram)
      </label>
      <p className="mt-2 text-[10.5px] text-faint">Amounts accept shorthand like 10k or 1.5m. Leave empty for no limit.</p>
      <div className="mt-2.5 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setDraft({});
            setSocials(false);
            onApply({});
            onClose();
          }}
          className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-text"
        >
          Reset
        </button>
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-text">
          Cancel
        </button>
        <button type="button" disabled={anyBad} onClick={apply} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50">
          Apply
        </button>
      </div>
    </div>
  );
}
