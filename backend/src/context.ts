import { AppConfig } from './config/env';
import { AppContext } from './controllers';
import { createDataSource, DataSource } from './data';
import { MeasureService, ServiceSettings } from './services/measureService';
import { SprinklerService } from './services/sprinklerService';

/** Wires configuration, data source and services together. */
export function createContext(config: AppConfig, dataSource: DataSource = createDataSource(config)): AppContext {
  const settings: ServiceSettings = {
    timeZone: config.timeZone,
    defaultWindowMinutes: config.defaultWindowMinutes,
    meta: { dataSource: dataSource.kind, isMock: dataSource.kind === 'mock', timeZone: config.timeZone },
  };
  const useMockClock = dataSource.kind === 'mock' && config.mockNowMs !== undefined;
  const now = useMockClock ? () => config.mockNowMs as number : Date.now;
  return {
    config,
    dataSource,
    measures: new MeasureService(dataSource, settings),
    sprinkler: new SprinklerService(dataSource, settings, now, useMockClock ? 'mock-now' : 'system-clock'),
  };
}
