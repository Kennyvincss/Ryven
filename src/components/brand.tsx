/**
 * Ryven brand: the R mark (candlestick stem with its wick, angular terminal-chevron bowl,
 * and the AI spark on top of the chart) and the wordmark. Small sizes drop the wick and
 * spark so the mark stays legible.
 */
import { cn } from "./ui";

export const VOLT = "#C6FF3D";
export const VOID = "#0A0C0F";

/** R body: stem (candle), chevron bowl with its counter, and the leg. viewBox 0 0 100 100. */
const R_PATH = "M8 16H66L80 30V40L66 54H58L84 86H63L40 54H30V86H8Z M30 28V42H58L64 35L58 28Z";
const WICK = { x: 14, y: 2, width: 5, height: 96 };
const SPARK = "M91 0Q92.6 8.4 101 10Q92.6 11.6 91 20Q89.4 11.6 81 10Q89.4 8.4 91 0Z";

/** The R mark. `simple` drops the wick and spark (favicons, tiny sizes). */
export function RyvenMark({ size = 32, color = VOLT, simple, className, title = "Ryven" }: { size?: number; color?: string; simple?: boolean; className?: string; title?: string }) {
  const showDetail = !simple && size >= 28;
  return (
    <svg width={size} height={size} viewBox={showDetail ? "0 0 102 100" : "4 12 84 78"} className={className} role="img" aria-label={title} fill={color}>
      <path d={R_PATH} fillRule="evenodd" />
      {showDetail && (
        <>
          <rect {...WICK} />
          <path d={SPARK} />
        </>
      )}
    </svg>
  );
}

/** Mark + RYVEN wordmark (+ optional "MEMECOIN TERMINAL · AI" line). */
export function RyvenLogo({ size = 28, tagline, className }: { size?: number; tagline?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <RyvenMark size={size} />
      <span className="flex flex-col items-start text-left leading-none">
        <span className="font-display font-bold tracking-tight text-text" style={{ fontSize: size * 0.72 }}>
          RYVEN
        </span>
        {tagline && (
          <span className="mt-1 font-mono font-medium tracking-[0.32em] text-accent" style={{ fontSize: Math.max(8, size * 0.24) }}>
            MEMECOIN TERMINAL · AI
          </span>
        )}
      </span>
    </span>
  );
}
