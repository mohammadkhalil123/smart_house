import { AppConfig } from '../config/env';
import { DataSource } from '../data/dataSource';
import {
  HealthResponse,
  LatestMeasuresResponse,
  MeasureHistoryResponse,
  MeasureSeriesResponse,
  ResponseMeta,
  SprinklerHistoryResponse,
  SprinklerStateResponse,
  ZonesResponse,
} from '../models/types';
import { MeasureService } from '../services/measureService';
import { SprinklerService } from '../services/sprinklerService';
import { formatIsoWithOffset } from '../utils/dateTime';
import { parseAt, parseMeasureType, parsePlace, parseRange, QueryLimits, RawQuery } from '../utils/query';

export interface AppContext {
  config: AppConfig;
  dataSource: DataSource;
  measures: MeasureService;
  sprinkler: SprinklerService;
}

/**
 * Framework-independent request handlers: they take the (untrusted) query parameters,
 * validate them and return the JSON body. Express wiring lives in routes/.
 * Validation problems throw ApiError(400).
 */
export function createControllers(ctx: AppContext) {
  const { config } = ctx;
  const limits: QueryLimits = { zones: config.zones, timeZone: config.timeZone, maxRangeDays: config.maxRangeDays };
  const meta: ResponseMeta = {
    dataSource: ctx.dataSource.kind,
    isMock: ctx.dataSource.kind === 'mock',
    timeZone: config.timeZone,
  };

  return {
    async health(): Promise<HealthResponse> {
      let reachable = true;
      try {
        await ctx.dataSource.ping();
      } catch {
        reachable = false;
      }
      return {
        status: reachable ? 'ok' : 'degraded',
        dataSource: meta.dataSource,
        isMock: meta.isMock,
        dataSourceStatus: reachable ? 'ok' : 'unavailable',
        database: ctx.dataSource.databaseName,
        timeZone: config.timeZone,
        serverTime: formatIsoWithOffset(Date.now(), config.timeZone),
      };
    },

    zones(): ZonesResponse {
      return {
        zones: config.zones.map((place) => ({ place, id: String(place), name: `Zone ${place}` })),
        meta,
      };
    },

    async latestMeasures(query: RawQuery): Promise<LatestMeasuresResponse> {
      return ctx.measures.latest(parsePlace(query, limits));
    },

    async measureHistory(query: RawQuery): Promise<MeasureHistoryResponse> {
      const place = parsePlace(query, limits);
      const type = parseMeasureType(query);
      return ctx.measures.history(place, type, parseRange(query, limits));
    },

    async measureSeries(query: RawQuery): Promise<MeasureSeriesResponse> {
      const place = parsePlace(query, limits);
      return ctx.measures.series(place, parseRange(query, limits));
    },

    async sprinklerState(query: RawQuery): Promise<SprinklerStateResponse> {
      const place = parsePlace(query, limits);
      return ctx.sprinkler.state(place, parseAt(query, limits));
    },

    async sprinklerHistory(query: RawQuery): Promise<SprinklerHistoryResponse> {
      const place = parsePlace(query, limits);
      return ctx.sprinkler.history(place, parseRange(query, limits));
    },
  };
}

export type Controllers = ReturnType<typeof createControllers>;
