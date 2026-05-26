import { useState } from "react";
import type { MavlinkMessageStat } from "@uav-ground-control-station/shared";
import type { ActivityLogEntry } from "../hooks/useTelemetry";

interface ActivityLogPanelProps {
  logs: ActivityLogEntry[];
  messages: MavlinkMessageStat[];
  onClear: () => void;
}

export function ActivityLogPanel({ logs, messages, onClear }: ActivityLogPanelProps) {
  const [open, setOpen] = useState(false);
  const latestWarning = logs.find((entry) => entry.level === "warning" || entry.level === "error");

  return (
    <section className="absolute bottom-4 left-[340px] z-20 w-[520px] overflow-hidden rounded-xl border border-cyan-300/20 bg-slate-950/90 shadow-glow backdrop-blur">
      <header className="flex items-center justify-between border-b border-line px-3 py-2">
        <button className="text-left" onClick={() => setOpen((value) => !value)}>
          <div className="text-[10px] uppercase tracking-[0.22em] text-cyan-200">Activity Log</div>
          <div className="mt-0.5 max-w-[360px] truncate text-xs text-slate-400">
            {latestWarning?.message ?? logs[0]?.message ?? "No activity yet"}
          </div>
        </button>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-white/10 px-2 py-1 font-mono text-[11px] text-slate-300">{logs.length}</span>
          {open && (
            <button className="rounded border border-white/10 px-2 py-1 text-xs text-slate-300 hover:border-cyan-300/40" onClick={onClear}>
              Clear
            </button>
          )}
          <button className="rounded border border-white/10 px-2 py-1 text-xs text-slate-300 hover:border-cyan-300/40" onClick={() => setOpen((value) => !value)}>
            {open ? "Hide" : "Open"}
          </button>
        </div>
      </header>

      {open && (
        <div className="max-h-[320px] space-y-2 overflow-y-auto p-2">
          <div className="rounded-lg border border-white/5 bg-black/25 p-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.18em] text-cyan-200">Frame message stats</span>
              <span className="font-mono text-[11px] text-slate-400">{messages.length} IDs</span>
            </div>
            {messages.length === 0 ? (
              <div className="text-xs text-slate-500">No frame message IDs received yet.</div>
            ) : (
              <div className="grid grid-cols-2 gap-1">
                {messages.map((message) => (
                  <div key={message.id} className="rounded border border-white/5 bg-white/[0.03] px-2 py-1 font-mono text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-slate-300">{message.id} {message.label}</span>
                      <span className="text-cyan-200">{message.count.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {logs.length === 0 ? (
            <div className="px-2 py-4 text-center text-xs text-slate-500">No activity logged yet.</div>
          ) : (
            logs.map((entry) => (
              <div key={entry.id} className="grid grid-cols-[74px_74px_1fr] gap-2 rounded-lg border border-white/5 bg-black/25 px-2 py-1.5 font-mono text-[11px]">
                <span className="text-slate-500">{new Date(entry.time).toLocaleTimeString()}</span>
                <span className={levelClass(entry.level)}>{entry.level.toUpperCase()}</span>
                <span className="text-slate-300">{entry.message}</span>
              </div>
            ))
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
  return "text-cyan-200";
}
