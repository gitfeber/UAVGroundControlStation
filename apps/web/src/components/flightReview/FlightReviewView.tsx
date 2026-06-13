import { useMemo } from "react";
import type { ReplayController } from "../../hooks/useReplayController";
import type { FlightReviewResult } from "../../flightReview";
import { validCoordinate } from "../../lib/geo";
import { FlightReviewFindingsPanel } from "./FlightReviewFindings";
import { FlightReviewGraphs } from "./FlightReviewGraphs";
import { FlightReviewMapPanel } from "./FlightReviewMapPanel";
import { FlightReviewSummaryCards } from "./FlightReviewSummary";
import { FlightReviewTimeline } from "./FlightReviewTimeline";

interface FlightReviewViewProps {
  analysis: FlightReviewResult;
  replay: ReplayController;
}

export function FlightReviewView({ analysis, replay }: FlightReviewViewProps) {
  const { controllerState } = replay;
  const currentTimeMs = controllerState.currentReplayTimeMs;
  const durationMs = Math.max(analysis.summary.durationMs, controllerState.durationMs);

  const currentPosition = useMemo(() => {
    const coord = validCoordinate(
      replay.replayTelemetry.position?.lat,
      replay.replayTelemetry.position?.lon
    );
    return coord;
  }, [replay.replayTelemetry.position?.lat, replay.replayTelemetry.position?.lon]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <div className="shrink-0">
        <FlightReviewSummaryCards summary={analysis.summary} />
      </div>

      <div className="grid min-h-[18rem] flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(14rem,18rem)_1fr]">
        <FlightReviewFindingsPanel
          findings={analysis.findings}
          currentTimeMs={currentTimeMs}
          onSeek={replay.seek}
        />
        <FlightReviewMapPanel
          path={analysis.renderPath}
          sessionHome={analysis.summary.sessionHome}
          currentPosition={currentPosition}
        />
      </div>

      <FlightReviewTimeline replay={replay} findings={analysis.findings} durationMs={durationMs} />

      <FlightReviewGraphs
        series={analysis.renderSeries}
        currentTimeMs={currentTimeMs}
        durationMs={durationMs}
        onSeek={replay.seek}
      />
    </div>
  );
}
