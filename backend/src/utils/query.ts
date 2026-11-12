import { MEASURE_TYPES, MeasureType } from '../models/types';
import { RangeQuery } from '../services/window';
import { parseInstant } from './dateTime';
import { ApiError } from './errors';

export type RawQuery = Record<string, unknown>;

export interface QueryLimits {
  zones: readonly number[];
  timeZone: string;
  maxRangeDays: number;
}

/** Returns the single string value of a query parameter, or undefined when absent/empty. */
function single(query: RawQuery, name: string): string | undefined {
  const value = query[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw ApiError.badRequest(`Query parameter "${name}" must be given once, as plain text.`, { parameter: name });
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** `place` (the zone) is mandatory so that a request can never silently mix zones. */
export function parsePlace(query: RawQuery, limits: Pick<QueryLimits, 'zones'>): number {
  const text = single(query, 'place');
  if (text === undefined) {
    throw ApiError.badRequest(`Query parameter "place" is required (one of: ${limits.zones.join(', ')}).`, {
      parameter: 'place',
    });
  }
  const place = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!limits.zones.includes(place)) {
    throw ApiError.badRequest(`Invalid place "${text}". Available zones: ${limits.zones.join(', ')}.`, {
      parameter: 'place',
      allowed: [...limits.zones],
    });
  }
  return place;
}

export function parseMeasureType(query: RawQuery): MeasureType {
  const text = single(query, 'type');
  if (text === undefined) {
    throw ApiError.badRequest(`Query parameter "type" is required (one of: ${MEASURE_TYPES.join(', ')}).`, {
      parameter: 'type',
    });
  }
  const type = MEASURE_TYPES.find((t) => t === text);
  if (!type) {
    throw ApiError.badRequest(`Invalid type "${text}". Supported types: ${MEASURE_TYPES.join(', ')}.`, {
      parameter: 'type',
      allowed: [...MEASURE_TYPES],
    });
  }
  return type;
}

function parseInstantParam(query: RawQuery, name: string, timeZone: string): number | undefined {
  const text = single(query, name);
  if (text === undefined) return undefined;
  const ms = parseInstant(text, timeZone);
  if (ms === null) {
    throw ApiError.badRequest(
      `Invalid "${name}" value "${text}". Use ISO 8601, e.g. 2026-11-10T13:00:00+01:00 ` +
        `(without an offset the value is read in ${timeZone}).`,
      { parameter: name },
    );
  }
  return ms;
}

/** Optional `from`, `to` (ISO 8601) and `windowMinutes`. */
export function parseRange(query: RawQuery, limits: Pick<QueryLimits, 'timeZone' | 'maxRangeDays'>): RangeQuery {
  const fromMs = parseInstantParam(query, 'from', limits.timeZone);
  const toMs = parseInstantParam(query, 'to', limits.timeZone);

  let windowMinutes: number | undefined;
  const wText = single(query, 'windowMinutes');
  if (wText !== undefined) {
    windowMinutes = /^\d+$/.test(wText) ? Number(wText) : NaN;
    const max = limits.maxRangeDays * 1440;
    if (!Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > max) {
      throw ApiError.badRequest(`"windowMinutes" must be an integer between 1 and ${max}.`, {
        parameter: 'windowMinutes',
      });
    }
  }

  if (fromMs !== undefined && toMs !== undefined) {
    if (fromMs >= toMs) throw ApiError.badRequest('"from" must be earlier than "to".', { parameter: 'from' });
    if (windowMinutes !== undefined) {
      throw ApiError.badRequest('Use either "windowMinutes" or both "from" and "to", not all three.', {
        parameter: 'windowMinutes',
      });
    }
    if (toMs - fromMs > limits.maxRangeDays * 86_400_000) {
      throw ApiError.badRequest(`The requested range is longer than ${limits.maxRangeDays} days.`, { parameter: 'to' });
    }
  }
  return { fromMs, toMs, windowMinutes };
}

/** Optional `at` instant for the sprinkler state. */
export function parseAt(query: RawQuery, limits: Pick<QueryLimits, 'timeZone'>): number | undefined {
  return parseInstantParam(query, 'at', limits.timeZone);
}
