import { MeasureType, RawMeasureDoc, RawSprinklerDoc } from '../models/types';

/**
 * A slice of one local day. `fromTime` / `toTime` are inclusive "HH:mm:ss" bounds; leaving
 * them out means "from the start / until the end of that day". Fixed-width zero-padded
 * times compare correctly as strings *within one day*, which is what lets MongoDB narrow
 * the query without reading a whole day. (Dates themselves are never compared as strings.)
 */
export interface DaySlice {
  date: string;
  fromTime?: string;
  toTime?: string;
}

export interface MeasureQuery {
  place: number;
  types?: readonly MeasureType[];
  /** Undefined = no date restriction. */
  slices?: readonly DaySlice[];
}

export interface LatestMeasureQuery {
  place: number;
  /** One DD-MM-YYYY day. */
  date: string;
  type: MeasureType;
  /** Maximum number of documents to return, newest `date_hour` first. */
  limit: number;
}

export interface SprinklerQuery {
  place: number;
  /** DD-MM-YYYY days; undefined = no date restriction. */
  dates?: readonly string[];
}

/**
 * Read-only access to the two collections. Implementations only filter by exact fields;
 * all date parsing, sorting and interval logic lives in the services so that mock and
 * MongoDB modes behave identically.
 */
export interface DataSource {
  readonly kind: 'mock' | 'mongodb';
  /** Human-readable origin of the data, e.g. the mock directory or the database name. */
  readonly origin: string;
  /** Database name (MongoDB mode) or null. */
  readonly databaseName: string | null;

  /** Distinct `date` strings that have measurements for the zone (unsorted). */
  listMeasureDates(place: number): Promise<string[]>;
  findMeasures(query: MeasureQuery): Promise<RawMeasureDoc[]>;
  /** Newest-first (by `date_hour` string within the single day) candidates for the latest value. */
  findLatestMeasures(query: LatestMeasureQuery): Promise<RawMeasureDoc[]>;

  listSprinklerDates(place: number): Promise<string[]>;
  findSprinklerActivations(query: SprinklerQuery): Promise<RawSprinklerDoc[]>;

  /** Resolves when the source is reachable, rejects otherwise. */
  ping(): Promise<void>;
  close(): Promise<void>;
}
