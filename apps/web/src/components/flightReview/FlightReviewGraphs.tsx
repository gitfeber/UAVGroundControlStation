import { useCallback, useMemo, type MouseEvent } from "react";
import type { FlightReviewRenderSeries } from "../../flightReview/flightReviewTypes";
import { Panel } from "../Panel";

interface GraphProps {
  label: string;
  unit: string;
  points: { timeMs: number; value: number }[];
  currentTimeMs: number;
  durationMs: number;
  onSeek: (timeMs: number) => void;
  color?: string;
}

function ReviewGraph({
  label,
  unit,
  points,
  currentTimeMs,
  durationMs,
  onSeek,
  color = "#22d3ee"
}: GraphProps) {
  const width = 400;
  const height = 120;
  const pad = 8;

  const { path, minY, maxY } = useMemo(() => {
    if (points.length === 0) return { path: "", minY: 0, maxY: 1 };
    const values = points.map((p) => p.value);
    const minY = Math.min(...values);
    const maxY = Math.max(...values);
    const spanY = maxY - minY || 1;
    const maxX = Math.max(1, durationMs);

    const coords = points.map((p) => {
      const x = pad + ((width - pad * 2) * p.timeMs) / maxX;
      const y = height - pad - ((height - pad * 2) * (p.value - minY)) / spanY;
      return `${x},${y}`;
    });

    return { path: coords.join(" "), minY, maxY };
  }, [points, durationMs]);

  const playheadX = pad + ((width - pad * 2) * currentTimeMs) / Math.max(1, durationMs);

  const handleClick = useCallback(
    (event: MouseEvent<SVGSVGElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, (x - pad) / (width - pad * 2)));
      onSeek(Math.round(ratio * durationMs));
    },
    [durationMs, onSeek]
  );

  return (
    <Panel title={label} className="min-h-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-28 w-full cursor-crosshair"
        onClick={handleClick}
        role="img"
        aria-label={`${label} graph`}
      >
        <rect x={0} y={0} width={width} height={height} fill="transparent" />
        {path && <polyline fill="none" stroke={color} strokeWidth={1.5} points={path} />}
        <line x1={playheadX} x2={playheadX} y1={pad} y2={height - pad} stroke="#f8fafc" strokeWidth={1} opacity={0.7} />
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500">
        <span>
          {minY.toFixed(1)}–{maxY.toFixed(1)} {unit}
        </span>
        <span>{points.length} pts</span>
      </div>
    </Panel>
  );
}

export function FlightReviewGraphs({
  series,
  currentTimeMs,
  durationMs,
  onSeek
}: {
  series: FlightReviewRenderSeries;
  currentTimeMs: number;
  durationMs: number;
  onSeek: (timeMs: number) => void;
}) {
  const gpsQuality = useMemo(
    () => series.gps.map((p) => ({ timeMs: p.timeMs, value: p.gpsQualityScore })),
    [series.gps]
  );

  return (
    <div className="grid shrink-0 grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
      <ReviewGraph label="Altitude" unit="m" points={series.altitude} currentTimeMs={currentTimeMs} durationMs={durationMs} onSeek={onSeek} />
      <ReviewGraph label="Speed" unit="m/s" points={series.speed} currentTimeMs={currentTimeMs} durationMs={durationMs} onSeek={onSeek} color="#a855f7" />
      <ReviewGraph label="Battery" unit="V" points={series.batteryVoltage} currentTimeMs={currentTimeMs} durationMs={durationMs} onSeek={onSeek} color="#22c55e" />
      <ReviewGraph label="Link quality" unit="%" points={series.linkQuality} currentTimeMs={currentTimeMs} durationMs={durationMs} onSeek={onSeek} color="#fbbf24" />
      <ReviewGraph label="GPS quality" unit="score" points={gpsQuality} currentTimeMs={currentTimeMs} durationMs={durationMs} onSeek={onSeek} color="#38bdf8" />
    </div>
  );
}
