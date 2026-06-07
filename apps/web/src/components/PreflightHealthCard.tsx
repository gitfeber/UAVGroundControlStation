import type { PreflightHealth, PreflightStatus } from "../lib/preflight";
import { Panel } from "./Panel";

interface PreflightHealthCardProps {
  health: PreflightHealth;
}

const STATUS_LABEL: Record<PreflightStatus, string> = {
  READY: "Ready",
  CAUTION: "Caution",
  NOT_READY: "Not ready",
  UNKNOWN: "Unknown"
};

/** Big global-badge styling per status (emerald / amber / red / slate). */
const BADGE_CLASS: Record<PreflightStatus, string> = {
  READY: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  CAUTION: "border-amber-400/40 bg-amber-400/10 text-amber-100",
  NOT_READY: "border-red-400/40 bg-red-400/10 text-red-200",
  UNKNOWN: "border-slate-500/50 bg-slate-600/20 text-slate-300"
};

/** Per-row status dot color. */
const DOT_CLASS: Record<PreflightStatus, string> = {
  READY: "bg-emerald-400",
  CAUTION: "bg-amber-400",
  NOT_READY: "bg-red-400",
  UNKNOWN: "bg-slate-500"
};

const TEXT_CLASS: Record<PreflightStatus, string> = {
  READY: "text-emerald-300",
  CAUTION: "text-amber-200",
  NOT_READY: "text-red-300",
  UNKNOWN: "text-slate-400"
};

export function PreflightHealthCard({ health }: PreflightHealthCardProps) {
  return (
    <Panel title="Preflight health">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span
          className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] ${BADGE_CLASS[health.status]}`}
        >
          {STATUS_LABEL[health.status]}
        </span>
        <span className="min-w-0 truncate text-right text-xs text-slate-300">{health.summary}</span>
      </div>

      <ul className="space-y-1">
        {health.checks.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="flex min-w-0 items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[c.status]}`} aria-hidden="true" />
              <span className="truncate text-slate-400">{c.label}</span>
            </span>
            <span className={`shrink-0 truncate text-right font-mono ${TEXT_CLASS[c.status]}`} title={c.details ?? c.message}>
              {c.message}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[10px] leading-snug text-slate-600">
        Advisory only — derived from telemetry, not the flight controller&apos;s pre-arm.
      </p>
    </Panel>
  );
}
