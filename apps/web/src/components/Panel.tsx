import type { DragEvent, PropsWithChildren, ReactNode } from "react";

interface PanelProps extends PropsWithChildren {
  title?: string;
  action?: ReactNode;
  className?: string;
  sortable?: boolean;
  onDragStart?: (event: DragEvent) => void;
  onDragEnd?: () => void;
}

export function Panel({ title, action, className = "", sortable = false, onDragStart, onDragEnd, children }: PanelProps) {
  return (
    <section className={`rounded-xl border border-line bg-panel shadow-glow backdrop-blur ${className}`}>
      {(title || action) && (
        <header
          className={`flex items-center justify-between gap-2 border-b border-line px-3 py-2 ${sortable ? "cursor-grab active:cursor-grabbing" : ""}`}
          draggable={sortable}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <div className="flex min-w-0 items-center gap-2">
            {sortable && <span className="shrink-0 select-none text-slate-600" aria-hidden="true">⠿</span>}
            {title && <h2 className="truncate text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">{title}</h2>}
          </div>
          {action}
        </header>
      )}
      <div className="p-3">{children}</div>
    </section>
  );
}

export function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "good" | "warn" | "bad" }) {
  const toneClass = {
    default: "text-slate-100",
    good: "text-emerald-300",
    warn: "text-yellow-200",
    bad: "text-red-300"
  }[tone];

  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className={`mt-1 truncate font-mono text-sm font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: PropsWithChildren<{ tone?: "neutral" | "good" | "warn" | "bad" }>) {
  const toneClass = {
    neutral: "border-slate-600/70 bg-slate-700/40 text-slate-200",
    good: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
    warn: "border-yellow-300/30 bg-yellow-300/10 text-yellow-100",
    bad: "border-red-400/30 bg-red-400/10 text-red-200"
  }[tone];

  return <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${toneClass}`}>{children}</span>;
}
