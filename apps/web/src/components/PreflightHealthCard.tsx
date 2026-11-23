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

const BADGE_CLASS: Record<PreflightStatus, string> = {
  READY: "status-tag--good",
  CAUTION: "status-tag--warn",
  NOT_READY: "status-tag--bad",
  UNKNOWN: ""
};

const DOT_CLASS: Record<PreflightStatus, string> = {
  READY: "preflight-row__mark--good",
  CAUTION: "preflight-row__mark--warn",
  NOT_READY: "preflight-row__mark--bad",
  UNKNOWN: ""
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
      <div className="preflight-summary">
        <span className={`status-tag ${BADGE_CLASS[health.status]}`}>
          {STATUS_LABEL[health.status]}
        </span>
        <span className="min-w-0 truncate text-right text-[9px] text-slate-400">{health.summary}</span>
      </div>

      <ul className="preflight-list">
        {health.checks.map((c) => (
          <li key={c.id} className="preflight-row">
            <span className={`preflight-row__mark ${DOT_CLASS[c.status]}`} aria-hidden="true" />
            <span className="truncate text-slate-500">{c.label}</span>
            <span className={`preflight-row__value shrink-0 truncate text-right ${TEXT_CLASS[c.status]}`} title={c.details ?? c.message}>
              {c.message}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[8px] uppercase leading-snug tracking-[0.08em] text-slate-600">
        Advisory only · not flight-controller pre-arm state
      </p>
    </Panel>
  );
}
