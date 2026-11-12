import { RawMeasureDoc, RawSprinklerDoc } from '../models/types';
import { DataSourceError, redactSecrets } from '../utils/errors';
import {
  DataSource,
  DaySlice,
  LatestMeasureQuery,
  MeasureQuery,
  SprinklerQuery,
} from './dataSource';

/** The few driver calls this app needs. The real driver's Db/Collection satisfy it. */
export interface MinimalCursor {
  sort(spec: Record<string, 1 | -1>): MinimalCursor;
  limit(n: number): MinimalCursor;
  toArray(): Promise<unknown[]>;
}

export interface MinimalCollection {
  find(filter: Record<string, unknown>): MinimalCursor;
  distinct(key: string, filter: Record<string, unknown>): Promise<unknown[]>;
}

export interface MinimalDb {
  collection(name: string): MinimalCollection;
  command(command: Record<string, unknown>): Promise<unknown>;
}

export interface MongoConnection {
  db: MinimalDb;
  close(): Promise<void>;
}

export interface MongoOptions {
  uri: string;
  database: string;
}

export type MongoConnector = (options: MongoOptions) => Promise<MongoConnection>;

/** Connects with the official driver. Loaded lazily so mock mode never needs it. */
export const connectWithDriver: MongoConnector = async ({ uri, database }) => {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, appName: 'smart-greenhouse-backend' });
  await client.connect();
  return {
    db: client.db(database) as unknown as MinimalDb,
    close: () => client.close(),
  };
};

const MEASURES = 'Measures';
const SPRINKLER = 'Sprinkler';

function toId(doc: Record<string, unknown>): string {
  return String(doc['_id']);
}

function sliceFilter(slice: DaySlice): Record<string, unknown> {
  const filter: Record<string, unknown> = { date: slice.date };
  if (slice.fromTime !== undefined || slice.toTime !== undefined) {
    const range: Record<string, string> = {};
    if (slice.fromTime !== undefined) range['$gte'] = slice.fromTime;
    if (slice.toTime !== undefined) range['$lte'] = slice.toTime;
    filter['date_hour'] = range;
  }
  return filter;
}

/**
 * Read-only access to the Raspberry Pi database. Only `find`, `distinct` and a `ping`
 * command are issued: nothing is written, no index or collection is created.
 */
export class MongoDataSource implements DataSource {
  readonly kind = 'mongodb' as const;
  readonly origin: string;
  readonly databaseName: string;

  private connection?: Promise<MongoConnection>;

  constructor(
    private readonly options: MongoOptions,
    private readonly connector: MongoConnector = connectWithDriver,
  ) {
    this.databaseName = options.database;
    this.origin = `MongoDB database "${options.database}"`;
  }

  private connect(): Promise<MongoConnection> {
    if (!this.connection) {
      this.connection = this.connector(this.options).catch((err: unknown) => {
        this.connection = undefined; // retry on the next request
        throw new DataSourceError(
          `Cannot connect to ${this.origin}: ${redactSecrets(err instanceof Error ? err.message : String(err))}`,
          err,
        );
      });
    }
    return this.connection;
  }

  private async run<T>(action: (db: MinimalDb) => Promise<T>): Promise<T> {
    const { db } = await this.connect();
    try {
      return await action(db);
    } catch (err) {
      if (err instanceof DataSourceError) throw err;
      throw new DataSourceError(
        `MongoDB query failed: ${redactSecrets(err instanceof Error ? err.message : String(err))}`,
        err,
      );
    }
  }

  async listMeasureDates(place: number): Promise<string[]> {
    const dates = await this.run((db) => db.collection(MEASURES).distinct('date', { place }));
    return dates.filter((d): d is string => typeof d === 'string');
  }

  async findMeasures(query: MeasureQuery): Promise<RawMeasureDoc[]> {
    if (query.slices && query.slices.length === 0) return [];
    const filter: Record<string, unknown> = { place: query.place };
    if (query.types) filter['measure_type'] = { $in: [...query.types] };
    if (query.slices) filter['$or'] = query.slices.map(sliceFilter);
    const docs = await this.run((db) => db.collection(MEASURES).find(filter).toArray());
    return docs.map((d) => ({ ...(d as object), _id: toId(d as Record<string, unknown>) }) as RawMeasureDoc);
  }

  async findLatestMeasures(query: LatestMeasureQuery): Promise<RawMeasureDoc[]> {
    const filter = { place: query.place, date: query.date, measure_type: query.type };
    const docs = await this.run((db) =>
      db.collection(MEASURES).find(filter).sort({ date_hour: -1 }).limit(query.limit).toArray(),
    );
    return docs.map((d) => ({ ...(d as object), _id: toId(d as Record<string, unknown>) }) as RawMeasureDoc);
  }

  async listSprinklerDates(place: number): Promise<string[]> {
    const dates = await this.run((db) => db.collection(SPRINKLER).distinct('date', { place }));
    return dates.filter((d): d is string => typeof d === 'string');
  }

  async findSprinklerActivations(query: SprinklerQuery): Promise<RawSprinklerDoc[]> {
    if (query.dates && query.dates.length === 0) return [];
    const filter: Record<string, unknown> = { place: query.place };
    if (query.dates) filter['date'] = { $in: [...query.dates] };
    const docs = await this.run((db) => db.collection(SPRINKLER).find(filter).toArray());
    return docs.map((d) => ({ ...(d as object), _id: toId(d as Record<string, unknown>) }) as RawSprinklerDoc);
  }

  async ping(): Promise<void> {
    await this.run((db) => db.command({ ping: 1 }));
  }

  async close(): Promise<void> {
    if (!this.connection) return;
    const pending = this.connection;
    this.connection = undefined;
    try {
      await (await pending).close();
    } catch {
      /* already closed or never connected */
    }
  }
}
