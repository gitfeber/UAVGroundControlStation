import type { ReactNode } from "react";

interface MapToolbarProps {
  followEnabled: boolean;
  followPaused: boolean;
  headingUp: boolean;
  canRecenter: boolean;
  trackPointCount: number;
  onFollowChange: (enabled: boolean) => void;
  onHeadingUpChange: (enabled: boolean) => void;
  onRecenter: () => void;
  onFitTrack: () => void;
}

export function MapToolbar({
  followEnabled,
  followPaused,
  headingUp,
  canRecenter,
  trackPointCount,
  onFollowChange,
  onHeadingUpChange,
  onRecenter,
  onFitTrack
}: MapToolbarProps) {
  return (
    <div className="map-toolbar absolute bottom-14 left-4 z-10 flex flex-col gap-1.5">
      <div className="map-toolbar__group flex flex-wrap items-center gap-1" role="group" aria-label="Map navigation">
        <ToolbarButton active={followEnabled} onClick={() => onFollowChange(!followEnabled)} title="Follow aircraft position">
          Follow
        </ToolbarButton>
        <ToolbarButton
          active={headingUp}
          disabled={!followEnabled}
          onClick={() => onHeadingUpChange(!headingUp)}
          title="Rotate map with aircraft heading (heading-up vs north-up)"
        >
          {headingUp ? "Hdg up" : "N up"}
        </ToolbarButton>
        <ToolbarButton disabled={!canRecenter} onClick={onRecenter} title="Center map on aircraft and resume follow">
          Recenter
        </ToolbarButton>
        <ToolbarButton disabled={trackPointCount === 0} onClick={onFitTrack} title="Zoom map to fit the session track">
          Fit track
        </ToolbarButton>
      </div>
      {followEnabled && followPaused && (
        <div className="rounded border border-amber-400/25 bg-slate-950/85 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-amber-200/90">
          Follow paused — pan/zoom or tap Recenter
        </div>
      )}
    </div>
  );
}

function ToolbarButton({
  children,
  active = false,
  disabled = false,
  title,
  onClick
}: {
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`map-toolbar__btn${active ? " map-toolbar__btn--active" : ""}`}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
