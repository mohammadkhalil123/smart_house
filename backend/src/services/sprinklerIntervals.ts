import {
  ActivationType,
  SprinklerActivation,
  SprinklerInterval,
  SprinklerTransition,
} from '../models/types';
import { formatIsoWithOffset } from '../utils/dateTime';

/**
 * Turns activations (start + run_time) into continuous ON intervals.
 * Activations that overlap or touch in the same zone are merged: the sprinkler stays ON
 * until the last of them has ended. Zero-length activations never switch it ON.
 *
 * Intervals are half-open: ON at `start`, OFF again at `end`.
 * The input must contain a single zone only.
 */
export function mergeActivations(activations: readonly SprinklerActivation[], timeZone: string): SprinklerInterval[] {
  const sorted = activations
    .filter((a) => a.endMs > a.startMs)
    .slice()
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const merged: { startMs: number; endMs: number; ids: string[]; types: Set<ActivationType> }[] = [];
  for (const a of sorted) {
    const current = merged[merged.length - 1];
    if (current && a.startMs <= current.endMs) {
      current.endMs = Math.max(current.endMs, a.endMs);
      current.ids.push(a.id);
      current.types.add(a.activationType);
    } else {
      merged.push({ startMs: a.startMs, endMs: a.endMs, ids: [a.id], types: new Set([a.activationType]) });
    }
  }

  return merged.map((m) => ({
    start: formatIsoWithOffset(m.startMs, timeZone),
    startMs: m.startMs,
    end: formatIsoWithOffset(m.endMs, timeZone),
    endMs: m.endMs,
    durationMs: m.endMs - m.startMs,
    activationIds: m.ids,
    activationTypes: [...m.types],
  }));
}

/** The interval that is ON at `atMs` (start inclusive, end exclusive), if any. */
export function intervalAt(intervals: readonly SprinklerInterval[], atMs: number): SprinklerInterval | undefined {
  return intervals.find((i) => i.startMs <= atMs && atMs < i.endMs);
}

/** Chronological ON/OFF switch events, optionally limited to [fromMs, toMs]. */
export function buildTransitions(
  intervals: readonly SprinklerInterval[],
  timeZone: string,
  fromMs = Number.NEGATIVE_INFINITY,
  toMs = Number.POSITIVE_INFINITY,
): SprinklerTransition[] {
  const events: SprinklerTransition[] = [];
  for (const i of intervals) {
    events.push({ timestamp: i.start, epochMs: i.startMs, state: 'ON' });
    events.push({ timestamp: i.end, epochMs: i.endMs, state: 'OFF' });
  }
  return events
    .filter((e) => e.epochMs >= fromMs && e.epochMs <= toMs)
    .sort((a, b) => a.epochMs - b.epochMs);
}
