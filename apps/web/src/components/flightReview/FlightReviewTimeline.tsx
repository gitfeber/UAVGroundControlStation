import type { FlightReviewFinding } from "../../flightReview/flightReviewTypes";
import type { ReplayController } from "../../hooks/useReplayController";
import { Panel } from "../Panel";

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function FlightReviewTimeline({
  replay,
  findings,
  durationMs
}: {
  replay: ReplayController;
  findings: FlightReviewFinding[];
  durationMs: number;
}) {
  const { controllerState } = replay;
  const currentTimeMs = controllerState.currentReplayTimeMs;
  const status = controllerState.status;
  const markers = findings.filter((f) => f.showOnTimeline);
  const maxMs = Math.max(1, durationMs);

  const isPlaying = status === "playing";

  return (
    <Panel title="Timeline" className="shrink-0">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={() =>
              isPlaying ? replay.pause() : status === "paused" ? replay.resume() : replay.start()
            }
          >
            {isPlaying ? "Pause" : status === "paused" ? "Resume" : "Play"}
          </button>
          <button type="button" className="btn-secondary text-xs" onClick={replay.restart}>
            Restart
          </button>
          <span className="ml-auto font-mono text-xs text-slate-400">
            {formatClock(currentTimeMs)} / {formatClock(durationMs)}
          </span>
        </div>

        <div className="relative h-7 border border-white/10 bg-black/30">
          {markers.map((marker) => {
            const left = `${(marker.timeMs / maxMs) * 100}%`;
            return (
              <button
                key={marker.id}
                type="button"
                title={`${marker.title} @ ${formatClock(marker.timeMs)}`}
                className={`absolute top-1/2 z-10 h-2 w-2 -translate-x-1/2 -translate-y-1/2 border ${
                  marker.severity === "warn"
                    ? "border-yellow-200 bg-yellow-400/80"
                    : "border-emerald-200 bg-emerald-400/80"
                }`}
                style={{ left }}
                onClick={() => replay.seek(marker.timeMs)}
              />
            );
          })}
          <div
            className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-white/90"
            style={{ left: `${(currentTimeMs / maxMs) * 100}%` }}
          />
        </div>

        <input
          type="range"
          min={0}
          max={maxMs}
          step={1}
          value={Math.min(currentTimeMs, maxMs)}
          onChange={(event) => replay.seek(Number(event.target.value))}
          className="w-full accent-emerald-500"
        />
      </div>
    </Panel>
  );
}
