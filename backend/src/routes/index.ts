import { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { Controllers } from '../controllers';

/** Express 4 does not catch rejected promises: forward them to the error handler. */
function handle(fn: (req: Request) => unknown | Promise<unknown>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve()
      .then(() => fn(req))
      .then((body) => {
        res.json(body);
      })
      .catch(next);
  };
}

export function createApiRouter(c: Controllers): Router {
  const router = Router();
  router.get('/health', handle(() => c.health()));
  router.get('/zones', handle(() => c.zones()));
  router.get('/measures/latest', handle((req) => c.latestMeasures(req.query)));
  router.get('/measures/history', handle((req) => c.measureHistory(req.query)));
  router.get('/measures/series', handle((req) => c.measureSeries(req.query)));
  router.get('/sprinkler/state', handle((req) => c.sprinklerState(req.query)));
  router.get('/sprinkler/history', handle((req) => c.sprinklerHistory(req.query)));
  return router;
}
