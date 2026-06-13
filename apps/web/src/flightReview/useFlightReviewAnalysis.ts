import { useMemo } from "react";
import type { NormalizedReplayEvent, ReplayLogMetadata } from "@uav-ground-control-station/shared";
import { deriveFlightReview, type FlightReviewResult } from "./deriveFlightReview";

export function useFlightReviewAnalysis(
  events: NormalizedReplayEvent[],
  metadata: ReplayLogMetadata | null
): FlightReviewResult | null {
  return useMemo(() => {
    if (events.length === 0 || metadata === null) return null;
    return deriveFlightReview(events, {}, metadata);
  }, [events, metadata]);
}

export type ActiveView = "dashboard" | "flightReview";
