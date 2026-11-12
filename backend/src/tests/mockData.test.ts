import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { loadConfig } from '../config/env';
import { createContext } from '../context';
import { createControllers } from '../controllers';
import { MockDataSource, MongoDataSource } from '../data';
import { RawMeasureDoc, RawSprinklerDoc } from '../models/types';
import { parseMeasureValue } from '../services/measureService';
import { mergeActivations } from '../services/sprinklerIntervals';
import { parseSprinklerDocs } from '../services/sprinklerService';
import { parseRunTimeMs } from '../utils/runtime';
import { FakeMongoDb, TZ, withObjectIds } from './helpers';

const dataDir = path.resolve(__dirname, '..', '..', 'data');

async function readJson<T>(file: string): Promise<T[]> {
  return JSON.parse(await fs.readFile(path.join(dataDir, file), 'utf8')) as T[];
}

describe('bundled mock dataset', () => {
  it('uses exactly the documented document structure', async () => {
    const measures = await readJson<RawMeasureDoc>('Measures.json');
    const sprinkler = await readJson<RawSprinklerDoc>('Sprinkler.json');
    for (const d of measures) {
      assert.deepEqual(Object.keys(d), ['_id', 'measure_type', 'value', 'place', 'date', 'date_hour']);
      assert.equal(typeof d.value, 'string');
      assert.match(d._id, /^[0-9a-f]{24}$/);
    }
    for (const d of sprinkler) {
      assert.deepEqual(Object.keys(d), ['_id', 'run_time', 'place', 'date', 'date_hour', 'activation_type']);
    }
  });

  it('covers three zones and three types, with numeric values that differ between zones', async () => {
    const measures = await readJson<RawMeasureDoc>('Measures.json');
    const avg = (place: number, type: string): number => {
      const v = measures.filter((d) => d.place === place && d.measure_type === type).map((d) => parseMeasureValue(d.value) as number);
      assert.ok(v.length > 500, `zone ${place} ${type} should have many records`);
      assert.ok(v.every((x) => Number.isFinite(x)));
      return v.reduce((a, b) => a + b, 0) / v.length;
    };
    for (const type of ['Tmp', 'Hum', 'Lum']) {
      const [a, b, c] = [1, 2, 3].map((p) => avg(p, type));
      assert.equal(new Set([a.toFixed(1), b.toFixed(1), c.toFixed(1)]).size, 3, `${type} averages should differ per zone`);
    }
    assert.ok(measures.some((d) => d.measure_type === 'Hum' && Number(d.value) > 100), 'humidity is kept as a raw number > 100');
  });

  it('does not record every type at every timestamp', async () => {
    const measures = await readJson<RawMeasureDoc>('Measures.json');
    const stamps = new Map<string, Set<string>>();
    for (const d of measures.filter((x) => x.place === 1)) {
      const k = `${d.date} ${d.date_hour}`;
      stamps.set(k, (stamps.get(k) ?? new Set()).add(d.measure_type));
    }
    assert.ok([...stamps.values()].some((t) => t.size < 3));
  });

  it('contains auto and manual activations, whitespace in run_time, and overlapping activations', async () => {
    const sprinkler = await readJson<RawSprinklerDoc>('Sprinkler.json');
    assert.ok(sprinkler.some((d) => d.activation_type === 'auto'));
    assert.ok(sprinkler.some((d) => d.activation_type === 'manual'));
    assert.ok(sprinkler.some((d) => d.run_time !== d.run_time.trim()));
    assert.ok(sprinkler.every((d) => parseRunTimeMs(d.run_time) !== null));
    assert.ok(new Set(sprinkler.map((d) => parseRunTimeMs(d.run_time))).size > 5, 'run times vary');
    for (const place of [1, 2, 3]) {
      const { activations, invalid } = parseSprinklerDocs(sprinkler, place, TZ);
      assert.equal(invalid, 0);
      assert.ok(activations.length > 0, `zone ${place} has activations`);
      assert.ok(mergeActivations(activations, TZ).length < activations.length, `zone ${place} has overlapping or touching runs`);
    }
  });

  it('reads identically on every load (deterministic)', async () => {
    const a = await new MockDataSource(dataDir).findMeasures({ place: 1 });
    const b = await new MockDataSource(dataDir).findMeasures({ place: 1 });
    assert.deepEqual(a, b);
  });

  it('latest values ignore the older 31-10 / 01-11 records (date-order trap)', async () => {
    const ctx = createContext(loadConfig({}));
    for (const place of [1, 2, 3]) {
      const r = await ctx.measures.latest(place);
      assert.equal(r.temperature?.date, '10-11-2026');
      assert.equal(r.humidity?.date, '10-11-2026');
    }
  });

  it('zone 3 luminosity stops earlier than the other types, and the series still align on one window', async () => {
    const ctx = createContext(loadConfig({}));
    const r = await ctx.measures.series(3, {});
    const lastLum = r.luminosity.points[r.luminosity.points.length - 1].epochMs;
    const lastOther = Math.max(
      r.temperature.points[r.temperature.points.length - 1].epochMs,
      r.humidity.points[r.humidity.points.length - 1].epochMs,
    );
    assert.ok(lastLum < lastOther);
    assert.equal(r.window?.toMs, lastOther); // window anchored at the newest record of any type
  });

  it('shows the demo sprinkler ON at 14:45:55 (14 s run started 14:45:50) and OFF at 14:46:10', async () => {
    const ctx = createContext(loadConfig({}));
    assert.equal((await ctx.sprinkler.state(1, Date.UTC(2026, 10, 10, 13, 45, 55))).state, 'ON');
    assert.equal((await ctx.sprinkler.state(1, Date.UTC(2026, 10, 10, 13, 46, 10))).state, 'OFF');
  });
});

describe('mock mode and MongoDB mode return identical structures', () => {
  it('produces the same bodies (apart from the data-source marker) for every endpoint and zone', async () => {
    const config = loadConfig({});
    const measures = await readJson<RawMeasureDoc>('Measures.json');
    const sprinkler = await readJson<RawSprinklerDoc>('Sprinkler.json');

    const mock = createControllers(createContext(config, new MockDataSource(dataDir)));
    const fake = new FakeMongoDb({ Measures: withObjectIds(measures), Sprinkler: withObjectIds(sprinkler) });
    const mongo = createControllers(
      createContext(config, new MongoDataSource({ uri: 'mongodb://x', database: 'Rpi07' }, async () => ({ db: fake, close: async () => {} }))),
    );

    const strip = <T extends { meta: object }>(r: T): Omit<T, 'meta'> => {
      const { meta, ...rest } = r;
      assert.deepEqual(Object.keys(meta), ['dataSource', 'isMock', 'timeZone']);
      return rest;
    };
    const at = '2026-11-10T14:10:30+01:00';

    for (const place of ['1', '2', '3']) {
      const q = { place };
      assert.deepEqual(strip(await mock.latestMeasures(q)), strip(await mongo.latestMeasures(q)));
      assert.deepEqual(strip(await mock.measureSeries(q)), strip(await mongo.measureSeries(q)));
      assert.deepEqual(strip(await mock.sprinklerHistory(q)), strip(await mongo.sprinklerHistory(q)));
      assert.deepEqual(strip(await mock.sprinklerState({ ...q, at })), strip(await mongo.sprinklerState({ ...q, at })));
      for (const type of ['Tmp', 'Hum', 'Lum']) {
        const h = { ...q, type, from: '2026-10-31T00:00:00', to: '2026-11-03T00:00:00' };
        assert.deepEqual(strip(await mock.measureHistory(h)), strip(await mongo.measureHistory(h)));
      }
    }
    assert.equal((await mock.latestMeasures({ place: '1' })).meta.isMock, true);
    assert.equal((await mongo.latestMeasures({ place: '1' })).meta.isMock, false);
  });

  it('the Mongo path narrows queries instead of reading whole collections', async () => {
    const measures = await readJson<RawMeasureDoc>('Measures.json');
    const fake = new FakeMongoDb({ Measures: withObjectIds(measures), Sprinkler: [] });
    const ds = new MongoDataSource({ uri: 'mongodb://x', database: 'Rpi07' }, async () => ({ db: fake, close: async () => {} }));
    const ctrl = createControllers(createContext(loadConfig({}), ds));
    await ctrl.measureSeries({ place: '1' });
    const finds = fake.calls.filter((c) => c.op === 'find');
    assert.ok(finds.every((c) => 'date' in c.filter || '$or' in c.filter), 'every find is restricted to specific days');
    assert.ok(finds.every((c) => c.filter['place'] === 1));
  });
});
