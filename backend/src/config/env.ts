import * as path from 'node:path';
import { DataSourceKind } from '../models/types';
import { ConfigError } from '../utils/errors';
import { assertValidTimeZone, parseInstant } from '../utils/dateTime';

export interface AppConfig {
  port: number;
  host: string;
  dataSource: DataSourceKind;
  mongodbUri?: string;
  mongodbDatabase: string;
  timeZone: string;
  mockDataDir: string;
  /** Mock mode only: fixed "now" (epoch ms) used for the current sprinkler state. */
  mockNowMs?: number;
  /** Browser origins allowed by CORS (empty = none; the Angular dev proxy needs none). */
  corsOrigins?: string[];
  /** Zones (the `place` field) exposed by the API. */
  zones: readonly number[];
  /** Window returned when the client gives no range, ending at the newest record. */
  defaultWindowMinutes: number;
  /** Largest range a single request may cover. */
  maxRangeDays: number;
}

const PLACEHOLDER_DATABASE = 'RpiXX';
const DEFAULT_MOCK_DIR = path.resolve(__dirname, '..', '..', 'data');

type Env = Record<string, string | undefined>;

function clean(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

/**
 * Builds the configuration from environment variables (pure: pass any object in tests).
 * Throws ConfigError with an actionable message when something is wrong.
 */
export function loadConfig(env: Env = process.env): AppConfig {
  const portText = clean(env['PORT']) ?? '3000';
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`PORT must be an integer between 1 and 65535 (got "${portText}").`);
  }

  const host = clean(env['HOST']) ?? '127.0.0.1';

  const sourceText = (clean(env['DATA_SOURCE']) ?? 'mock').toLowerCase();
  if (sourceText !== 'mock' && sourceText !== 'mongodb') {
    throw new ConfigError(`DATA_SOURCE must be "mock" or "mongodb" (got "${sourceText}").`);
  }
  const dataSource: DataSourceKind = sourceText;

  const timeZone = clean(env['MEASUREMENT_TIME_ZONE']) ?? 'Europe/Paris';
  try {
    assertValidTimeZone(timeZone);
  } catch {
    throw new ConfigError(`MEASUREMENT_TIME_ZONE "${timeZone}" is not a valid IANA time zone (e.g. Europe/Paris).`);
  }

  const mongodbUri = clean(env['MONGODB_URI']);
  const mongodbDatabase = clean(env['MONGODB_DATABASE']) ?? PLACEHOLDER_DATABASE;

  if (dataSource === 'mongodb') {
    if (!mongodbUri) {
      throw new ConfigError('DATA_SOURCE=mongodb requires MONGODB_URI (set it in backend/.env).');
    }
    if (mongodbDatabase === PLACEHOLDER_DATABASE) {
      throw new ConfigError(
        `MONGODB_DATABASE is still the placeholder "${PLACEHOLDER_DATABASE}". Set the real database name (e.g. Rpi07).`,
      );
    }
  }

  let mockNowMs: number | undefined;
  const mockNowText = clean(env['MOCK_NOW']);
  if (mockNowText && dataSource === 'mock') {
    const parsed = parseInstant(mockNowText, timeZone);
    if (parsed === null) {
      throw new ConfigError(`MOCK_NOW must be an ISO 8601 date-time such as 2026-11-10T14:45:55 (got "${mockNowText}").`);
    }
    mockNowMs = parsed;
  }

  return {
    port,
    host,
    dataSource,
    mongodbUri,
    mongodbDatabase,
    timeZone,
    mockDataDir: clean(env['MOCK_DATA_DIR']) ? path.resolve(env['MOCK_DATA_DIR'] as string) : DEFAULT_MOCK_DIR,
    mockNowMs,
    corsOrigins: (clean(env['CORS_ORIGINS']) ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    zones: [1, 2, 3],
    defaultWindowMinutes: 120,
    maxRangeDays: 7,
  };
}
