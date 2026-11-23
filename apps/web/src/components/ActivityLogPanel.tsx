import { useState } from "react";
import type { MavlinkMessageStat } from "@uav-ground-control-station/shared";
import type { ActivityLogEntry } from "../hooks/useTelemetry";
import type { LinkIssue } from "../lib/linkErrors";

interface ActivityLogPanelProps {
  logs: ActivityLogEntry[];
  messages: MavlinkMessageStat[];
  onClear: () => void;
  linkIssues?: LinkIssue[];
}

export function ActivityLogPanel({ logs, messages, onClear, linkIssues = [] }: ActivityLogPanelProps) {
  const [open, setOpen] = useState(false);
  const primaryLinkIssue = linkIssues[0];
  const latestWarning = logs.find((entry) => entry.level === "warning" || entry.level === "error");
  const headerMessage = primaryLinkIssue?.message ?? latestWarning?.message ?? logs[0]?.message ?? "No activity yet";

  return (
    <section data-tour="activity-log" className="activity-dock">
      <header className="activity-dock__header">
        <button className="flex items-center gap-3 text-left" onClick={() => setOpen((value) => !value)}>
          <span className="panel-kicker">Activity</span>
          <span className="font-mono text-[9px] text-slate-500">{logs.length.toString().padStart(3, "0")} entries</span>
        </button>
        <div className={`truncate font-mono text-[9px] ${primaryLinkIssue ? "text-amber-200" : "text-slate-400"}`}>
          {headerMessage}
        </div>
        <div className="flex items-center gap-1">
          {linkIssues.length > 0 && <span className="status-tag status-tag--warn">Link issue</span>}
          {open && <button className="operator-button h-6" onClick={onClear}>Clear</button>}
          <button className="operator-button h-6" onClick={() => setOpen((value) => !value)}>
            {open ? "Collapse" : "Expand"}
          </button>
        </div>
      </header>

      {open && (
        <div className="activity-dock__body">
          {linkIssues.length > 0 && (
            <div className="border-b border-amber-400/25 bg-amber-950/20 px-3 py-2">
              {linkIssues.map((issue) => (
                <div key={issue.id} className="grid grid-cols-[120px_1fr] gap-3 py-1 text-[10px]">
                  <strong className="uppercase tracking-[0.1em] text-amber-200">{issue.title}</strong>
                  <span className="text-slate-300">{issue.message}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex min-h-8 items-center gap-4 overflow-x-auto border-b border-white/8 px-3 py-1 font-mono text-[9px]">
            <span className="panel-kicker shrink-0">Frame IDs</span>
            {messages.length === 0 && <span className="text-slate-600">No parsed frame statistics</span>}
            {messages.map((message) => (
              <span key={message.id} className="shrink-0 text-slate-400">
                {message.id}:{message.label} <strong className="text-slate-200">{message.count.toLocaleString()}</strong>
              </span>
            ))}
          </div>

          {logs.length === 0 ? (
            <div className="px-3 py-6 text-center font-mono text-[10px] text-slate-600">No activity recorded</div>
          ) : (
            <div className="log-table">
              <div className="log-table__header">
                <span>Time</span><span>Level</span><span>Source</span><span>Message</span>
              </div>
              {logs.map((entry) => (
                <div key={entry.id} className="log-table__row">
                  <span className="text-slate-500">{new Date(entry.time).toLocaleTimeString([], { hour12: false })}</span>
                  <span className={levelClass(entry.level)}>{entry.level.toUpperCase()}</span>
                  <span className="text-slate-600">GCS</span>
                  <span className="text-slate-300">{entry.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function levelClass(level: ActivityLogEntry["level"]): string {
  if (level === "success") return "text-emerald-300";
  if (level === "warning") return "text-yellow-200";
  if (level === "error") return "text-red-300";
  return "text-slate-400";
}
