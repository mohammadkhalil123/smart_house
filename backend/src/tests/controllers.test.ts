import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../config/env';
import { createContext } from '../context';
import { createControllers } from '../controllers';
import { MockDataSource } from '../data';
import { ApiError, DataSourceError, toErrorResponse } from '../utils/errors';
import { ArraySource, m, s } from './helpers';

const D = '10-11-2026';
const source = new ArraySource([m(1, 'Tmp', '22.5', D, '13:00:00'), m(1, 'Hum', '258', D, '13:00:01'), m(2, 'Tmp', '27', D, '13:00:00')], [s(1, D, '13:00:05', '0:00:14')]);
const controllers = createControllers(createContext(loadConfig({}), source));

async function badRequest(promiseOrFn: Promise<unknown> | (() => unknown), match?: RegExp): Promise<ApiError> {
  try {
    await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn);
  } catch (err) {
    assert.ok(err instanceof ApiError, `expected ApiError, got ${String(err)}`);
    assert.equal(err.status, 400);
    if (match) assert.match(err.message, match);
    return err;
  }
  throw new Error('expected a 400 ApiError but the call succeeded');
}

describe('query validation', () => {
  it('requires a valid place on every data endpoint', async () => {
    const calls: [string, (q: Record<string, unknown>) => Promise<unknown>][] = [
      ['latest', (q) => controllers.latestMeasures(q)],
      ['history', (q) => controllers.measureHistory({ type: 'Tmp', ...q })],
      ['series', (q) => controllers.measureSeries(q)],
      ['state', (q) => controllers.sprinklerState(q)],
      ['sprinkler history', (q) => controllers.sprinklerHistory(q)],
    ];
    for (const [name, call] of calls) {
      await badRequest(call({}), /place/);
      await badRequest(call({ place: '0' }), /Invalid place/);
      await badRequest(call({ place: '4' }), /Invalid place/);
      await badRequest(call({ place: 'abc' }), /Invalid place/);
      await badRequest(call({ place: '1.5' }), /Invalid place/);
      await badRequest(call({ place: ['1', '2'] }), /place/);
      assert.ok(await call({ place: '1' }), `${name} should accept place=1`);
    }
  });

  it('rejects an unknown or missing measure type', async () => {
    await badRequest(controllers.measureHistory({ place: '1' }), /type/);
    await badRequest(controllers.measureHistory({ place: '1', type: 'Temp' }), /Invalid type/);
    await badRequest(controllers.measureHistory({ place: '1', type: 'tmp' }), /Invalid type/);
    for (const type of ['Tmp', 'Hum', 'Lum']) assert.ok(await controllers.measureHistory({ place: '1', type }));
  });

  it('validates the optional date range', async () => {
    const q = { place: '1', type: 'Tmp' };
    await badRequest(controllers.measureHistory({ ...q, from: 'yesterday' }), /Invalid "from"/);
    await badRequest(controllers.measureHistory({ ...q, to: '2026-02-30T10:00:00' }), /Invalid "to"/);
    await badRequest(controllers.measureHistory({ ...q, from: '2026-11-10T14:00:00', to: '2026-11-10T13:00:00' }), /earlier/);
    await badRequest(controllers.measureHistory({ ...q, from: '2026-11-10T13:00:00', to: '2026-11-10T13:00:00' }), /earlier/);
    await badRequest(controllers.measureHistory({ ...q, from: '2026-11-01T00:00:00', to: '2026-11-20T00:00:00' }), /longer than/);
    await badRequest(controllers.measureHistory({ ...q, windowMinutes: '0' }), /windowMinutes/);
    await badRequest(controllers.measureHistory({ ...q, windowMinutes: '-5' }), /windowMinutes/);
    await badRequest(controllers.measureHistory({ ...q, windowMinutes: '10x' }), /windowMinutes/);
    await badRequest(controllers.measureHistory({ ...q, windowMinutes: '999999' }), /windowMinutes/);
    await badRequest(controllers.measureHistory({ ...q, windowMinutes: '30', from: '2026-11-10T10:00:00', to: '2026-11-10T11:00:00' }), /not all three/);
    const ok = await controllers.measureHistory({ ...q, from: '2026-11-10T13:00:00+01:00', to: '2026-11-10T14:00:00+01:00' });
    assert.equal(ok.count, 1);
  });

  it('validates the sprinkler "at" instant', async () => {
    await badRequest(controllers.sprinklerState({ place: '1', at: 'now' }), /Invalid "at"/);
    const r = await controllers.sprinklerState({ place: '1', at: '2026-11-10T13:00:10+01:00' });
    assert.equal(r.state, 'ON');
    assert.equal(r.evaluatedAtSource, 'query');
  });
});

describe('responses', () => {
  it('lists the three zones', () => {
    const r = controllers.zones();
    assert.deepEqual(r.zones.map((z) => z.place), [1, 2, 3]);
    assert.deepEqual(r.zones[0], { place: 1, id: '1', name: 'Zone 1' });
    assert.equal(r.meta.isMock, true);
  });

  it('reports health and the active data source', async () => {
    const h = await controllers.health();
    assert.equal(h.status, 'ok');
    assert.equal(h.dataSource, 'mock');
    assert.equal(h.isMock, true);
    assert.equal(h.database, null);
    assert.equal(h.timeZone, 'Europe/Paris');
  });

  it('reports "degraded" when the data source is unreachable', async () => {
    const broken = new MockDataSource('/definitely/not/a/real/folder');
    const h = await createControllers(createContext(loadConfig({}), broken)).health();
    assert.equal(h.status, 'degraded');
    assert.equal(h.dataSourceStatus, 'unavailable');
  });

  it('surfaces a missing mock file as a DataSourceError', async () => {
    const broken = createControllers(createContext(loadConfig({}), new MockDataSource('/definitely/not/a/real/folder')));
    await assert.rejects(broken.latestMeasures({ place: '1' }), DataSourceError);
  });

  it('serialises to plain JSON', async () => {
    const r = await controllers.measureSeries({ place: '1' });
    assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
  });
});

describe('error mapping', () => {
  it('maps validation errors to 400 with details', () => {
    const { status, body } = toErrorResponse(ApiError.badRequest('nope', { parameter: 'place' }));
    assert.equal(status, 400);
    assert.equal(body.error.code, 'BAD_REQUEST');
    assert.deepEqual(body.error.details, { parameter: 'place' });
  });

  it('maps data-source failures to 503 without leaking internals', () => {
    const { status, body } = toErrorResponse(new DataSourceError('connect failed mongodb://u:secret@h/', new Error('x')));
    assert.equal(status, 503);
    assert.equal(JSON.stringify(body).includes('secret'), false);
    assert.equal(body.error.code, 'DATA_SOURCE_UNAVAILABLE');
  });

  it('maps anything else to a generic 500', () => {
    const { status, body } = toErrorResponse(new Error('stack trace details'));
    assert.equal(status, 500);
    assert.equal(JSON.stringify(body).includes('stack trace'), false);
  });
});
