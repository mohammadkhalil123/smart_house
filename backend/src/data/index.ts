import { AppConfig } from '../config/env';
import { ConfigError } from '../utils/errors';
import { DataSource } from './dataSource';
import { MockDataSource } from './mockDataSource';
import { MongoDataSource, MongoConnector } from './mongoDataSource';

export * from './dataSource';
export { MockDataSource } from './mockDataSource';
export { MongoDataSource } from './mongoDataSource';

/** Picks the data source from DATA_SOURCE. Nothing connects until the first query. */
export function createDataSource(
  config: Pick<AppConfig, 'dataSource' | 'mockDataDir' | 'mongodbUri' | 'mongodbDatabase'>,
  mongoConnector?: MongoConnector,
): DataSource {
  switch (config.dataSource) {
    case 'mock':
      return new MockDataSource(config.mockDataDir);
    case 'mongodb':
      if (!config.mongodbUri) throw new ConfigError('DATA_SOURCE=mongodb requires MONGODB_URI.');
      return new MongoDataSource({ uri: config.mongodbUri, database: config.mongodbDatabase }, mongoConnector);
    default:
      throw new ConfigError(`Unknown data source "${String(config.dataSource)}".`);
  }
}
