import { DataSource, DaySlice, LatestMeasureQuery, MeasureQuery, SprinklerQuery } from '../data/dataSource';
import { MinimalCollection, MinimalCursor, MinimalDb } from '../data/mongoDataSource';
import { RawMeasureDoc, RawSprinklerDoc, ResponseMeta } from '../models/types';
import { ServiceSettings } from '../services/measureService';
import { parseMeasurementTimestamp } from '../utils/dateTime';

export const TZ = 'Europe/Paris';

export const settings: ServiceSettings = {
  timeZone: TZ,
  defaultWindowMinutes: 120,
  meta: { dataSource: 'mock', isMock: true, timeZone: TZ } as ResponseMeta,
};

let counter = 0;

export function m(
  place: number,
  type: string,
  value: string,
  date: string,
  time: string,
  id = `m${String(++counter).padStart(6, '0')}`,
): RawMeasureDoc {
  return { _id: id, measure_type: type, value, place, date, date_hour: time };
}

export function s(
  place: number,
  date: string,
  time: string,
  runTime: string,
  activationType = 'auto',
  id = `s${String(++counter).padStart(6, '0')}`,
): RawSprinklerDoc {
  return { _id: id, run_time: runTime, place, date, date_hour: time, activation_type: activationType };
}

/** Epoch ms of a stored date/time in the test time zone. */
export function at(date: string, time: string): number {
  const ms = parseMeasurementTimestamp(date, time, TZ);
  if (ms === null) throw new Error(`bad test timestamp ${date} ${time}`);
  return ms;
}

function inSlices(d: { date: string; date_hour: string }, slices?: readonly DaySlice[]): boolean {
  if (!slices) return true;
  return slices.some(
    (x) =>
      x.date === d.date &&
      (x.fromTime === undefined || d.date_hour >= x.fromTime) &&
      (x.toTime === undefined || d.date_hour <= x.toTime),
  );
}

/** Plain in-memory data source over arrays (independent of the JSON-file implementation). */
export class ArraySource implements DataSource {
  readonly kind: 'mock' | 'mongodb';
  readonly origin = 'test arrays';
  readonly databaseName = null;

  constructor(
    private readonly measures: RawMeasureDoc[],
    private readonly sprinkler: RawSprinklerDoc[],
    kind: 'mock' | 'mongodb' = 'mock',
  ) {
    this.kind = kind;
  }

  async listMeasureDates(place: number): Promise<string[]> {
    return [...new Set(this.measures.filter((d) => d.place === place).map((d) => d.date))];
  }
  async findMeasures(q: MeasureQuery): Promise<RawMeasureDoc[]> {
    // Shuffle-ish: return in reverse so services cannot rely on input order.
    return this.measures
      .filter((d) => d.place === q.place && (!q.types || q.types.includes(d.measure_type as never)) && inSlices(d, q.slices))
      .reverse();
  }
  async findLatestMeasures(q: LatestMeasureQuery): Promise<RawMeasureDoc[]> {
    return this.measures
      .filter((d) => d.place === q.place && d.measure_type === q.type && d.date === q.date)
      .sort((a, b) => (a.date_hour < b.date_hour ? 1 : -1))
      .slice(0, q.limit);
  }
  async listSprinklerDates(place: number): Promise<string[]> {
    return [...new Set(this.sprinkler.filter((d) => d.place === place).map((d) => d.date))];
  }
  async findSprinklerActivations(q: SprinklerQuery): Promise<RawSprinklerDoc[]> {
    return this.sprinkler.filter((d) => d.place === q.place && (!q.dates || q.dates.includes(d.date))).reverse();
  }
  async ping(): Promise<void> {}
  async close(): Promise<void> {}
}

/** A source that ignores the requested zone, to prove services never mix zones themselves. */
export class LeakyZoneSource extends ArraySource {
  constructor(
    private readonly leakMeasures: RawMeasureDoc[],
    private readonly leakSprinkler: RawSprinklerDoc[],
  ) {
    super(leakMeasures, leakSprinkler);
  }
  override async findMeasures(): Promise<RawMeasureDoc[]> {
    return [...this.leakMeasures];
  }
  override async findLatestMeasures(q: LatestMeasureQuery): Promise<RawMeasureDoc[]> {
    return this.leakMeasures
      .filter((d) => d.measure_type === q.type && d.date === q.date)
      .sort((a, b) => (a.date_hour < b.date_hour ? 1 : -1))
      .slice(0, q.limit);
  }
  override async findSprinklerActivations(): Promise<RawSprinklerDoc[]> {
    return [...this.leakSprinkler];
  }
}

/* ------------------------- fake MongoDB (driver shape) ------------------------- */

type Doc = Record<string, unknown>;

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return (cond as Doc[]).some((f) => matches(doc, f));
    const value = doc[key];
    if (cond !== null && typeof cond === 'object') {
      const c = cond as Doc;
      if ('$in' in c) return (c['$in'] as unknown[]).includes(value);
      if ('$gte' in c && !((value as string) >= (c['$gte'] as string))) return false;
      if ('$lte' in c && !((value as string) <= (c['$lte'] as string))) return false;
      return true;
    }
    return value === cond;
  });
}

export interface RecordedCall {
  collection: string;
  op: 'find' | 'distinct';
  filter: Doc;
  sort?: Record<string, 1 | -1>;
  limit?: number;
}

export class FakeMongoDb implements MinimalDb {
  readonly calls: RecordedCall[] = [];
  constructor(private readonly data: Record<string, Doc[]>) {}

  collection(name: string): MinimalCollection {
    const docs = this.data[name] ?? [];
    const calls = this.calls;
    return {
      find(filter: Doc): MinimalCursor {
        const call: RecordedCall = { collection: name, op: 'find', filter };
        calls.push(call);
        let sortSpec: Record<string, 1 | -1> | undefined;
        let max: number | undefined;
        const cursor: MinimalCursor = {
          sort(spec) {
            sortSpec = spec;
            call.sort = spec;
            return cursor;
          },
          limit(n) {
            max = n;
            call.limit = n;
            return cursor;
          },
          async toArray() {
            let out = docs.filter((d) => matches(d, filter)).map((d) => ({ ...d }));
            if (sortSpec) {
              const [[field, dir]] = Object.entries(sortSpec);
              out = out.sort((a, b) => ((a[field] as string) < (b[field] as string) ? -dir : (a[field] as string) > (b[field] as string) ? dir : 0));
            }
            return max === undefined ? out : out.slice(0, max);
          },
        };
        return cursor;
      },
      async distinct(key: string, filter: Doc) {
        calls.push({ collection: name, op: 'distinct', filter });
        return [...new Set(docs.filter((d) => matches(d, filter)).map((d) => d[key]))];
      },
    };
  }

  async command(): Promise<unknown> {
    return { ok: 1 };
  }
}

/** Wraps documents so `_id` behaves like a driver ObjectId (object with toString). */
export function withObjectIds<T extends { _id: string }>(docs: T[]): Doc[] {
  return docs.map((d) => ({ ...d, _id: { toString: () => d._id } }));
}
