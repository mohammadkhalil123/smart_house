import { DataSource } from '../data/dataSource';
import {
  ACTIVATION_TYPES,
  EvaluatedAtSource,
  RawSprinklerDoc,
  SprinklerActivation,
  SprinklerHistoryResponse,
  SprinklerStateResponse,
} from '../models/types';
import {
  dateToDayNumber,
  dayNumberToDate,
  epochToDayNumber,
  formatDateString,
  formatIsoWithOffset,
  localDaysBetween,
  parseDateString,
  parseMeasurementTimestamp,
} from '../utils/dateTime';
import { parseRunTimeMs } from '../utils/runtime';
import { buildTransitions, intervalAt, mergeActivations } from './sprinklerIntervals';
import { ServiceSettings } from './measureService';
import { RangeQuery, resolveWindow, toTimeWindow } from './window';

const DAY_MS = 86_400_000;
/** How many distinct days to walk back looking for the most recent activation. */
const MAX_LOOKBACK_DAYS = 60;

/** Validates raw documents and computes each activation's end time. Other zones are dropped. */
export function parseSprinklerDocs(
  docs: readonly RawSprinklerDoc[],
  place: number,
  timeZone: string,
): { activations: SprinklerActivation[]; invalid: number } {
  const activations: SprinklerActivation[] = [];
  let invalid = 0;
  for (const doc of docs) {
    if (doc.place !== place) continue;
    const startMs = parseMeasurementTimestamp(doc.date, doc.date_hour, timeZone);
    const runTimeMs = parseRunTimeMs(doc.run_time);
    const type = ACTIVATION_TYPES.find((t) => t === String(doc.activation_type).trim());
    if (startMs === null || runTimeMs === null || !type) {
      invalid++;
      continue;
    }
    const endMs = startMs + runTimeMs;
    activations.push({
      id: String(doc._id),
      place,
      date: doc.date,
      dateHour: doc.date_hour,
      runTime: doc.run_time,
      runTimeMs,
      runTimeSeconds: runTimeMs / 1000,
      activationType: type,
      startTimestamp: formatIsoWithOffset(startMs, timeZone),
      startMs,
      endTimestamp: formatIsoWithOffset(endMs, timeZone),
      endMs,
    });
  }
  return { activations, invalid };
}

const byStart = (a: SprinklerActivation, b: SprinklerActivation): number =>
  a.startMs - b.startMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export class SprinklerService {
  constructor(
    private readonly source: DataSource,
    private readonly settings: ServiceSettings,
    /** Current instant; replaced by a fixed value in mock mode (MOCK_NOW) and in tests. */
    private readonly now: () => number = Date.now,
    private readonly nowSource: EvaluatedAtSource = 'system-clock',
  ) {}

  /** Is the sprinkler ON at `atMs` (default: now)? Evaluated from the activation intervals. */
  async state(place: number, atMs?: number): Promise<SprinklerStateResponse> {
    const tz = this.settings.timeZone;
    const evaluatedAtMs = atMs ?? this.now();
    const source: EvaluatedAtSource = atMs !== undefined ? 'query' : this.nowSource;

    // An activation can only still be running if it started recently: look at today and yesterday.
    const today = epochToDayNumber(evaluatedAtMs, tz);
    const dates = [today - 1, today].map((n) => formatDateString(dayNumberToDate(n)));
    const docs = await this.source.findSprinklerActivations({ place, dates });
    const { activations, invalid } = parseSprinklerDocs(docs, place, tz);

    const started = activations.filter((a) => a.startMs <= evaluatedAtMs);
    const intervals = mergeActivations(started, tz);
    const current = intervalAt(intervals, evaluatedAtMs);
    const active = started.filter((a) => evaluatedAtMs < a.endMs).sort(byStart);

    const last = started.length > 0 ? started.slice().sort(byStart).pop()! : (await this.findLastActivation(place, evaluatedAtMs)).activation;

    return {
      place,
      state: current ? 'ON' : 'OFF',
      isOn: current !== undefined,
      evaluatedAt: formatIsoWithOffset(evaluatedAtMs, tz),
      evaluatedAtMs,
      evaluatedAtSource: source,
      activeActivations: active,
      onUntil: current ? current.end : null,
      onUntilMs: current ? current.endMs : null,
      lastActivation: last ?? null,
      invalidRecords: invalid,
      meta: this.settings.meta,
    };
  }

  async history(place: number, range: RangeQuery): Promise<SprinklerHistoryResponse> {
    const tz = this.settings.timeZone;
    let invalid = 0;
    let anchor: number | null = null;

    if (range.fromMs === undefined && range.toMs === undefined) {
      const latest = await this.findLastActivation(place);
      invalid += latest.invalid;
      anchor = latest.activation ? latest.activation.endMs : null;
    }

    const window = resolveWindow(range, anchor, this.settings.defaultWindowMinutes);
    if (!window) {
      return {
        place,
        window: null,
        stateAtWindowStart: 'OFF',
        count: 0,
        activations: [],
        intervals: [],
        transitions: [],
        invalidRecords: invalid,
        meta: this.settings.meta,
      };
    }

    // Also read the previous day so an activation that began before the window is still seen.
    const dates = localDaysBetween(window.fromMs - DAY_MS, window.toMs, tz);
    const docs = await this.source.findSprinklerActivations({ place, dates });
    const { activations: all, invalid: bad } = parseSprinklerDocs(docs, place, tz);
    invalid += bad;

    const allIntervals = mergeActivations(all, tz);
    const intervals = allIntervals.filter((i) => i.endMs > window.fromMs && i.startMs <= window.toMs);
    const activations = all
      .filter((a) => (a.endMs > window.fromMs || a.startMs >= window.fromMs) && a.startMs <= window.toMs)
      .sort(byStart);

    return {
      place,
      window: toTimeWindow(window, tz),
      stateAtWindowStart: intervalAt(allIntervals, window.fromMs) ? 'ON' : 'OFF',
      count: activations.length,
      activations,
      intervals,
      transitions: buildTransitions(intervals, tz, window.fromMs, window.toMs),
      invalidRecords: invalid,
      meta: this.settings.meta,
    };
  }

  /** Most recent activation that started at or before `atMs` (any time when omitted). */
  private async findLastActivation(
    place: number,
    atMs = Number.POSITIVE_INFINITY,
  ): Promise<{ activation: SprinklerActivation | null; invalid: number }> {
    const tz = this.settings.timeZone;
    const lastDay = Number.isFinite(atMs) ? epochToDayNumber(atMs, tz) : Number.POSITIVE_INFINITY;
    let invalid = 0;

    const days = (await this.source.listSprinklerDates(place))
      .map((raw) => ({ raw, parsed: parseDateString(raw) }))
      .filter((d): d is { raw: string; parsed: NonNullable<typeof d.parsed> } => d.parsed !== null)
      .filter((d) => dateToDayNumber(d.parsed) <= lastDay)
      .sort((a, b) => dateToDayNumber(b.parsed) - dateToDayNumber(a.parsed))
      .slice(0, MAX_LOOKBACK_DAYS);

    for (const day of days) {
      const docs = await this.source.findSprinklerActivations({ place, dates: [day.raw] });
      const { activations, invalid: bad } = parseSprinklerDocs(docs, place, tz);
      invalid += bad;
      const best = activations.filter((a) => a.startMs <= atMs).sort(byStart).pop();
      if (best) return { activation: best, invalid };
    }
    return { activation: null, invalid };
  }
}
