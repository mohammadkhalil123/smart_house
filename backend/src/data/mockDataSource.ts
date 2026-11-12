import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { RawMeasureDoc, RawSprinklerDoc } from '../models/types';
import { DataSourceError } from '../utils/errors';
import {
  DataSource,
  DaySlice,
  LatestMeasureQuery,
  MeasureQuery,
  SprinklerQuery,
} from './dataSource';

function normalizeId(id: unknown): string {
  if (typeof id === 'string') return id;
  if (id && typeof id === 'object' && typeof (id as { $oid?: unknown }).$oid === 'string') {
    return (id as { $oid: string }).$oid; // MongoDB extended JSON export
  }
  return String(id);
}

function inSlices(date: string, time: string, slices: readonly DaySlice[]): boolean {
  return slices.some(
    (s) =>
      s.date === date &&
      (s.fromTime === undefined || time >= s.fromTime) &&
      (s.toTime === undefined || time <= s.toTime),
  );
}

/** Serves Measures.json and Sprinkler.json from disk. Same filtering semantics as MongoDB. */
export class MockDataSource implements DataSource {
  readonly kind = 'mock' as const;
  readonly databaseName = null;
  readonly origin: string;

  private loaded?: Promise<{ measures: RawMeasureDoc[]; sprinkler: RawSprinklerDoc[] }>;

  constructor(private readonly dataDir: string) {
    this.origin = `mock JSON files in ${dataDir}`;
  }

  private load(): Promise<{ measures: RawMeasureDoc[]; sprinkler: RawSprinklerDoc[] }> {
    if (!this.loaded) {
      this.loaded = Promise.all([
        this.readCollection('Measures.json'),
        this.readCollection('Sprinkler.json'),
      ])
        .then(([measures, sprinkler]) => ({
          measures: measures.map((d) => ({ ...d, _id: normalizeId(d['_id']) }) as unknown as RawMeasureDoc),
          sprinkler: sprinkler.map((d) => ({ ...d, _id: normalizeId(d['_id']) }) as unknown as RawSprinklerDoc),
        }))
        .catch((err: unknown) => {
          this.loaded = undefined; // allow a retry after the file is fixed
          throw err;
        });
    }
    return this.loaded;
  }

  private async readCollection(fileName: string): Promise<Record<string, unknown>[]> {
    const file = path.join(this.dataDir, fileName);
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (err) {
      throw new DataSourceError(`Mock data file not found or unreadable: ${file}`, err);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new DataSourceError(`Mock data file is not valid JSON: ${file}`, err);
    }
    if (!Array.isArray(parsed)) {
      throw new DataSourceError(`Mock data file must contain a JSON array of documents: ${file}`);
    }
    return parsed.filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null);
  }

  async listMeasureDates(place: number): Promise<string[]> {
    const { measures } = await this.load();
    return [...new Set(measures.filter((d) => d.place === place).map((d) => d.date))];
  }

  async findMeasures(query: MeasureQuery): Promise<RawMeasureDoc[]> {
    const { measures } = await this.load();
    return measures.filter(
      (d) =>
        d.place === query.place &&
        (!query.types || query.types.includes(d.measure_type as never)) &&
        (!query.slices || inSlices(d.date, d.date_hour, query.slices)),
    );
  }

  async findLatestMeasures(query: LatestMeasureQuery): Promise<RawMeasureDoc[]> {
    const { measures } = await this.load();
    return measures
      .filter((d) => d.place === query.place && d.measure_type === query.type && d.date === query.date)
      .sort((a, b) => (a.date_hour < b.date_hour ? 1 : a.date_hour > b.date_hour ? -1 : 0))
      .slice(0, query.limit);
  }

  async listSprinklerDates(place: number): Promise<string[]> {
    const { sprinkler } = await this.load();
    return [...new Set(sprinkler.filter((d) => d.place === place).map((d) => d.date))];
  }

  async findSprinklerActivations(query: SprinklerQuery): Promise<RawSprinklerDoc[]> {
    const { sprinkler } = await this.load();
    return sprinkler.filter((d) => d.place === query.place && (!query.dates || query.dates.includes(d.date)));
  }

  async ping(): Promise<void> {
    await this.load();
  }

  async close(): Promise<void> {
    /* nothing to release */
  }
}
