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
    <section className={`operator-panel ${className}`}>
      {(title || action) && (
        <header
          className="operator-panel__header"
          draggable={sortable}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <div className="flex min-w-0 items-center gap-2">
            {sortable && <span className="shrink-0 select-none text-slate-700" aria-hidden="true">⋮⋮</span>}
            {title && <h2 className="operator-panel__title">{title}</h2>}
          </div>
          {action}
        </header>
      )}
      <div className="operator-panel__body">{children}</div>
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
    <div className="instrument-value">
      <div className="instrument-value__label">{label}</div>
      <div className={`instrument-value__data ${toneClass}`}>{value}</div>
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: PropsWithChildren<{ tone?: "neutral" | "good" | "warn" | "bad" }>) {
  const toneClass = {
    neutral: "",
    good: "status-tag--good",
    warn: "status-tag--warn",
    bad: "status-tag--bad"
  }[tone];

  return <span className={`status-tag ${toneClass}`}>{children}</span>;
}
