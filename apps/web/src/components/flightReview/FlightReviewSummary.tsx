import type { FlightReviewSummary as Summary } from "../../flightReview/flightReviewTypes";
import { Metric } from "../Panel";
import { formatNumber } from "../../lib/format";

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function FlightReviewSummaryCards({ summary }: { summary: Summary }) {
  return (
    <div className="review-summary-strip grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8">
      <Metric label="Duration" value={formatDuration(summary.durationMs)} />
      <Metric label="Samples" value={String(summary.telemetrySampleCount)} />
      <Metric label="Max alt" value={formatNumber(summary.maxAltitudeM, 1, " m")} />
      <Metric label="Max speed" value={formatNumber(summary.maxSpeedMps, 1, " m/s")} />
      <Metric label="Max distance" value={formatNumber(summary.maxDistanceFromHomeM, 0, " m")} />
      <Metric label="Min voltage" value={formatNumber(summary.minVoltageV, 1, " V")} />
      <Metric label="Min battery" value={formatNumber(summary.minBatteryPercent, 0, " %")} />
      <Metric label="Armed time" value={formatDuration(summary.armedDurationMs)} />
    </div>
  );
}
