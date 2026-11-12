/** Raw documents exactly as stored in MongoDB (or in the mock JSON files). */

export type MeasureType = 'Tmp' | 'Hum' | 'Lum';
export const MEASURE_TYPES: readonly MeasureType[] = ['Tmp', 'Hum', 'Lum'];

export type ActivationType = 'auto' | 'manual';
export const ACTIVATION_TYPES: readonly ActivationType[] = ['auto', 'manual'];

export interface RawMeasureDoc {
  _id: string;
  measure_type: string;
  /** Stored as a string, e.g. "251". */
  value: string;
  place: number;
  /** DD-MM-YYYY */
  date: string;
  /** HH:mm:ss */
  date_hour: string;
}

export interface RawSprinklerDoc {
  _id: string;
  /** Python-style duration, e.g. "0:00:14.015384" (may carry trailing whitespace). */
  run_time: string;
  place: number;
  date: string;
  date_hour: string;
  activation_type: string;
}

/* ------------------------------------------------------------------ */
/* API response types (identical in mock and MongoDB mode)            */
/* ------------------------------------------------------------------ */

export type DataSourceKind = 'mock' | 'mongodb';

export interface ResponseMeta {
  dataSource: DataSourceKind;
  /** true when the records come from the demo JSON files, not from sensors. */
  isMock: boolean;
  timeZone: string;
}

export interface TimeWindow {
  /** ISO 8601 with the offset of the measurement time zone. */
  from: string;
  to: string;
  fromMs: number;
  toMs: number;
}

/** One measurement of one type in one zone (used by history and series). */
export interface MeasurePoint {
  timestamp: string;
  epochMs: number;
  /** Numeric value converted from the stored string. */
  value: number;
  /** The stored string, unchanged. */
  rawValue: string;
  /** Original DD-MM-YYYY string. */
  date: string;
  /** Original HH:mm:ss string. */
  dateHour: string;
}

export interface MeasureReading extends MeasurePoint {
  id: string;
  measureType: MeasureType;
  place: number;
  /** null when the unit is not defined (humidity is kept as the raw stored number). */
  unit: string | null;
}

export interface LatestMeasuresResponse {
  place: number;
  temperature: MeasureReading | null;
  humidity: MeasureReading | null;
  luminosity: MeasureReading | null;
  invalidRecords: number;
  meta: ResponseMeta;
}

export interface MeasureHistoryResponse {
  place: number;
  type: MeasureType;
  unit: string | null;
  window: TimeWindow | null;
  count: number;
  points: MeasurePoint[];
  invalidRecords: number;
  meta: ResponseMeta;
}

export interface MeasureSeriesBlock {
  type: MeasureType;
  unit: string | null;
  count: number;
  points: MeasurePoint[];
}

export interface MeasureSeriesResponse {
  place: number;
  window: TimeWindow | null;
  temperature: MeasureSeriesBlock;
  humidity: MeasureSeriesBlock;
  luminosity: MeasureSeriesBlock;
  invalidRecords: number;
  meta: ResponseMeta;
}

export interface SprinklerActivation {
  id: string;
  place: number;
  date: string;
  dateHour: string;
  /** The stored run_time string, unchanged. */
  runTime: string;
  runTimeMs: number;
  runTimeSeconds: number;
  activationType: ActivationType;
  startTimestamp: string;
  startMs: number;
  endTimestamp: string;
  endMs: number;
}

/** A continuous ON period: overlapping activations are merged into one interval. */
export interface SprinklerInterval {
  start: string;
  startMs: number;
  end: string;
  endMs: number;
  durationMs: number;
  activationIds: string[];
  activationTypes: ActivationType[];
}

export interface SprinklerTransition {
  timestamp: string;
  epochMs: number;
  state: 'ON' | 'OFF';
}

export type EvaluatedAtSource = 'system-clock' | 'query' | 'mock-now';

export interface SprinklerStateResponse {
  place: number;
  state: 'ON' | 'OFF';
  isOn: boolean;
  evaluatedAt: string;
  evaluatedAtMs: number;
  evaluatedAtSource: EvaluatedAtSource;
  activeActivations: SprinklerActivation[];
  /** End of the current ON period (all overlapping activations considered), or null when OFF. */
  onUntil: string | null;
  onUntilMs: number | null;
  /** Most recent activation that started at or before evaluatedAt. */
  lastActivation: SprinklerActivation | null;
  invalidRecords: number;
  meta: ResponseMeta;
}

export interface SprinklerHistoryResponse {
  place: number;
  window: TimeWindow | null;
  stateAtWindowStart: 'ON' | 'OFF';
  count: number;
  activations: SprinklerActivation[];
  intervals: SprinklerInterval[];
  transitions: SprinklerTransition[];
  invalidRecords: number;
  meta: ResponseMeta;
}

export interface ZoneInfo {
  place: number;
  id: string;
  name: string;
}

export interface ZonesResponse {
  zones: ZoneInfo[];
  meta: ResponseMeta;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  dataSource: DataSourceKind;
  isMock: boolean;
  dataSourceStatus: 'ok' | 'unavailable';
  /** Database name only, never the connection string. */
  database: string | null;
  timeZone: string;
  serverTime: string;
}
