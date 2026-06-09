import { useId, type ReactNode } from "react";
import type { TelemetryState } from "@uav-ground-control-station/shared";
import { clampBatteryPercent, elapsedTime, formatInteger, formatNumber, percentageColor } from "../lib/format";
import { resolveHeadingDeg } from "../lib/resolveHeadingDeg";
import { resolveHudAltitude, type HudAltitudeDisplay } from "../lib/resolveHudAltitude";
import type { SidebarCardId } from "../lib/sidebarCardOrder";
import { sensorHealthSummary } from "../lib/sensorHealth";
import type { SidebarDragHandlers } from "./SidebarSortableList";
import { SidebarSortableList } from "./SidebarSortableList";

const CLIMB_FULL_SCALE_MS = 5;

interface TelemetryInstrumentsProps {
  telemetry: TelemetryState;
  distanceFromHome: number | null;
  order: SidebarCardId[];
  onOrderChange: (order: SidebarCardId[]) => void;
}

export function TelemetryInstruments({ telemetry, distanceFromHome, order, onOrderChange }: TelemetryInstrumentsProps) {
  const altitude = resolveHudAltitude(telemetry);
  const sensorSummary = sensorHealthSummary(telemetry);

  return (
    <SidebarSortableList
      mode="instruments"
      order={order}
      onOrderChange={onOrderChange}
      renderCard={(id, drag) => renderInstrumentCard(id, { telemetry, distanceFromHome, altitude, sensorSummary }, drag)}
    />
  );
}

interface InstrumentRenderContext {
  telemetry: TelemetryState;
  distanceFromHome: number | null;
  altitude: HudAltitudeDisplay;
  sensorSummary: string;
}

function renderInstrumentCard(id: SidebarCardId, ctx: InstrumentRenderContext, drag: SidebarDragHandlers) {
  const { telemetry, distanceFromHome, altitude, sensorSummary } = ctx;
  const { vehicle } = telemetry;

  switch (id) {
    case "vehicle":
      return (
        <InstrumentCard title="Vehicle" sortable drag={drag}>
          <div className="flex w-full flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span
                className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                  vehicle.armed
                    ? "border-red-400/40 bg-red-500/15 text-red-200"
                    : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                }`}
              >
                {vehicle.armed ? "Armed" : "Safe"}
              </span>
              <span className="truncate font-mono text-xs text-cyan-100">{vehicle.flightMode || "--"}</span>
            </div>
            <ChipRow>
              <Chip label="Type" value={vehicle.type || "--"} />
              <Chip label="Base" value={formatInteger(vehicle.baseMode)} />
              <Chip label="SYS" value={formatInteger(vehicle.systemId)} />
              <Chip label="COMP" value={formatInteger(vehicle.componentId)} />
            </ChipRow>
          </div>
        </InstrumentCard>
      );
    case "motion":
      return (
        <InstrumentCard title="Alt / Speed / V/S" sortable drag={drag}>
          <MotionTapesInstrument telemetry={telemetry} altitude={altitude} />
        </InstrumentCard>
      );
    case "attitude":
      return (
        <InstrumentCard title="Attitude" sortable drag={drag}>
          <AttitudeInstrument telemetry={telemetry} />
        </InstrumentCard>
      );
    case "compass":
      return (
        <InstrumentCard title="Compass" sortable drag={drag}>
          <CompassInstrument telemetry={telemetry} />
        </InstrumentCard>
      );
    case "gps":
      return (
        <InstrumentCard title="GPS / Navigation" sortable drag={drag}>
          <GpsInstrument telemetry={telemetry} distanceFromHome={distanceFromHome} />
        </InstrumentCard>
      );
    case "battery":
      return (
        <InstrumentCard title="Battery" sortable drag={drag}>
          <BatteryGauge telemetry={telemetry} />
        </InstrumentCard>
      );
    case "radio":
      return (
        <InstrumentCard title="Radio / Link" sortable drag={drag}>
          <RadioInstrument telemetry={telemetry} />
        </InstrumentCard>
      );
    case "system":
      return (
        <InstrumentCard title="System" sortable drag={drag}>
          <SystemInstrument telemetry={telemetry} sensorSummary={sensorSummary} />
        </InstrumentCard>
      );
    case "session":
      return (
        <InstrumentCard title="Session" sortable drag={drag}>
          <SessionInstrument telemetry={telemetry} />
        </InstrumentCard>
      );
    default:
      return null;
  }
}

function InstrumentCard({
  title,
  children,
  sortable = false,
  drag
}: {
  title: string;
  children: ReactNode;
  sortable?: boolean;
  drag?: SidebarDragHandlers;
}) {
  return (
    <section className="rounded-xl border border-line bg-panel/90 shadow-glow">
      <header
        className={`flex items-center gap-2 border-b border-line px-2.5 py-1.5 ${sortable ? "cursor-grab active:cursor-grabbing" : ""}`}
        draggable={sortable}
        onDragStart={drag?.onDragStart}
        onDragEnd={drag?.onDragEnd}
      >
        {sortable && <span className="select-none text-slate-600" aria-hidden="true">⠿</span>}
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/90">{title}</h3>
      </header>
      <div className="w-full p-2">{children}</div>
    </section>
  );
}

function ChipRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex w-full flex-wrap gap-1 ${className}`}>{children}</div>;
}

function Chip({
  label,
  value,
  tone = "default",
  wide = false
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "warn" | "bad";
  wide?: boolean;
}) {
  const valueTone = {
    default: "text-slate-200",
    good: "text-emerald-300",
    warn: "text-yellow-200",
    bad: "text-red-300"
  }[tone];

  return (
    <div
      className={`min-w-0 rounded border border-white/5 bg-black/25 px-1.5 py-1 ${wide ? "w-full" : "flex-1 basis-[calc(50%-0.25rem)]"}`}
    >
      <div className="text-[8px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`truncate font-mono text-[10px] font-semibold ${valueTone}`}>{value}</div>
    </div>
  );
}

function CompassInstrument({ telemetry }: { telemetry: TelemetryState }) {
  const headingDeg = resolveHeadingDeg(telemetry);
  const { groundCourseDeg } = telemetry.position;
  const { yawDeg } = telemetry.motion;

  return (
    <div className="flex w-full items-center gap-3">
      <CompassRose headingDeg={headingDeg} groundCourseDeg={groundCourseDeg} size={96} />
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-1">
        <Chip label="HDG" value={formatNumber(headingDeg, 0, "°")} wide />
        <Chip label="CRS" value={formatNumber(groundCourseDeg, 0, "°")} wide />
        <Chip label="Yaw" value={formatNumber(yawDeg, 0, "°")} wide />
        <Chip label="Src" value={headingSourceLabel(telemetry)} wide />
      </div>
    </div>
  );
}

function CompassRose({
  headingDeg,
  groundCourseDeg,
  size = 96
}: {
  headingDeg: number | null;
  groundCourseDeg: number | null;
  size?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="rgba(2,6,23,0.5)" stroke="rgba(34,211,238,0.25)" strokeWidth={1} />
        {["N", "E", "S", "W"].map((label, index) => {
          const p = polar(cx, cy, r - 10, index * 90);
          return (
            <text
              key={label}
              x={p.x}
              y={p.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={label === "N" ? "#67e8f9" : "#64748b"}
              fontSize={10}
              fontFamily="ui-monospace, monospace"
              fontWeight={600}
            >
              {label}
            </text>
          );
        })}
        {headingDeg === null ? (
          <text x={cx} y={cy} textAnchor="middle" fill="#64748b" fontSize={10} fontFamily="ui-monospace, monospace">
            NO HDG
          </text>
        ) : (
          <g transform={`rotate(${headingDeg}, ${cx}, ${cy})`}>
            <polygon points={`${cx},${cy - r + 12} ${cx - 5},${cy - r + 26} ${cx + 5},${cy - r + 26}`} fill="#22d3ee" />
            <line x1={cx} y1={cy} x2={cx} y2={cy - r + 6} stroke="#22d3ee" strokeWidth={2} />
          </g>
        )}
        {groundCourseDeg !== null && Number.isFinite(groundCourseDeg) && (
          <g transform={`rotate(${groundCourseDeg}, ${cx}, ${cy})`}>
            <line x1={cx} y1={cy} x2={cx} y2={cy - r + 16} stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="3 3" />
          </g>
        )}
      </svg>
    </div>
  );
}

function GpsInstrument({
  telemetry,
  distanceFromHome
}: {
  telemetry: TelemetryState;
  distanceFromHome: number | null;
}) {
  const { gps, position } = telemetry;
  const fixType = gps.fixType ?? 0;
  const fixTone = fixType >= 3 ? "good" : fixType >= 2 ? "warn" : "default";

  return (
    <div className="flex w-full flex-col gap-2">
      <div
        className={`rounded-lg border px-2 py-2 text-center ${
          fixType >= 3
            ? "border-emerald-400/35 bg-emerald-500/10"
            : fixType >= 2
              ? "border-amber-400/35 bg-amber-500/10"
              : "border-slate-600/50 bg-slate-800/40"
        }`}
      >
        <div className="text-[9px] uppercase tracking-[0.2em] text-slate-500">Fix</div>
        <div className={`mt-0.5 font-mono text-sm font-semibold ${fixTone === "good" ? "text-emerald-200" : fixTone === "warn" ? "text-amber-100" : "text-slate-400"}`}>
          {gps.fixLabel || "--"}
        </div>
      </div>
      <ChipRow>
        <Chip label="SAT" value={formatInteger(gps.satellites)} tone={fixTone} />
        <Chip label="EPH" value={formatNumber(gps.eph, 1)} />
        <Chip label="EPV" value={formatNumber(gps.epv, 1)} />
      </ChipRow>
      <ChipRow>
        <Chip label="HOME" value={formatNumber(distanceFromHome, 0, " m")} />
      </ChipRow>
      <div className="rounded border border-white/5 bg-black/25 px-2 py-1.5 font-mono text-[10px] leading-snug text-slate-400">
        {formatNumber(position.lat, 7)}, {formatNumber(position.lon, 7)}
      </div>
    </div>
  );
}

function MotionTapesInstrument({
  telemetry,
  altitude
}: {
  telemetry: TelemetryState;
  altitude: HudAltitudeDisplay;
}) {
  const { position, motion } = telemetry;

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex w-full justify-between gap-1">
        <TapeColumn title="Alt">
          <VerticalTape
            compact
            value={altitude.value}
            span={50}
            tickStep={10}
            unit="m"
            suffix={altitude.label ?? ""}
          />
        </TapeColumn>
        <TapeColumn title="Spd">
          <VerticalTape compact value={motion.groundSpeed} span={12} tickStep={2} unit="m/s" />
        </TapeColumn>
        <TapeColumn title="V/S">
          <VerticalTape
            compact
            value={motion.climbRate}
            span={CLIMB_FULL_SCALE_MS}
            tickStep={1}
            unit="m/s"
            centeredOnZero
          />
        </TapeColumn>
      </div>
      <ChipRow>
        <Chip label="RAT" value={formatNumber(position.relativeAlt, 1, " m")} />
        <Chip label="MSL" value={formatNumber(position.altMsl, 1, " m")} />
        <Chip label="GS" value={formatNumber(motion.groundSpeed, 1, " m/s")} />
        <Chip label="AS" value={formatNumber(motion.airSpeed, 1, " m/s")} />
        <Chip label="Climb" value={formatNumber(motion.climbRate, 1, " m/s")} />
      </ChipRow>
    </div>
  );
}

function TapeColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
      <span className="text-[8px] font-semibold uppercase tracking-[0.16em] text-cyan-300/80">{title}</span>
      {children}
    </div>
  );
}

function AttitudeInstrument({ telemetry }: { telemetry: TelemetryState }) {
  const { rollDeg, pitchDeg, yawDeg, climbRate } = telemetry.motion;

  return (
    <div className="flex w-full items-center gap-3">
      <AttitudeBall rollDeg={rollDeg} pitchDeg={pitchDeg} size={88} />
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-1">
        <Chip label="Roll" value={formatNumber(rollDeg, 0, "°")} wide />
        <Chip label="Pitch" value={formatNumber(pitchDeg, 0, "°")} wide />
        <Chip label="Yaw" value={formatNumber(yawDeg, 0, "°")} wide />
        <Chip label="Climb" value={formatNumber(climbRate, 1, " m/s")} wide />
      </div>
    </div>
  );
}

function BatteryGauge({ telemetry }: { telemetry: TelemetryState }) {
  const { battery, stats } = telemetry;
  const percent = clampBatteryPercent(battery.remainingPercent);
  const fill = percent !== null && Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  const hasPercent = percent !== null && Number.isFinite(percent);

  return (
    <div className="flex w-full gap-3">
      <div className="flex shrink-0 flex-col items-center gap-1">
        <svg width="72" height="44" viewBox="0 0 72 44">
          <path d="M 8 38 A 28 28 0 0 1 64 38" fill="none" stroke="rgba(30,41,59,0.9)" strokeWidth={6} strokeLinecap="round" />
          {hasPercent && (
            <path
              d="M 8 38 A 28 28 0 0 1 64 38"
              fill="none"
              stroke={arcColor(fill)}
              strokeWidth={6}
              strokeLinecap="round"
              strokeDasharray={`${(fill / 100) * 88} 88`}
            />
          )}
          <text x={36} y={32} textAnchor="middle" fill="#f1f5f9" fontSize={12} fontFamily="ui-monospace, monospace" fontWeight={600}>
            {formatInteger(percent, "%")}
          </text>
        </svg>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div className={`h-full ${percentageColor(percent)}`} style={{ width: `${fill}%` }} />
        </div>
        <div className="grid grid-cols-3 gap-1">
          <Chip label="V" value={formatNumber(battery.voltage, 2, " V")} wide />
          <Chip label="A" value={formatNumber(battery.current, 1, " A")} wide />
          <Chip label="Cell" value={formatNumber(battery.cellVoltageEstimate, 2, " V")} wide />
          <Chip label="Used" value={formatInteger(battery.consumedMah, " mAh")} wide />
          <Chip label="Min V" value={formatNumber(stats.minVoltage, 2, " V")} tone="warn" wide />
          <Chip label="Max A" value={formatNumber(stats.maxCurrent, 1, " A")} wide />
        </div>
      </div>
    </div>
  );
}

function RadioInstrument({ telemetry }: { telemetry: TelemetryState }) {
  const { radio } = telemetry;

  return (
    <div className="flex w-full flex-col gap-2">
      <HorizontalSignalBar label="RSSI" value={radio.rssi} max={100} tone={radioTone(radio.rssi)} />
      <HorizontalSignalBar label="REM" value={radio.remRssi} max={100} tone={radioTone(radio.remRssi)} />
      <HorizontalSignalBar label="LQ" value={radio.linkQuality} max={100} tone={radioTone(radio.linkQuality)} />
      <HorizontalSignalBar label="TX" value={radio.txBuffer} max={100} tone="default" />
      <div className="grid grid-cols-2 gap-1">
        <Chip label="RX Err" value={formatInteger(radio.rxErrors)} tone={(radio.rxErrors ?? 0) > 0 ? "warn" : "default"} wide />
        <Chip label="Fixed" value={formatInteger(radio.fixed)} wide />
      </div>
    </div>
  );
}

function SystemInstrument({ telemetry, sensorSummary }: { telemetry: TelemetryState; sensorSummary: string }) {
  const load = telemetry.system.loadPercent;
  const loadPct = load !== null && Number.isFinite(load) ? Math.max(0, Math.min(100, load)) : null;

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex w-full items-center gap-2">
        <span className="w-10 text-[9px] uppercase text-slate-500">Load</span>
        <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-800">
          <div
            className={`h-full ${loadPct !== null ? (loadPct > 80 ? "bg-red-500" : loadPct > 50 ? "bg-yellow-300" : "bg-cyan-400") : "bg-slate-700"}`}
            style={{ width: `${loadPct ?? 0}%` }}
          />
        </div>
        <span className="font-mono text-[10px] text-slate-200">{formatNumber(load, 0, "%")}</span>
      </div>
      <Chip label="Sensors" value={sensorSummary} tone={sensorSummary === "Healthy" ? "good" : "warn"} wide />
      <div className="max-h-24 w-full space-y-1 overflow-y-auto">
        {telemetry.system.statusText.length === 0 ? (
          <div className="text-[10px] text-slate-500">No STATUSTEXT</div>
        ) : (
          telemetry.system.statusText.slice(0, 6).map((message, index) => (
            <div
              key={`${message}-${index}`}
              className="rounded border border-white/5 bg-black/20 px-1.5 py-1 font-mono text-[10px] leading-snug text-slate-300"
            >
              {message}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SessionInstrument({ telemetry }: { telemetry: TelemetryState }) {
  const { stats } = telemetry;
  const warnings = stats.warningCount ?? 0;

  return (
    <div className="flex w-full flex-col gap-2">
      <Chip label="Time" value={elapsedTime(stats.sessionStartedAt)} wide />
      <SessionBar label="Max Alt" value={stats.maxAltitude} max={500} unit="m" />
      <SessionBar label="Max Spd" value={stats.maxSpeed} max={30} unit="m/s" />
      <SessionBar label="Max Dist" value={stats.maxDistance} max={5000} unit="m" />
      <ChipRow>
        <Chip label="Min V" value={formatNumber(stats.minVoltage, 2, " V")} />
        <Chip label="Min RSSI" value={formatInteger(stats.minRssi)} />
        <Chip label="Warn" value={formatInteger(warnings)} tone={warnings > 0 ? "warn" : "good"} />
      </ChipRow>
    </div>
  );
}

function SessionBar({
  label,
  value,
  max,
  unit
}: {
  label: string;
  value: number | null;
  max: number;
  unit: string;
}) {
  const hasValue = value !== null && Number.isFinite(value);
  const pct = hasValue ? Math.min(100, (value / max) * 100) : 0;

  return (
    <div className="w-full">
      <div className="mb-0.5 flex justify-between font-mono text-[9px]">
        <span className="text-slate-500">{label}</span>
        <span className="text-slate-300">{formatNumber(value, unit === "m" && max >= 1000 ? 0 : 1, ` ${unit}`)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full bg-cyan-500/70" style={{ width: hasValue ? `${pct}%` : "0%" }} />
      </div>
    </div>
  );
}

function HorizontalSignalBar({
  label,
  value,
  max,
  tone = "default"
}: {
  label: string;
  value: number | null;
  max: number;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const hasValue = value !== null && Number.isFinite(value);
  const pct = hasValue ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const barClass =
    tone === "good"
      ? "bg-emerald-400/85"
      : tone === "warn"
        ? "bg-yellow-300/85"
        : tone === "bad"
          ? "bg-red-500/85"
          : barTone(pct);

  return (
    <div className="flex w-full items-center gap-2">
      <span className="w-9 shrink-0 text-[9px] uppercase tracking-wide text-slate-500">{label}</span>
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full ${hasValue ? barClass : "bg-slate-700"}`} style={{ width: hasValue ? `${pct}%` : "0%" }} />
      </div>
      <span className="w-8 shrink-0 text-right font-mono text-[10px] text-slate-200">{formatInteger(value)}</span>
    </div>
  );
}

function VerticalTape({
  value,
  span,
  tickStep,
  unit,
  suffix = "",
  centeredOnZero = false,
  compact = false
}: {
  value: number | null;
  span: number;
  tickStep: number;
  unit: string;
  suffix?: string;
  centeredOnZero?: boolean;
  compact?: boolean;
}) {
  const height = compact ? 88 : 100;
  const width = compact ? 44 : 52;
  const hasValue = value !== null && Number.isFinite(value);
  const center = centeredOnZero ? 0 : hasValue ? value! : 0;
  const tickCount = Math.ceil(span / tickStep);
  const ticks: number[] = [];
  for (let i = -tickCount; i <= tickCount; i += 1) {
    ticks.push(center + i * tickStep);
  }
  const pxPerUnit = height / (span * 2);

  return (
    <div className={`flex items-stretch ${compact ? "flex-col items-center" : "gap-1"}`}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0">
        <rect x={0} y={0} width={width} height={height} rx={4} fill="rgba(2,6,23,0.65)" stroke="rgba(34,211,238,0.2)" />
        {!hasValue && (
          <text x={width / 2} y={height / 2} textAnchor="middle" fill="#475569" fontSize={9} fontFamily="ui-monospace, monospace">
            --
          </text>
        )}
        {hasValue &&
          ticks.map((tick, index) => {
            const offset = (tick - value!) * pxPerUnit;
            const y = height / 2 - offset;
            if (y < 4 || y > height - 4) return null;
            const major = index % 2 === 0;
            return (
              <g key={`${tick}-${index}`}>
                <line
                  x1={major ? 8 : 12}
                  y1={y}
                  x2={width - 4}
                  y2={y}
                  stroke={major ? "rgba(34,211,238,0.45)" : "rgba(148,163,184,0.2)"}
                  strokeWidth={major ? 1 : 0.5}
                />
                {major && (
                  <text x={width - 3} y={y + 3} textAnchor="end" fill="#94a3b8" fontSize={7} fontFamily="ui-monospace, monospace">
                    {Math.round(tick)}
                  </text>
                )}
              </g>
            );
          })}
        <polygon
          points={`${width / 2 - 4},${height / 2} ${width / 2 + 4},${height / 2} ${width / 2},${height / 2 - 5}`}
          fill="#22d3ee"
        />
      </svg>
      <div
        className={`font-mono text-slate-400 ${compact ? "mt-0.5 text-center text-[8px] leading-tight" : "flex flex-col justify-between py-0.5 text-[8px] text-slate-500"}`}
      >
        <span>{formatNumber(value, compact ? 0 : 1)}</span>
        <span className="text-slate-500">
          {unit}
          {suffix ? ` ${suffix}` : ""}
        </span>
      </div>
    </div>
  );
}

function AttitudeBall({
  rollDeg,
  pitchDeg,
  size = 92
}: {
  rollDeg: number | null;
  pitchDeg: number | null;
  size?: number;
}) {
  const clipId = useId().replace(/:/g, "");
  const cx = size / 2;
  const cy = size / 2;
  const r = 36;
  const hasAttitude =
    rollDeg !== null && pitchDeg !== null && Number.isFinite(rollDeg) && Number.isFinite(pitchDeg);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="rgba(2,6,23,0.7)" stroke="rgba(34,211,238,0.3)" strokeWidth={1} />
      <clipPath id={clipId}>
        <circle cx={cx} cy={cy} r={r - 1} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        {hasAttitude ? (
          <g transform={`rotate(${-rollDeg!}, ${cx}, ${cy})`}>
            <rect x={cx - r * 2} y={cy - r * 2} width={r * 4} height={r} fill="rgba(14,116,144,0.6)" />
            <rect x={cx - r * 2} y={cy + pitchDeg! * 1.1} width={r * 4} height={r} fill="rgba(120,53,15,0.7)" />
            <line x1={cx - r} y1={cy + pitchDeg! * 1.1} x2={cx + r} y2={cy + pitchDeg! * 1.1} stroke="#facc15" strokeWidth={2} />
          </g>
        ) : (
          <>
            <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} fill="rgba(30,41,59,0.5)" />
            <text x={cx} y={cy} textAnchor="middle" fill="#64748b" fontSize={9} fontFamily="ui-monospace, monospace">
              NO ATT
            </text>
          </>
        )}
      </g>
      <circle cx={cx} cy={cy} r={2} fill="#22d3ee" />
    </svg>
  );
}

function headingSourceLabel(telemetry: TelemetryState): string {
  const { headingDeg, groundCourseDeg } = telemetry.position;
  if (headingDeg !== null && Number.isFinite(headingDeg)) return "HDG";
  if (groundCourseDeg !== null && Number.isFinite(groundCourseDeg)) return "CRS";
  if (telemetry.motion.yawDeg !== null) return "YAW";
  return "--";
}

function radioTone(value: number | null): "default" | "good" | "warn" | "bad" {
  if (value === null) return "default";
  if (value >= 70) return "good";
  if (value >= 35) return "warn";
  return "bad";
}

function polar(cx: number, cy: number, radius: number, deg: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

function arcColor(percent: number): string {
  if (percent > 50) return "#34d399";
  if (percent >= 25) return "#facc15";
  return "#f87171";
}

function barTone(pct: number): string {
  if (pct >= 70) return "bg-emerald-400/85";
  if (pct >= 35) return "bg-yellow-300/85";
  return "bg-red-500/85";
}
