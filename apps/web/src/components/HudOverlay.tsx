import { useId } from "react";
import type { TelemetryState } from "@uav-ground-control-station/shared";
import { formatNumber } from "../lib/format";
import { resolveHeadingDeg } from "../lib/resolveHeadingDeg";
import { resolveHudAltitude } from "../lib/resolveHudAltitude";

const CLIMB_FULL_SCALE_MS = 5;
const PITCH_PX_PER_DEG = 4;
const PITCH_LADDER_DEG = [5, 10, 15, 20, 25, 30, 35, 40, 45];

interface HudOverlayProps {
  telemetry: TelemetryState;
  /** When true, dims the HUD and shows a stale-data banner (live mode only). */
  stale?: boolean;
  /** Phase 2: smaller variant for video PiP. */
  compact?: boolean;
  /** When false, omit `data-tour="attitude-hud"` (e.g. compact PiP duplicate). */
  showTourTarget?: boolean;
}

export function HudOverlay({ telemetry, stale = false, compact = false, showTourTarget = true }: HudOverlayProps) {
  const clipId = useId().replace(/:/g, "");
  const size = compact ? 220 : 320;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.36;

  const rollDeg = telemetry.motion.rollDeg;
  const pitchDeg = telemetry.motion.pitchDeg;
  const hasAttitude =
    rollDeg !== null &&
    pitchDeg !== null &&
    Number.isFinite(rollDeg) &&
    Number.isFinite(pitchDeg);

  const heading = resolveHeadingDeg(telemetry);
  const altitude = resolveHudAltitude(telemetry);
  const groundSpeed = telemetry.motion.groundSpeed;
  const climbRate = telemetry.motion.climbRate;
  const { armed, flightMode } = telemetry.vehicle;

  const climbFill = climbBarFill(climbRate);

  return (
    <div
      {...(showTourTarget ? { "data-tour": "attitude-hud" } : {})}
      className={`relative pointer-events-none select-none font-mono text-slate-100 ${
        stale ? "opacity-60 saturate-50" : ""
      }`}
      style={{ width: size, height: size }}
      aria-label={stale ? "Attitude HUD — telemetry stale" : "Attitude HUD"}
    >
      {stale && (
        <div className="absolute inset-x-0 top-0 z-10 flex justify-center">
          <span className="rounded-b border border-amber-400/50 bg-amber-950/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-amber-200">
            Stale
          </span>
        </div>
      )}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
        <defs>
          <clipPath id={clipId}>
            <circle cx={cx} cy={cy} r={radius} />
          </clipPath>
        </defs>

        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="rgba(8,11,13,0.84)"
          stroke="rgba(184,200,205,0.28)"
          strokeWidth={1}
        />

        <g clipPath={`url(#${clipId})`}>
          {hasAttitude ? (
            <g transform={`rotate(${-rollDeg}, ${cx}, ${cy})`}>
              <rect
                x={cx - radius * 2}
                y={cy - radius * 3}
                width={radius * 4}
                height={radius * 3}
                fill="rgba(14,116,144,0.55)"
              />
              <rect
                x={cx - radius * 2}
                y={cy + pitchToPx(pitchDeg)}
                width={radius * 4}
                height={radius * 3}
                fill="rgba(120,53,15,0.65)"
              />
              <line
                x1={cx - radius}
                y1={cy + pitchToPx(pitchDeg)}
                x2={cx + radius}
                y2={cy + pitchToPx(pitchDeg)}
                stroke="#e2e8f0"
                strokeWidth={2}
              />
              {PITCH_LADDER_DEG.map((deg) => (
                <PitchLadderLine
                  key={`up-${deg}`}
                  cx={cx}
                  cy={cy}
                  pitchDeg={pitchDeg}
                  ladderDeg={deg}
                  radius={radius}
                  major={deg % 10 === 0}
                />
              ))}
              {PITCH_LADDER_DEG.map((deg) => (
                <PitchLadderLine
                  key={`down-${deg}`}
                  cx={cx}
                  cy={cy}
                  pitchDeg={pitchDeg}
                  ladderDeg={-deg}
                  radius={radius}
                  major={deg % 10 === 0}
                />
              ))}
            </g>
          ) : (
            <>
              <circle cx={cx} cy={cy} r={radius} fill="rgba(30,41,59,0.85)" />
              <text
                x={cx}
                y={cy + 4}
                textAnchor="middle"
                fill="rgba(148,163,184,0.9)"
                fontSize={compact ? 11 : 13}
                fontWeight={700}
                letterSpacing="0.12em"
              >
                NO ATT
              </text>
            </>
          )}
        </g>

        <g transform={`rotate(${hasAttitude ? -rollDeg : 0}, ${cx}, ${cy})`}>
          <RollArc cx={cx} cy={cy} radius={radius} />
        </g>

        <polygon
          points={`${cx},${cy - radius + 6} ${cx - 7},${cy - radius + 20} ${cx + 7},${cy - radius + 20}`}
          fill="#78aa8d"
        />
        <circle cx={cx} cy={cy} r={4} fill="none" stroke="#78aa8d" strokeWidth={1.5} />
        <line x1={cx - 18} y1={cy} x2={cx + 18} y2={cy} stroke="#78aa8d" strokeWidth={1.5} />
        <line x1={cx} y1={cy - 18} x2={cx} y2={cy + 18} stroke="#78aa8d" strokeWidth={1.5} />

        <HeadingTape cx={cx} top={compact ? 10 : 14} width={size - 24} heading={heading} compact={compact} />
      </svg>

      <div
        className="absolute flex items-stretch justify-between px-2"
        style={{ left: 0, right: 0, top: compact ? 52 : 72, height: compact ? 100 : 120 }}
      >
        <div className="flex flex-col justify-center text-left">
          <div className="text-[9px] uppercase tracking-[0.18em] text-slate-400">GS</div>
          <div className={`text-lg font-bold ${groundSpeed === null ? "text-slate-500" : "text-slate-100"}`}>
            {formatNumber(groundSpeed, 1)}
          </div>
          <div className="text-[9px] text-slate-400">m/s</div>
        </div>

        <ClimbBar fill={climbFill} height={compact ? 88 : 108} width={10} />

        <div className="flex flex-col items-end justify-center text-right">
          <div className="text-[9px] uppercase tracking-[0.18em] text-slate-400">
            {altitude.label ?? "ALT"}
          </div>
          <div className={`text-lg font-bold ${altitude.value === null ? "text-slate-500" : "text-slate-100"}`}>
            {formatNumber(altitude.value, 1)}
          </div>
          <div className="text-[9px] text-slate-400">m</div>
        </div>
      </div>

      <div
        className="absolute inset-x-0 flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.14em]"
        style={{ bottom: compact ? 6 : 10 }}
      >
        <span
          className={`rounded px-1.5 py-0.5 font-bold ${
            armed ? "border border-red-400/50 bg-red-950/60 text-red-200" : "border border-white/10 bg-black/40 text-slate-400"
          }`}
        >
          {armed ? "ARM" : "DISARM"}
        </span>
        <span className="max-w-[9rem] truncate text-slate-200">{flightMode || "--"}</span>
      </div>
    </div>
  );
}

function pitchToPx(pitchDeg: number): number {
  return pitchDeg * PITCH_PX_PER_DEG;
}

interface PitchLadderLineProps {
  cx: number;
  cy: number;
  pitchDeg: number;
  ladderDeg: number;
  radius: number;
  major: boolean;
}

function PitchLadderLine({ cx, cy, pitchDeg, ladderDeg, radius, major }: PitchLadderLineProps) {
  const y = cy + pitchToPx(pitchDeg - ladderDeg);
  const half = major ? radius * 0.55 : radius * 0.32;
  const stroke = major ? "#e2e8f0" : "rgba(226,232,240,0.55)";
  const strokeWidth = major ? 1.5 : 1;
  const label = Math.abs(ladderDeg);

  return (
    <g>
      <line x1={cx - half} y1={y} x2={cx + half} y2={y} stroke={stroke} strokeWidth={strokeWidth} />
      {major && (
        <>
          <text x={cx - half - 14} y={y + 3} textAnchor="end" fill="rgba(226,232,240,0.75)" fontSize={9}>
            {label}
          </text>
          <text x={cx + half + 14} y={y + 3} textAnchor="start" fill="rgba(226,232,240,0.75)" fontSize={9}>
            {label}
          </text>
        </>
      )}
    </g>
  );
}

function RollArc({ cx, cy, radius }: { cx: number; cy: number; radius: number }) {
  const r = radius - 4;
  const startX = cx - r * 0.72;
  const startY = cy - r * 0.72;
  const endX = cx + r * 0.72;
  const endY = cy - r * 0.72;

  const ticks = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];

  return (
    <g>
      <path
        d={`M ${startX} ${startY} A ${r} ${r} 0 0 1 ${endX} ${endY}`}
        fill="none"
        stroke="rgba(34,211,238,0.45)"
        strokeWidth={1.5}
      />
      {ticks.map((deg) => {
        const rad = ((deg - 90) * Math.PI) / 180;
        const x1 = cx + Math.cos(rad) * (r - 6);
        const y1 = cy + Math.sin(rad) * (r - 6);
        const x2 = cx + Math.cos(rad) * r;
        const y2 = cy + Math.sin(rad) * r;
        const major = deg % 30 === 0;
        return (
          <line
            key={deg}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={major ? "#78aa8d" : "rgba(120,170,141,0.45)"}
            strokeWidth={major ? 1.5 : 1}
          />
        );
      })}
    </g>
  );
}

function HeadingTape({
  cx,
  top,
  width,
  heading,
  compact
}: {
  cx: number;
  top: number;
  width: number;
  heading: number | null;
  compact: boolean;
}) {
  const tapeHeight = compact ? 22 : 26;
  const left = cx - width / 2;
  const hasHeading = heading !== null && Number.isFinite(heading);
  const center = hasHeading ? normalizeHeading(heading) : 0;
  const span = 50;
  const pxPerDeg = width / span;

  const marks: { deg: number; major: boolean }[] = [];
  for (let offset = -span / 2; offset <= span / 2; offset += 5) {
    const deg = normalizeHeading(center + offset);
    marks.push({ deg, major: offset % 10 === 0 });
  }

  return (
    <g transform={`translate(0, ${top})`}>
      <rect
        x={left}
        y={0}
        width={width}
        height={tapeHeight}
        rx={4}
        fill="rgba(2,6,23,0.78)"
        stroke="rgba(34,211,238,0.25)"
      />
      <line x1={cx} y1={0} x2={cx} y2={tapeHeight} stroke="#78aa8d" strokeWidth={1.5} />
      <polygon
        points={`${cx},${tapeHeight + 4} ${cx - 5},${tapeHeight} ${cx + 5},${tapeHeight}`}
        fill="#78aa8d"
      />
      {hasHeading ? (
        marks.map(({ deg, major }) => {
          let offset = deg - center;
          if (offset > 180) offset -= 360;
          if (offset < -180) offset += 360;
          const x = cx + offset * pxPerDeg;
          if (x < left + 4 || x > left + width - 4) return null;
          return (
            <g key={`${deg}-${offset}`}>
              <line
                x1={x}
                y1={major ? 4 : 7}
                x2={x}
                y2={major ? tapeHeight - 4 : tapeHeight - 7}
                stroke={major ? "rgba(226,232,240,0.85)" : "rgba(148,163,184,0.5)"}
                strokeWidth={1}
              />
              {major && (
                <text x={x} y={tapeHeight - 8} textAnchor="middle" fill="rgba(226,232,240,0.8)" fontSize={8}>
                  {String(deg).padStart(3, "0")}
                </text>
              )}
            </g>
          );
        })
      ) : (
        <text x={cx} y={tapeHeight - 7} textAnchor="middle" fill="rgba(148,163,184,0.7)" fontSize={9}>
          HDG --
        </text>
      )}
      {hasHeading && (
        <text x={cx} y={12} textAnchor="middle" fill="#a5f3fc" fontSize={compact ? 10 : 11} fontWeight={700}>
          {String(Math.round(center)).padStart(3, "0")}
        </text>
      )}
    </g>
  );
}

function ClimbBar({ fill, height, width }: { fill: number | null; height: number; width: number }) {
  const unavailable = fill === null;
  const clamped = unavailable ? 0 : Math.max(-1, Math.min(1, fill));
  const half = height / 2;
  const barHeight = Math.abs(clamped) * half;

  return (
    <div className="flex flex-col items-center" style={{ width }}>
      <div className="text-[8px] uppercase tracking-[0.14em] text-slate-500">VS</div>
      <div
        className={`relative mt-1 overflow-hidden rounded-sm border ${
          unavailable ? "border-slate-600 bg-slate-800/80" : "border-emerald-500/30 bg-slate-900/80"
        }`}
        style={{ width, height }}
      >
        <div className="absolute left-0 right-0 top-1/2 h-px bg-slate-500/60" />
        {!unavailable && clamped > 0 && (
          <div
            className="absolute left-0 right-0 bg-emerald-400/85"
            style={{ bottom: "50%", height: barHeight }}
          />
        )}
        {!unavailable && clamped < 0 && (
          <div className="absolute left-0 right-0 bg-amber-400/85" style={{ top: "50%", height: barHeight }} />
        )}
      </div>
      <div className="mt-0.5 text-[7px] text-slate-500">±5</div>
    </div>
  );
}

function climbBarFill(climbRate: number | null): number | null {
  if (climbRate === null || !Number.isFinite(climbRate)) return null;
  return climbRate / CLIMB_FULL_SCALE_MS;
}

function normalizeHeading(deg: number): number {
  const n = deg % 360;
  return n < 0 ? n + 360 : n;
}
