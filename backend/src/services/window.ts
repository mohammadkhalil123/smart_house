import { DaySlice } from '../data/dataSource';
import { TimeWindow } from '../models/types';
import {
  epochToLocal,
  formatIsoWithOffset,
  formatTimeString,
  localDaysBetween,
} from '../utils/dateTime';

/** Optional time-range filters accepted by the history / series endpoints. */
export interface RangeQuery {
  fromMs?: number;
  toMs?: number;
  windowMinutes?: number;
}

export interface Window {
  fromMs: number;
  toMs: number;
}

/**
 *  - from + to            -> exactly that range
 *  - only from            -> from .. from + window
 *  - only to              -> to - window .. to
 *  - neither              -> the `window` ending at `anchorMs` (the newest record), or null if there is none
 * `window` = windowMinutes or the default.
 */
export function resolveWindow(range: RangeQuery, anchorMs: number | null, defaultWindowMinutes: number): Window | null {
  const windowMs = (range.windowMinutes ?? defaultWindowMinutes) * 60_000;
  if (range.fromMs !== undefined && range.toMs !== undefined) return { fromMs: range.fromMs, toMs: range.toMs };
  if (range.fromMs !== undefined) return { fromMs: range.fromMs, toMs: range.fromMs + windowMs };
  if (range.toMs !== undefined) return { fromMs: range.toMs - windowMs, toMs: range.toMs };
  if (anchorMs === null) return null;
  return { fromMs: anchorMs - windowMs, toMs: anchorMs };
}

export function toTimeWindow(window: Window | null, timeZone: string): TimeWindow | null {
  if (!window) return null;
  return {
    from: formatIsoWithOffset(window.fromMs, timeZone),
    to: formatIsoWithOffset(window.toMs, timeZone),
    fromMs: window.fromMs,
    toMs: window.toMs,
  };
}

/** One slice per local day touched by the window; the first/last slices carry the time bounds. */
export function buildSlices(window: Window, timeZone: string): DaySlice[] {
  const days = localDaysBetween(window.fromMs, window.toMs, timeZone);
  const fromTime = formatTimeString(epochToLocal(window.fromMs, timeZone));
  const toTime = formatTimeString(epochToLocal(window.toMs, timeZone));
  return days.map((date, i) => {
    const slice: DaySlice = { date };
    if (i === 0) slice.fromTime = fromTime;
    if (i === days.length - 1) slice.toTime = toTime;
    return slice;
  });
}
