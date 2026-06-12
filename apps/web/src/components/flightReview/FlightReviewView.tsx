import type { ReplayController } from "../../hooks/useReplayController";
import type { FlightReviewResult } from "../../flightReview";
import { FlightReviewFindingsPanel } from "./FlightReviewFindings";
import { FlightReviewSummaryCards } from "./FlightReviewSummary";

interface FlightReviewViewProps {
  analysis: FlightReviewResult;
  replay: ReplayController;
}

export function FlightReviewView({ analysis, replay }: FlightReviewViewProps) {
  const { controllerState } = replay;
  const currentTimeMs = controllerState.currentReplayTimeMs;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3">
      <div className="shrink-0">
        <FlightReviewSummaryCards summary={analysis.summary} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(14rem,18rem)_1fr]">
        <FlightReviewFindingsPanel
          findings={analysis.findings}
          currentTimeMs={currentTimeMs}
          onSeek={replay.seek}
        />
        <div className="flex min-h-[12rem] items-center justify-center rounded-xl border border-dashed border-cyan-300/20 bg-slate-950/50 text-xs text-slate-500">
          Map, timeline, and graphs load in the next milestones.
        </div>
      </div>
    </div>
  );
}
