/** Subset of the backend JSON that the dashboard uses (see backend/src/models/types.ts). */

export interface ApiMeta {
  dataSource: 'mock' | 'mongodb';
  isMock: boolean;
  timeZone: string;
}

export interface ApiHealth {
  status: 'ok' | 'degraded';
  dataSource: 'mock' | 'mongodb';
  isMock: boolean;
  dataSourceStatus: 'ok' | 'unavailable';
  timeZone: string;
}

export interface ApiZone {
  place: number;
  id: string;
  name: string;
}

export interface ApiZonesResponse {
  zones: ApiZone[];
  meta: ApiMeta;
}

export interface ApiTimeWindow {
  from: string;
  to: string;
  fromMs: number;
  toMs: number;
}

export interface ApiPoint {
  epochMs: number;
  value: number;
  rawValue: string;
}

export interface ApiReading extends ApiPoint {
  unit: string | null;
}

export interface ApiLatestResponse {
  place: number;
  temperature: ApiReading | null;
  humidity: ApiReading | null;
  luminosity: ApiReading | null;
  meta: ApiMeta;
}

export interface ApiSeriesBlock {
  unit: string | null;
  count: number;
  points: ApiPoint[];
}

export interface ApiSeriesResponse {
  place: number;
  window: ApiTimeWindow | null;
  temperature: ApiSeriesBlock;
  humidity: ApiSeriesBlock;
  luminosity: ApiSeriesBlock;
  meta: ApiMeta;
}

export interface ApiActivation {
  id: string;
  startMs: number;
  endMs: number;
  runTimeSeconds: number;
  activationType: 'auto' | 'manual';
}

export interface ApiSprinklerStateResponse {
  place: number;
  state: 'ON' | 'OFF';
  isOn: boolean;
  onUntilMs: number | null;
  lastActivation: ApiActivation | null;
  meta: ApiMeta;
}

export interface ApiSprinklerHistoryResponse {
  place: number;
  window: ApiTimeWindow | null;
  stateAtWindowStart: 'ON' | 'OFF';
  activations: ApiActivation[];
  transitions: { epochMs: number; state: 'ON' | 'OFF' }[];
  meta: ApiMeta;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
