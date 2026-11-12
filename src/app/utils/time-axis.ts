const MIN = 60_000;
const HOUR = 60 * MIN;

/** Tick spacings tried in order; the first one that gives at most ~6 ticks wins (30 min for a 2 h window). */
const STEPS = [MIN, 5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, 24 * HOUR];

export function tickStep(rangeMs: number): number {
  const wanted = rangeMs / 6;
  return STEPS.find((s) => s >= wanted) ?? STEPS[STEPS.length - 1];
}

/** Evenly spaced tick positions (aligned to the step) inside [start, end]. */
export function timeTicks(start: number, end: number): number[] {
  const step = tickStep(end - start);
  const ticks: number[] = [];
  for (let t = Math.ceil(start / step) * step; t <= end; t += step) ticks.push(t);
  return ticks;
}

/** HH:mm (or HH:mm:ss) in the measurement time zone, not the browser's. */
export function formatTime(ms: number, timeZone: string | undefined, seconds = false): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    hour12: false,
    timeZone,
  });
}
