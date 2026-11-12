export type Accent = 'blue' | 'green' | 'orange';

/** Colour per zone is purely presentational, so it lives in the frontend. */
const ACCENTS: Record<number, Accent> = { 1: 'blue', 2: 'green', 3: 'orange' };

export interface ZoneInfo {
  place: number;
  id: string;
  name: string;
  accent: Accent;
}

export function accentFor(place: number): Accent {
  return ACCENTS[place] ?? 'blue';
}

/** One timestamped reading (t = epoch ms). */
export interface SensorPoint {
  t: number;
  v: number;
}

export interface SensorView {
  /** Latest reading, or null when the zone has none. */
  current: number | null;
  /** Unit label; empty when the stored unit is undefined (humidity). */
  unit: string;
  points: SensorPoint[];
}

/** Sprinkler state change: `v` = 1 (ON) or 0 (OFF) from timestamp `t` (ms) onward. */
export interface SprinklerEvent {
  t: number;
  v: 0 | 1;
}

export interface LastActivation {
  startMs: number;
  runTimeSeconds: number;
  type: 'auto' | 'manual';
}

export interface SprinklerView {
  on: boolean;
  /** End of the current ON period (ms), when ON. */
  onUntilMs: number | null;
  last: LastActivation | null;
  events: SprinklerEvent[];
}

/** Everything the dashboard shows for one zone. */
export interface ZoneView {
  place: number;
  timeZone: string;
  /** true when the backend serves demo records instead of the real database. */
  isMock: boolean;
  /** Chart time range (ms); null when the zone has no measurements at all. */
  windowStart: number | null;
  windowEnd: number | null;
  temperature: SensorView;
  humidity: SensorView;
  luminosity: SensorView;
  sprinkler: SprinklerView;
}
