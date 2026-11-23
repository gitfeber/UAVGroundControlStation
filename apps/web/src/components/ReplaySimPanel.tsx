import { useRef, useState, type ChangeEvent } from "react";
import type {
  ReplayFixedRateHz,
  ReplaySpeedMode,
  ReplayTimingMode,
  SimulationOptions,
  SimulationScenario
} from "@uav-ground-control-station/shared";
import type { ReplayController } from "../hooks/useReplayController";
import { parseReplayLog, ReplayParseError } from "../replay/parser";
import {
  DEFAULT_SIMULATION_OPTIONS,
  SIMULATION_SCENARIO_LABELS
} from "../replay/simulation";

const WARN_BYTES = 25 * 1024 * 1024; // ~25 MB — warn but allow (ADR 0003)
const MAX_BYTES = 100 * 1024 * 1024; // ~100 MB — hard refuse

const SPEED_OPTIONS: ReplaySpeedMode[] = [0.25, 0.5, 1, 2, 5, 10, "max"];
const TIMING_MODES: { value: ReplayTimingMode; label: string }[] = [
  { value: "original", label: "Original" },
  { value: "fixedRate", label: "Fixed rate" },
  { value: "manual", label: "Manual" },
  { value: "max", label: "Max" }
];
const FIXED_RATES: ReplayFixedRateHz[] = [5, 10, 20, 50];

interface ReplaySimPanelProps {
  mode: "replay" | "simulation";
  replay: ReplayController;
  canOpenFlightReview?: boolean;
  onOpenFlightReview?: () => void;
}

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ReplaySimPanel({ mode, replay, canOpenFlightReview = false, onOpenFlightReview }: ReplaySimPanelProps) {
  const { controllerState } = replay;
  const [open, setOpen] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [scenario, setScenario] = useState<SimulationScenario>(DEFAULT_SIMULATION_OPTIONS.scenario);
  const [seed, setSeed] = useState(DEFAULT_SIMULATION_OPTIONS.seed);
  const [durationMin, setDurationMin] = useState(DEFAULT_SIMULATION_OPTIONS.durationMs / 60000);
  const [rateHz, setRateHz] = useState(DEFAULT_SIMULATION_OPTIONS.rateHz);

  const status = controllerState.status;
  const isReplay = mode === "replay";
  const accentText = isReplay ? "text-amber-200" : "text-slate-300";

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    setLoadError(null);
    setLoadWarning(null);
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_BYTES) {
      setLoadError(`File is ${formatBytes(file.size)} — too large to load (limit ~100 MB).`);
      event.target.value = "";
      return;
    }
    if (file.size > WARN_BYTES) {
      setLoadWarning(`Large file (${formatBytes(file.size)}); parsing may take a moment.`);
    }

    try {
      // Read the raw text into a local only — never store it in React state, and
      // let it be released as soon as parsing completes (ADR 0003).
      const text = await file.text();
      const result = parseReplayLog(text, file.name, file.size);
      replay.loadParsedLog(result);
    } catch (cause: unknown) {
      const message =
        cause instanceof ReplayParseError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "Failed to read or parse the file.";
      setLoadError(message);
    } finally {
      // Reset the input so re-selecting the same file fires onChange again.
      event.target.value = "";
    }
  }

  function startSimulation() {
    const options: SimulationOptions = {
      scenario,
      seed,
      durationMs: Math.max(1, durationMin) * 60000,
      rateHz
    };
    replay.loadSimulation(options);
    // Loading is synchronous; begin playback immediately.
    replay.start();
  }

  const hasLoaded = status !== "idle" && controllerState.metadata !== null;
  const canPlay = hasLoaded;
  const durationMs = controllerState.durationMs;
  const diagnostics = controllerState.diagnostics;

  return (
    <section
      className="replay-console"
      data-mode={mode}
    >
      <header className="flex min-h-9 items-center justify-between border-b border-white/10 px-2">
        <div className={`panel-kicker ${accentText}`}>
          Source / {isReplay ? "Replay" : "Simulation"}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-slate-400">
            {status}
          </span>
          <button
            className="operator-button h-6 px-2"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Hide" : "Open"}
          </button>
        </div>
      </header>

      {open && (
        <div className="max-h-[calc(100vh-8rem)] space-y-3 overflow-y-auto p-2 text-xs">
          {isReplay ? (
            <div className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".jsonl,.json"
                onChange={handleFile}
                className="block w-full font-mono text-[9px] text-slate-400 file:mr-2 file:border file:border-white/15 file:bg-slate-900 file:px-2 file:py-1 file:text-[9px] file:text-slate-300"
              />
              <p className="text-[11px] text-slate-500">
                Loads <span className="font-mono">.jsonl</span>/<span className="font-mono">.json</span> telemetry logs locally. Logs may contain GPS/location data; nothing is uploaded.
              </p>
            </div>
          ) : (
            <SimulationForm
              scenario={scenario}
              seed={seed}
              durationMin={durationMin}
              rateHz={rateHz}
              disabled={status === "playing"}
              onScenario={setScenario}
              onSeed={setSeed}
              onDurationMin={setDurationMin}
              onRateHz={setRateHz}
              onStart={startSimulation}
            />
          )}

          {loadError && (
            <div className="border border-red-400/30 bg-red-950/70 px-2 py-1.5 text-[11px] text-red-100">{loadError}</div>
          )}
          {loadWarning && !loadError && (
            <div className="border border-yellow-300/30 bg-yellow-950/40 px-2 py-1.5 text-[11px] text-yellow-100">{loadWarning}</div>
          )}

          {controllerState.metadata && <MetadataSummary metadata={controllerState.metadata} />}

          {isReplay && (
            <div className="space-y-1">
              <button
                type="button"
                className="btn-primary w-full"
                disabled={!canOpenFlightReview}
                title={canOpenFlightReview ? undefined : "Flight Review requires a recorded session."}
                onClick={onOpenFlightReview}
              >
                Open Flight Review
              </button>
              {!canOpenFlightReview && (
                <p className="text-[11px] text-slate-500">Flight Review requires a recorded session.</p>
              )}
            </div>
          )}

          {/* Transport controls */}
          <div className="flex flex-wrap gap-2">
            <TransportButton label={status === "playing" ? "Pause" : status === "paused" ? "Resume" : "Start"} primary disabled={!canPlay} onClick={() => (status === "playing" ? replay.pause() : status === "paused" ? replay.resume() : replay.start())} />
            <TransportButton label="Stop" disabled={!canPlay} onClick={replay.stop} />
            <TransportButton label="Restart" disabled={!canPlay} onClick={replay.restart} />
            <TransportButton label="Step" disabled={!canPlay} onClick={replay.step} />
          </div>

          {/* Seek bar */}
          <div className="space-y-1">
            <input
              type="range"
              min={0}
              max={Math.max(1, durationMs)}
              step={Math.max(1, Math.round(durationMs / 1000) || 1)}
              value={Math.min(controllerState.currentReplayTimeMs, durationMs)}
              disabled={!canPlay}
              onChange={(event) => replay.seek(Number(event.target.value))}
              className="w-full accent-emerald-500 disabled:opacity-40"
            />
            <div className="flex justify-between font-mono text-[11px] text-slate-400">
              <span>{formatClock(controllerState.currentReplayTimeMs)}</span>
              <span>{formatClock(durationMs)}</span>
            </div>
          </div>

          {/* Speed + timing controls */}
          <div className="grid grid-cols-2 gap-2">
            <LabeledSelect
              label="Speed"
              value={String(controllerState.speedMultiplier)}
              onChange={(value) => replay.setSpeed(value === "max" ? "max" : (Number(value) as ReplaySpeedMode))}
              options={SPEED_OPTIONS.map((s) => ({ value: String(s), label: s === "max" ? "Max" : `${s}×` }))}
            />
            <LabeledSelect
              label="Timing"
              value={controllerState.timingMode}
              onChange={(value) => replay.setTimingMode(value as ReplayTimingMode)}
              options={TIMING_MODES.map((m) => ({ value: m.value, label: m.label }))}
            />
            {controllerState.timingMode === "fixedRate" && (
              <LabeledSelect
                label="Rate"
                value={String(controllerState.fixedRateHz)}
                onChange={(value) => replay.setFixedRate(Number(value) as ReplayFixedRateHz)}
                options={FIXED_RATES.map((hz) => ({ value: String(hz), label: `${hz} Hz` }))}
              />
            )}
          </div>

          <Diagnostics
            currentEventIndex={diagnostics.currentEventIndex}
            eventCount={controllerState.metadata?.eventCount ?? 0}
            emittedTelemetry={diagnostics.emittedTelemetryEvents}
            emittedActivity={diagnostics.emittedActivityEvents}
            skipped={diagnostics.skippedEvents}
            parseWarnings={diagnostics.parseWarnings}
            averageEmitRateHz={diagnostics.averageEmitRateHz}
            lastError={controllerState.lastError}
          />
        </div>
      )}
    </section>
  );
}

function SimulationForm(props: {
  scenario: SimulationScenario;
  seed: number;
  durationMin: number;
  rateHz: number;
  disabled: boolean;
  onScenario: (value: SimulationScenario) => void;
  onSeed: (value: number) => void;
  onDurationMin: (value: number) => void;
  onRateHz: (value: number) => void;
  onStart: () => void;
}) {
  return (
    <div className="space-y-2">
      <LabeledSelect
        label="Scenario"
        value={props.scenario}
        onChange={(value) => props.onScenario(value as SimulationScenario)}
        options={(Object.keys(SIMULATION_SCENARIO_LABELS) as SimulationScenario[]).map((key) => ({
          value: key,
          label: SIMULATION_SCENARIO_LABELS[key]
        }))}
      />
      <div className="grid grid-cols-3 gap-2">
        <LabeledNumber label="Seed" value={props.seed} onChange={props.onSeed} />
        <LabeledNumber label="Min" value={props.durationMin} step={0.5} min={0.5} onChange={props.onDurationMin} />
        <LabeledNumber label="Hz" value={props.rateHz} min={1} onChange={props.onRateHz} />
      </div>
      <button
        className="btn-primary w-full"
        disabled={props.disabled}
        onClick={props.onStart}
      >
        Generate &amp; play
      </button>
      <p className="text-[11px] text-slate-500">Deterministic from the seed — synthetic telemetry, not live vehicle data.</p>
    </div>
  );
}

function MetadataSummary({ metadata }: { metadata: NonNullable<ReplayController["controllerState"]["metadata"]> }) {
  const flags = [
    metadata.hasGps ? "GPS" : null,
    metadata.hasBattery ? "Battery" : null,
    metadata.hasRadio ? "Radio" : null,
    metadata.hasAttitude ? "Attitude" : null
  ].filter(Boolean);

  return (
    <div className="border border-white/5 bg-black/25 p-2 text-[11px] text-slate-300">
      <div className="truncate font-mono text-slate-200" title={metadata.fileName}>{metadata.fileName}</div>
      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-slate-400">
        <span>{metadata.eventCount} events</span>
        <span>{formatClock(metadata.durationMs)} long</span>
        <span>{metadata.telemetryEventCount} telemetry</span>
        <span>{metadata.partialTelemetryEventCount} partial</span>
        <span>{metadata.activityEventCount} activity</span>
        <span>{metadata.skippedEventCount} skipped</span>
      </div>
      {flags.length > 0 && <div className="mt-1 text-emerald-200">{flags.join(" · ")}</div>}
    </div>
  );
}

function Diagnostics(props: {
  currentEventIndex: number;
  eventCount: number;
  emittedTelemetry: number;
  emittedActivity: number;
  skipped: number;
  parseWarnings: number;
  averageEmitRateHz: number;
  lastError: string | null;
}) {
  return (
    <div className="border border-white/5 bg-black/25 p-2">
      <div className="mb-1 panel-kicker">Diagnostics</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] text-slate-400">
        <span>Event {props.currentEventIndex + 1}/{props.eventCount}</span>
        <span>{props.averageEmitRateHz} Hz avg</span>
        <span>{props.emittedTelemetry} emitted</span>
        <span>{props.emittedActivity} activity</span>
        <span>{props.skipped} skipped</span>
        <span>{props.parseWarnings} warnings</span>
      </div>
      {props.lastError && <div className="mt-1 text-[11px] text-red-300">{props.lastError}</div>}
    </div>
  );
}

function TransportButton({
  label,
  onClick,
  disabled,
  primary = false
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      className={`${primary ? "btn-primary" : "btn-secondary"} flex-1 whitespace-nowrap text-xs`}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <select
        className="input-dark mt-0.5 w-full"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function LabeledNumber({
  label,
  value,
  onChange,
  min,
  step
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <input
        type="number"
        className="input-dark mt-0.5 w-full"
        value={value}
        min={min}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
