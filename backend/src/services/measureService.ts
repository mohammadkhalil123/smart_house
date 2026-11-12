import { DataSource } from '../data/dataSource';
import {
  LatestMeasuresResponse,
  MEASURE_TYPES,
  MeasureHistoryResponse,
  MeasurePoint,
  MeasureReading,
  MeasureSeriesBlock,
  MeasureSeriesResponse,
  MeasureType,
  RawMeasureDoc,
  ResponseMeta,
} from '../models/types';
import {
  dateToDayNumber,
  formatIsoWithOffset,
  parseDateString,
  parseMeasurementTimestamp,
} from '../utils/dateTime';
import { buildSlices, RangeQuery, resolveWindow, toTimeWindow } from './window';

/** Units. Humidity is intentionally unit-less: the stored number is passed through untouched. */
export const MEASURE_UNITS: Record<MeasureType, string | null> = {
  Tmp: '°C',
  Hum: null,
  Lum: 'lux',
};

/** How many newest documents to inspect per day/type when looking for the latest valid one. */
const LATEST_CANDIDATES = 20;
/** How many distinct days to walk back when a type has no data on the newest day. */
const MAX_LOOKBACK_DAYS = 31;

export interface ParsedMeasure {
  id: string;
  type: MeasureType;
  place: number;
  value: number;
  rawValue: string;
  epochMs: number;
  date: string;
  dateHour: string;
}

export interface ServiceSettings {
  timeZone: string;
  defaultWindowMinutes: number;
  meta: ResponseMeta;
}

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Stored strings -> numbers. null for anything that is not a plain finite number. */
export function parseMeasureValue(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!NUMBER_RE.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function compareParsed(a: ParsedMeasure, b: ParsedMeasure): number {
  return a.epochMs - b.epochMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Validates and converts raw documents. Documents of another zone are dropped (defence in
 * depth, never mixed in); malformed documents are counted in `invalid` and skipped.
 */
export function parseMeasureDocs(
  docs: readonly RawMeasureDoc[],
  place: number,
  timeZone: string,
): { parsed: ParsedMeasure[]; invalid: number } {
  const parsed: ParsedMeasure[] = [];
  let invalid = 0;
  for (const doc of docs) {
    if (doc.place !== place) continue;
    const type = MEASURE_TYPES.find((t) => t === doc.measure_type);
    const value = parseMeasureValue(doc.value);
    const epochMs = parseMeasurementTimestamp(doc.date, doc.date_hour, timeZone);
    if (!type || value === null || epochMs === null) {
      invalid++;
      continue;
    }
    parsed.push({
      id: String(doc._id),
      type,
      place,
      value,
      rawValue: String(doc.value),
      epochMs,
      date: doc.date,
      dateHour: doc.date_hour,
    });
  }
  return { parsed, invalid };
}

export class MeasureService {
  constructor(
    private readonly source: DataSource,
    private readonly settings: ServiceSettings,
  ) {}

  async latest(place: number): Promise<LatestMeasuresResponse> {
    const { byType, invalid } = await this.findLatest(place, MEASURE_TYPES);
    return {
      place,
      temperature: this.toReading(byType.get('Tmp')),
      humidity: this.toReading(byType.get('Hum')),
      luminosity: this.toReading(byType.get('Lum')),
      invalidRecords: invalid,
      meta: this.settings.meta,
    };
  }

  async history(place: number, type: MeasureType, range: RangeQuery): Promise<MeasureHistoryResponse> {
    const { window, byType, invalid } = await this.loadWindow(place, [type], range);
    const points = (byType.get(type) ?? []).map((m) => this.toPoint(m));
    return {
      place,
      type,
      unit: MEASURE_UNITS[type],
      window: toTimeWindow(window, this.settings.timeZone),
      count: points.length,
      points,
      invalidRecords: invalid,
      meta: this.settings.meta,
    };
  }

  async series(place: number, range: RangeQuery): Promise<MeasureSeriesResponse> {
    const { window, byType, invalid } = await this.loadWindow(place, MEASURE_TYPES, range);
    const block = (type: MeasureType): MeasureSeriesBlock => {
      const points = (byType.get(type) ?? []).map((m) => this.toPoint(m));
      return { type, unit: MEASURE_UNITS[type], count: points.length, points };
    };
    return {
      place,
      window: toTimeWindow(window, this.settings.timeZone),
      temperature: block('Tmp'),
      humidity: block('Hum'),
      luminosity: block('Lum'),
      invalidRecords: invalid,
      meta: this.settings.meta,
    };
  }

  /* ------------------------------ internals ------------------------------ */

  /** Newest valid measurement of each requested type, chosen by parsed timestamp. */
  private async findLatest(
    place: number,
    types: readonly MeasureType[],
  ): Promise<{ byType: Map<MeasureType, ParsedMeasure>; invalid: number }> {
    const tz = this.settings.timeZone;
    const byType = new Map<MeasureType, ParsedMeasure>();
    let invalid = 0;

    // Newest day first, ordered by real calendar date (never as strings).
    const days = (await this.source.listMeasureDates(place))
      .map((raw) => ({ raw, parsed: parseDateString(raw) }))
      .filter((d): d is { raw: string; parsed: NonNullable<typeof d.parsed> } => d.parsed !== null)
      .sort((a, b) => dateToDayNumber(b.parsed) - dateToDayNumber(a.parsed))
      .slice(0, MAX_LOOKBACK_DAYS);

    for (const day of days) {
      const missing = types.filter((t) => !byType.has(t));
      if (missing.length === 0) break;
      const results = await Promise.all(
        missing.map((type) =>
          this.source.findLatestMeasures({ place, date: day.raw, type, limit: LATEST_CANDIDATES }),
        ),
      );
      results.forEach((docs, i) => {
        const { parsed, invalid: bad } = parseMeasureDocs(docs, place, tz);
        invalid += bad;
        const best = parsed.filter((p) => p.type === missing[i]).sort(compareParsed).pop();
        if (best) byType.set(missing[i], best);
      });
    }
    return { byType, invalid };
  }

  private async loadWindow(
    place: number,
    types: readonly MeasureType[],
    range: RangeQuery,
  ): Promise<{
    window: { fromMs: number; toMs: number } | null;
    byType: Map<MeasureType, ParsedMeasure[]>;
    invalid: number;
  }> {
    const tz = this.settings.timeZone;
    let invalid = 0;
    let anchor: number | null = null;

    if (range.fromMs === undefined && range.toMs === undefined) {
      const latest = await this.findLatest(place, types);
      invalid += latest.invalid;
      const epochs = [...latest.byType.values()].map((m) => m.epochMs);
      anchor = epochs.length ? Math.max(...epochs) : null;
    }

    const window = resolveWindow(range, anchor, this.settings.defaultWindowMinutes);
    const byType = new Map<MeasureType, ParsedMeasure[]>();
    if (!window) return { window: null, byType, invalid };

    const docs = await this.source.findMeasures({ place, types, slices: buildSlices(window, tz) });
    const { parsed, invalid: bad } = parseMeasureDocs(docs, place, tz);
    invalid += bad;

    for (const m of parsed.sort(compareParsed)) {
      if (m.epochMs < window.fromMs || m.epochMs > window.toMs) continue;
      const list = byType.get(m.type) ?? [];
      list.push(m);
      byType.set(m.type, list);
    }
    return { window, byType, invalid };
  }

  private toPoint(m: ParsedMeasure): MeasurePoint {
    return {
      timestamp: formatIsoWithOffset(m.epochMs, this.settings.timeZone),
      epochMs: m.epochMs,
      value: m.value,
      rawValue: m.rawValue,
      date: m.date,
      dateHour: m.dateHour,
    };
  }

  private toReading(m: ParsedMeasure | undefined): MeasureReading | null {
    if (!m) return null;
    return {
      ...this.toPoint(m),
      id: m.id,
      measureType: m.type,
      place: m.place,
      unit: MEASURE_UNITS[m.type],
    };
  }
}
