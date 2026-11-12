import express, { Express, NextFunction, Request, Response } from 'express';
import { AppContext, createControllers } from './controllers';
import { createApiRouter } from './routes';
import { redactSecrets, toErrorResponse } from './utils/errors';

export function createApp(ctx: AppContext): Express {
  const app = express();
  app.disable('x-powered-by');

  // CORS: only the origins listed in CORS_ORIGINS (comma-separated) may call the API from a browser.
  const allowed = ctx.config.corsOrigins ?? [];
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Read-only API: always return fresh data.
  app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use('/api', createApiRouter(createControllers(ctx)));

  app.use('/api', (req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `No endpoint ${req.method} ${req.originalUrl}.` } });
  });

  // Express recognises error handlers by their four parameters.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const { status, body } = toErrorResponse(err);
    if (status >= 500) {
      const text = err instanceof Error ? err.message : String(err);
      console.error(`[error] ${redactSecrets(text)}`);
    }
    res.status(status).json(body);
  });

  return app;
}
