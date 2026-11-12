import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../config/env';
import { createContext } from '../context';
import { createDataSource, MockDataSource, MongoDataSource } from '../data';
import { MongoConnection } from '../data/mongoDataSource';
import { ConfigError, DataSourceError } from '../utils/errors';
import { FakeMongoDb, m, s, withObjectIds } from './helpers';

const mongoEnv = { DATA_SOURCE: 'mongodb', MONGODB_URI: 'mongodb://user:secret@192.168.1.50:27017/', MONGODB_DATABASE: 'Rpi07' };

describe('configuration', () => {
  it('defaults to mock mode on 127.0.0.1:3000 with Europe/Paris', () => {
    const c = loadConfig({});
    assert.equal(c.dataSource, 'mock');
    assert.equal(c.port, 3000);
    assert.equal(c.host, '127.0.0.1');
    assert.equal(c.timeZone, 'Europe/Paris');
    assert.deepEqual([...c.zones], [1, 2, 3]);
    assert.equal(c.mockNowMs, undefined);
  });

  it('reads DATA_SOURCE case-insensitively and rejects unknown values', () => {
    assert.equal(loadConfig({ DATA_SOURCE: ' MOCK ' }).dataSource, 'mock');
    assert.equal(loadConfig(mongoEnv).dataSource, 'mongodb');
    assert.throws(() => loadConfig({ DATA_SOURCE: 'sqlite' }), ConfigError);
  });

  it('requires a URI and a real database name in mongodb mode', () => {
    assert.throws(() => loadConfig({ DATA_SOURCE: 'mongodb', MONGODB_DATABASE: 'Rpi07' }), /MONGODB_URI/);
    assert.throws(() => loadConfig({ ...mongoEnv, MONGODB_DATABASE: 'RpiXX' }), /placeholder/);
    assert.throws(() => loadConfig({ ...mongoEnv, MONGODB_DATABASE: '' }), /placeholder/);
    assert.equal(loadConfig(mongoEnv).mongodbDatabase, 'Rpi07');
  });

  it('does not need MongoDB settings in mock mode', () => {
    assert.doesNotThrow(() => loadConfig({ DATA_SOURCE: 'mock', MONGODB_URI: '', MONGODB_DATABASE: 'RpiXX' }));
  });

  it('validates PORT and the time zone', () => {
    assert.throws(() => loadConfig({ PORT: '0' }), ConfigError);
    assert.throws(() => loadConfig({ PORT: 'abc' }), ConfigError);
    assert.throws(() => loadConfig({ PORT: '70000' }), ConfigError);
    assert.throws(() => loadConfig({ MEASUREMENT_TIME_ZONE: 'Nowhere/City' }), /time zone/);
    assert.equal(loadConfig({ MEASUREMENT_TIME_ZONE: 'UTC' }).timeZone, 'UTC');
  });

  it('parses MOCK_NOW in the measurement zone, only in mock mode', () => {
    assert.equal(loadConfig({ MOCK_NOW: '2026-11-10T14:45:55' }).mockNowMs, Date.UTC(2026, 10, 10, 13, 45, 55));
    assert.equal(loadConfig({ MOCK_NOW: '2026-11-10T14:45:55Z' }).mockNowMs, Date.UTC(2026, 10, 10, 14, 45, 55));
    assert.throws(() => loadConfig({ MOCK_NOW: 'soon' }), /MOCK_NOW/);
    assert.equal(loadConfig({ ...mongoEnv, MOCK_NOW: '2026-11-10T14:45:55' }).mockNowMs, undefined);
  });
});

describe('data-source selection', () => {
  it('creates the mock source for DATA_SOURCE=mock', () => {
    const ds = createDataSource(loadConfig({ DATA_SOURCE: 'mock' }));
    assert.ok(ds instanceof MockDataSource);
    assert.equal(ds.kind, 'mock');
  });

  it('creates the MongoDB source for DATA_SOURCE=mongodb without connecting', () => {
    let connects = 0;
    const ds = createDataSource(loadConfig(mongoEnv), async () => {
      connects++;
      return { db: new FakeMongoDb({}), close: async () => {} };
    });
    assert.ok(ds instanceof MongoDataSource);
    assert.equal(ds.kind, 'mongodb');
    assert.equal(ds.databaseName, 'Rpi07');
    assert.equal(connects, 0);
  });

  it('never exposes the connection string in origin or database name', () => {
    const ds = createDataSource(loadConfig(mongoEnv));
    assert.equal(ds.origin.includes('secret'), false);
    assert.equal(ds.origin.includes('192.168'), false);
  });

  it('flags the data source in responses: isMock only for mock mode', async () => {
    const mock = createContext(loadConfig({}));
    const mongo = createContext(loadConfig(mongoEnv), new MongoDataSource({ uri: 'x', database: 'Rpi07' }, async () => ({ db: new FakeMongoDb({}), close: async () => {} })));
    assert.equal((await mock.measures.latest(1)).meta.isMock, true);
    assert.equal((await mongo.measures.latest(1)).meta.dataSource, 'mongodb');
    assert.equal((await mongo.measures.latest(1)).meta.isMock, false);
  });

  it('uses the fixed demo clock only in mock mode', async () => {
    const withNow = createContext(loadConfig({ MOCK_NOW: '2026-11-10T14:45:55' }));
    const r = await withNow.sprinkler.state(1);
    assert.equal(r.evaluatedAtSource, 'mock-now');
    assert.equal(r.state, 'ON'); // 14:45:50 + 14 s covers 14:45:55 in the demo data
    const plain = createContext(loadConfig({}));
    assert.equal((await plain.sprinkler.state(1)).evaluatedAtSource, 'system-clock');
  });
});

describe('MongoDataSource queries (fake driver)', () => {
  const measures = [m(1, 'Tmp', '22.5', '10-11-2026', '12:30:00', 'a'), m(1, 'Hum', '251', '10-11-2026', '12:30:01', 'b'), m(2, 'Tmp', '27', '10-11-2026', '12:30:00', 'c')];
  const sprinkler = [s(1, '10-11-2026', '12:31:00', '0:00:14', 'auto', 'x')];
  const make = (db = new FakeMongoDb({ Measures: withObjectIds(measures), Sprinkler: withObjectIds(sprinkler) })) => {
    let connects = 0;
    let closes = 0;
    const ds = new MongoDataSource({ uri: 'mongodb://u:p@h/', database: 'Rpi07' }, async (): Promise<MongoConnection> => {
      connects++;
      return { db, close: async () => void closes++ };
    });
    return { ds, db, stats: () => ({ connects, closes }) };
  };

  it('connects lazily, once, and reads the Measures and Sprinkler collections', async () => {
    const { ds, db, stats } = make();
    assert.equal(stats().connects, 0);
    await ds.listMeasureDates(1);
    await ds.listSprinklerDates(1);
    assert.equal(stats().connects, 1);
    assert.deepEqual(db.calls.map((c) => c.collection), ['Measures', 'Sprinkler']);
  });

  it('filters by zone, type and day slices (time bounds only on the given slice)', async () => {
    const { ds, db } = make();
    const docs = await ds.findMeasures({
      place: 1,
      types: ['Tmp'],
      slices: [{ date: '10-11-2026', fromTime: '12:00:00', toTime: '13:00:00' }, { date: '11-11-2026' }],
    });
    assert.deepEqual(docs.map((d) => d._id), ['a']);
    assert.deepEqual(db.calls[0].filter, {
      place: 1,
      measure_type: { $in: ['Tmp'] },
      $or: [{ date: '10-11-2026', date_hour: { $gte: '12:00:00', $lte: '13:00:00' } }, { date: '11-11-2026' }],
    });
  });

  it('asks for the newest documents of one day and type, sorted by time within the day', async () => {
    const { ds, db } = make();
    await ds.findLatestMeasures({ place: 1, date: '10-11-2026', type: 'Hum', limit: 5 });
    assert.deepEqual(db.calls[0].filter, { place: 1, date: '10-11-2026', measure_type: 'Hum' });
    assert.deepEqual(db.calls[0].sort, { date_hour: -1 });
    assert.equal(db.calls[0].limit, 5);
  });

  it('converts driver ObjectIds to strings', async () => {
    const { ds } = make();
    const [doc] = await ds.findSprinklerActivations({ place: 1, dates: ['10-11-2026'] });
    assert.equal(doc._id, 'x');
    assert.equal(typeof doc._id, 'string');
  });

  it('returns nothing, without querying, for an empty restriction', async () => {
    const { ds, db } = make();
    assert.deepEqual(await ds.findMeasures({ place: 1, slices: [] }), []);
    assert.deepEqual(await ds.findSprinklerActivations({ place: 1, dates: [] }), []);
    assert.equal(db.calls.length, 0);
  });

  it('only reads: the fake driver exposes no write operations and none are used', async () => {
    const { ds, db } = make();
    await ds.findMeasures({ place: 1 });
    await ds.ping();
    assert.ok(db.calls.every((c) => c.op === 'find' || c.op === 'distinct'));
  });

  it('wraps connection failures in DataSourceError, hides credentials, and retries later', async () => {
    let attempts = 0;
    const ds = new MongoDataSource({ uri: 'mongodb://user:secret@h/', database: 'Rpi07' }, async () => {
      attempts++;
      if (attempts === 1) throw new Error('connect ECONNREFUSED mongodb://user:secret@h/');
      return { db: new FakeMongoDb({ Measures: [] }), close: async () => {} };
    });
    await assert.rejects(ds.listMeasureDates(1), (err: unknown) => {
      assert.ok(err instanceof DataSourceError);
      assert.equal(err.message.includes('secret'), false);
      return true;
    });
    assert.deepEqual(await ds.listMeasureDates(1), []);
    assert.equal(attempts, 2);
  });

  it('closes the connection', async () => {
    const { ds, stats } = make();
    await ds.ping();
    await ds.close();
    assert.equal(stats().closes, 1);
  });
});
