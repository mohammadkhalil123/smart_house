import 'dotenv/config';
import { createApp } from './app';
import { loadConfig } from './config/env';
import { createContext } from './context';
import { ConfigError, redactSecrets } from './utils/errors';

function main(): void {
  const config = loadConfig();
  const ctx = createContext(config);
  const app = createApp(ctx);

  const server = app.listen(config.port, config.host, () => {
    console.log(`Smart Greenhouse API listening on http://${config.host}:${config.port}/api`);
    if (config.dataSource === 'mock') {
      console.log('DATA SOURCE: MOCK - demo records from backend/data/*.json, NOT live sensor measurements.');
      if (config.mockNowMs !== undefined) console.log('MOCK_NOW is set: the sprinkler state uses a fixed demo clock.');
    } else {
      console.log(`DATA SOURCE: ${ctx.dataSource.origin} (read-only).`);
    }
    console.log(`Measurement time zone: ${config.timeZone}`);
  });

  const shutdown = (): void => {
    server.close(() => {
      void ctx.dataSource.close().finally(() => process.exit(0));
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

try {
  main();
} catch (err) {
  const text = err instanceof Error ? err.message : String(err);
  console.error(err instanceof ConfigError ? `Configuration error: ${text}` : `Startup failed: ${redactSecrets(text)}`);
  process.exit(1);
}
