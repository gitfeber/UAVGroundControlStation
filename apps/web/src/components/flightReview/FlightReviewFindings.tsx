import type { FlightReviewFinding } from "../../flightReview/flightReviewTypes";
import { Panel, Badge } from "../Panel";

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function FlightReviewFindingsPanel({
  findings,
  currentTimeMs,
  onSeek
}: {
  findings: FlightReviewFinding[];
  currentTimeMs: number;
  onSeek: (timeMs: number) => void;
}) {
  return (
    <Panel title="Findings" className="flex h-full min-h-0 flex-col">
      <div className="max-h-full overflow-y-auto">
        {findings.length === 0 && (
          <p className="text-xs text-slate-500">No findings detected in this log.</p>
        )}
        {findings.map((finding) => {
          const active = Math.abs(finding.timeMs - currentTimeMs) < 500;
          return (
            <button
              key={finding.id}
              type="button"
              className={`w-full border-b px-2 py-2 text-left transition ${
                active
                  ? "border-emerald-400/40 bg-emerald-400/8"
                  : "border-white/5 bg-transparent hover:bg-white/[0.025]"
              }`}
              onClick={() => onSeek(finding.timeMs)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-slate-100">{finding.title}</span>
                <Badge tone={finding.severity === "warn" ? "warn" : "neutral"}>{finding.severity}</Badge>
              </div>
              <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-slate-500">
                <span>{formatClock(finding.timeMs)}</span>
                <span className="uppercase tracking-wider">{finding.category}</span>
              </div>
              {finding.detail && <p className="mt-1 text-[11px] text-slate-400">{finding.detail}</p>}
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
