import type { NormalizedReplayEvent, ReplayTimingMode } from "@uav-ground-control-station/shared";

/**
 * Pure replay scheduler core (ADR 0003, handoff §9).
 *
 * This module contains ZERO React state, timers, DOM APIs, requestAnimationFrame,
 * or wall-clock reads. It is a set of pure functions over an immutable event list
 * and a {@link SchedulerPosition}. The rAF driver (added with the controller in a
 * later milestone) is the only place that reads wall time and commits React state.
 *
 * Timing modes:
 * - `original`  — emit events whose mapped time is <= the virtual time.
 * - `fixedRate` — ignore original gaps; event N plays at N * (1000 / Hz).
 * - `manual`    — no auto-advance; only {@link stepOnce} moves the cursor.
 * - `max`       — process capped chunks as fast as possible, yielding per frame.
 */

/** Default upper bound on events processed per frame in `max` mode (handoff §9). */
export const DEFAULT_MAX_EVENTS_PER_CHUNK = 1000;

export interface SchedulerConfig {
  timingMode: ReplayTimingMode;
  /** Emit rate for `fixedRate` mode. */
  fixedRateHz: number;
  /** Chunk cap for `max` mode; defaults to {@link DEFAULT_MAX_EVENTS_PER_CHUNK}. */
  maxEventsPerChunk?: number;
}

export interface SchedulerPosition {
  /** Index of the next event to emit (0..events.length). */
  cursor: number;
  /** Current virtual replay time in ms. */
  currentTimeMs: number;
}

export interface SchedulerStepResult {
  /** Events to apply to telemetry/track state, in order, since the last call. */
  eventsToApply: NormalizedReplayEvent[];
  /** Global index of the last applied event, or -1 if none applied yet. */
  currentEventIndex: number;
  /** Virtual replay time after this step, clamped to [0, duration]. */
  currentReplayTimeMs: number;
  /** New cursor (index of the next event to emit). */
  cursor: number;
  /** True once every event has been consumed. */
  ended: boolean;
}

/** Map an event to its virtual timeline position for the active timing mode. */
export function eventVirtualTimeMs(
  event: NormalizedReplayEvent,
  index: number,
  config: SchedulerConfig
): number {
  if (config.timingMode === "fixedRate") {
    const intervalMs = 1000 / config.fixedRateHz;
    return index * intervalMs;
  }
  return event.timeMs;
}

/** Total virtual duration of the timeline for the active timing mode. */
export function totalDurationMs(
  events: NormalizedReplayEvent[],
  config: SchedulerConfig
): number {
  if (events.length === 0) return 0;
  let max = 0;
  events.forEach((event, index) => {
    max = Math.max(max, eventVirtualTimeMs(event, index, config));
  });
  return max;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** A position at the very start of playback (nothing applied yet). */
export function reset(): SchedulerStepResult {
  return {
    eventsToApply: [],
    currentEventIndex: -1,
    currentReplayTimeMs: 0,
    cursor: 0,
    ended: false
  };
}

/**
 * Advance playback to a virtual time (`original`/`fixedRate`), or consume one
 * chunk as fast as possible (`max`). In `manual` mode this is a no-op.
 *
 * Only events from `position.cursor` onward are returned, so repeated calls
 * never re-emit an already-applied event.
 */
export function advanceTo(
  events: NormalizedReplayEvent[],
  config: SchedulerConfig,
  position: SchedulerPosition,
  virtualMs: number
): SchedulerStepResult {
  const duration = totalDurationMs(events, config);

  if (config.timingMode === "manual") {
    return {
      eventsToApply: [],
      currentEventIndex: position.cursor - 1,
      currentReplayTimeMs: clamp(position.currentTimeMs, 0, duration),
      cursor: position.cursor,
      ended: position.cursor >= events.length
    };
  }

  if (config.timingMode === "max") {
    const cap = config.maxEventsPerChunk ?? DEFAULT_MAX_EVENTS_PER_CHUNK;
    const end = Math.min(position.cursor + Math.max(1, cap), events.length);
    const eventsToApply = events.slice(position.cursor, end);
    const lastIndex = end - 1;
    const currentReplayTimeMs =
      lastIndex >= 0 && eventsToApply.length > 0
        ? eventVirtualTimeMs(events[lastIndex] as NormalizedReplayEvent, lastIndex, config)
        : position.currentTimeMs;
    return {
      eventsToApply,
      currentEventIndex: end - 1,
      currentReplayTimeMs: clamp(currentReplayTimeMs, 0, duration),
      cursor: end,
      ended: end >= events.length
    };
  }

  // original / fixedRate: emit while the event's mapped time is within reach.
  let cursor = position.cursor;
  const eventsToApply: NormalizedReplayEvent[] = [];
  while (cursor < events.length) {
    const event = events[cursor] as NormalizedReplayEvent;
    if (eventVirtualTimeMs(event, cursor, config) <= virtualMs) {
      eventsToApply.push(event);
      cursor += 1;
    } else {
      break;
    }
  }

  return {
    eventsToApply,
    currentEventIndex: cursor - 1,
    currentReplayTimeMs: clamp(virtualMs, 0, duration),
    cursor,
    ended: cursor >= events.length
  };
}

/** Apply exactly the event at the cursor and advance by one (used by Step). */
export function stepOnce(
  events: NormalizedReplayEvent[],
  config: SchedulerConfig,
  position: SchedulerPosition
): SchedulerStepResult {
  const duration = totalDurationMs(events, config);
  if (position.cursor >= events.length) {
    return {
      eventsToApply: [],
      currentEventIndex: events.length - 1,
      currentReplayTimeMs: clamp(position.currentTimeMs, 0, duration),
      cursor: events.length,
      ended: true
    };
  }

  const event = events[position.cursor] as NormalizedReplayEvent;
  const cursor = position.cursor + 1;
  return {
    eventsToApply: [event],
    currentEventIndex: position.cursor,
    currentReplayTimeMs: clamp(eventVirtualTimeMs(event, position.cursor, config), 0, duration),
    cursor,
    ended: cursor >= events.length
  };
}

/**
 * Seek to a target virtual time, rebuilding from the start of the log so the
 * caller can deterministically reconstruct telemetry and the map track from an
 * empty state. Returns EVERY event from index 0 up to `targetMs` (clamped).
 */
export function seekTo(
  events: NormalizedReplayEvent[],
  config: SchedulerConfig,
  targetMs: number
): SchedulerStepResult {
  const duration = totalDurationMs(events, config);
  const clampedTarget = clamp(targetMs, 0, duration);

  let cursor = 0;
  const eventsToApply: NormalizedReplayEvent[] = [];
  while (cursor < events.length) {
    const event = events[cursor] as NormalizedReplayEvent;
    if (eventVirtualTimeMs(event, cursor, config) <= clampedTarget) {
      eventsToApply.push(event);
      cursor += 1;
    } else {
      break;
    }
  }

  return {
    eventsToApply,
    currentEventIndex: cursor - 1,
    currentReplayTimeMs: clampedTarget,
    cursor,
    ended: cursor >= events.length
  };
}
