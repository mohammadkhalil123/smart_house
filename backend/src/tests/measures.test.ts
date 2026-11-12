import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MeasureService, parseMeasureDocs, parseMeasureValue } from '../services/measureService';
import { ArraySource, LeakyZoneSource, at, m, settings, TZ } from './helpers';

const D = '10-11-2026';

/** Same timestamps in three zones, different values, so any mix-up is visible. */
const docs = [
  m(1, 'Tmp', '22.5', D, '13:00:00'),
  m(1, 'Hum', '251', D, '13:00:01'),
  m(1, 'Lum', '700', D, '13:00:02'),
  m(1, 'Tmp', '22.9', D, '13:00:08'),
  m(1, 'Hum', '258', D, '13:00:09'),
  m(1, 'Lum', '720', D, '13:00:10'),
  m(2, 'Tmp', '27.0', D, '13:00:08'),
  m(2, 'Hum', '311', D, '13:00:09'),
  m(2, 'Lum', '900', D, '13:00:10'),
  m(3, 'Tmp', '21.0', D, '13:00:08'),
];
const svc = (source = new ArraySource(docs, [])) => new MeasureService(source, settings);

describe('value conversion', () => {
  it('converts stored strings to numbers and rejects non-numeric text', () => {
    assert.equal(parseMeasureValue('251'), 251);
    assert.equal(parseMeasureValue(' 22.5 '), 22.5);
    assert.equal(parseMeasureValue('-3.25'), -3.25);
    assert.equal(parseMeasureValue('1e2'), 100);
    for (const bad of ['', 'abc', 'NaN', 'Infinity', '12abc', '1,5', null, undefined, {}]) {
      assert.equal(parseMeasureValue(bad), null, `should reject ${JSON.stringify(bad)}`);
    }
  });

  it('keeps humidity exactly as stored: 258 stays 258, no unit, raw string preserved', async () => {
    const { humidity } = await svc().latest(1);
    assert.equal(humidity?.value, 258);
    assert.equal(humidity?.rawValue, '258');
    assert.equal(humidity?.unit, null);
  });

  it('assigns °C and lux units', async () => {
    const r = await svc().latest(1);
    assert.equal(r.temperature?.unit, '°C');
    assert.equal(r.luminosity?.unit, 'lux');
  });

  it('skips and counts malformed documents', () => {
    const { parsed, invalid } = parseMeasureDocs(
      [m(1, 'Tmp', 'oops', D, '10:00:00'), m(1, 'Xyz', '1', D, '10:00:00'), m(1, 'Tmp', '1', '99-99-2026', '10:00:00'), m(1, 'Tmp', '5', D, '10:00:00')],
      1,
      TZ,
    );
    assert.equal(invalid, 3);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].value, 5);
  });
});

describe('zone filtering', () => {
  it('latest values come from the requested zone only', async () => {
    assert.equal((await svc().latest(1)).temperature?.value, 22.9);
    assert.equal((await svc().latest(2)).temperature?.value, 27);
    assert.equal((await svc().latest(3)).temperature?.value, 21);
    assert.equal((await svc().latest(1)).humidity?.place, 1);
  });

  it('series never mix zones', async () => {
    const r = await svc().series(2, {});
    assert.equal(r.place, 2);
    assert.deepEqual(r.temperature.points.map((p) => p.value), [27]);
    assert.deepEqual(r.humidity.points.map((p) => p.value), [311]);
    assert.deepEqual(r.luminosity.points.map((p) => p.value), [900]);
  });

  it('drops other-zone documents even if the data source returns them', async () => {
    const leaky = svc(new LeakyZoneSource(docs, []));
    const r = await leaky.series(1, {});
    assert.deepEqual(r.temperature.points.map((p) => p.value), [22.5, 22.9]);
    assert.equal((await leaky.latest(3)).humidity, null);
    assert.equal((await leaky.latest(3)).temperature?.value, 21);
  });

  it('a zone without data of some type returns null for it', async () => {
    const r = await svc().latest(3);
    assert.equal(r.temperature?.value, 21);
    assert.equal(r.humidity, null);
    assert.equal(r.luminosity, null);
  });
});

describe('measurement type filtering', () => {
  it('history returns only the requested type', async () => {
    const r = await svc().history(1, 'Hum', {});
    assert.equal(r.type, 'Hum');
    assert.deepEqual(r.points.map((p) => p.value), [251, 258]);
    assert.equal(r.unit, null);
    const t = await svc().history(1, 'Tmp', {});
    assert.deepEqual(t.points.map((p) => p.value), [22.5, 22.9]);
    assert.equal(t.unit, '°C');
  });

  it('points keep the original date and time strings', async () => {
    const [p] = (await svc().history(1, 'Lum', {})).points;
    assert.equal(p.date, D);
    assert.equal(p.dateHour, '13:00:02');
    assert.equal(p.timestamp, '2026-11-10T13:00:02.000+01:00');
    assert.equal(p.epochMs, at(D, '13:00:02'));
    assert.equal(p.rawValue, '700');
  });
});

describe('latest measurement retrieval', () => {
  it('returns the newest value per type even when types are recorded at different times', async () => {
    const source = new ArraySource(
      [
        m(1, 'Tmp', '20', D, '10:00:00'),
        m(1, 'Tmp', '21', D, '10:00:08'),
        m(1, 'Hum', '200', D, '10:00:09'),
        m(1, 'Lum', '500', D, '09:59:50'), // luminosity has no record at the newest timestamps
      ],
      [],
    );
    const r = await svc(source).latest(1);
    assert.equal(r.temperature?.value, 21);
    assert.equal(r.humidity?.value, 200);
    assert.equal(r.luminosity?.value, 500);
  });

  it('chooses by real date, not by string order (31-10 sorts after 10-11 as text)', async () => {
    const source = new ArraySource(
      [m(1, 'Tmp', '15', '31-10-2026', '23:59:59'), m(1, 'Tmp', '99', '01-11-2026', '00:00:01'), m(1, 'Tmp', '23.4', D, '08:00:00'), m(1, 'Tmp', '17', '09-11-2026', '12:00:00')],
      [],
    );
    assert.equal((await svc(source).latest(1)).temperature?.value, 23.4);
  });

  it('falls back to an older day when a type is absent on the newest day', async () => {
    const source = new ArraySource([m(1, 'Tmp', '22', D, '10:00:00'), m(1, 'Hum', '240', '09-11-2026', '18:00:00')], []);
    const r = await svc(source).latest(1);
    assert.equal(r.temperature?.value, 22);
    assert.equal(r.humidity?.value, 240);
    assert.equal(r.humidity?.date, '09-11-2026');
  });

  it('skips a malformed newest record and counts it', async () => {
    const source = new ArraySource([m(1, 'Tmp', '22', D, '10:00:00'), m(1, 'Tmp', 'ERR', D, '10:00:08')], []);
    const r = await svc(source).latest(1);
    assert.equal(r.temperature?.value, 22);
    assert.equal(r.invalidRecords, 1);
  });

  it('returns nulls when there is no data at all', async () => {
    const r = await svc(new ArraySource([], [])).latest(1);
    assert.equal(r.temperature, null);
    assert.equal(r.humidity, null);
    assert.equal(r.luminosity, null);
  });
});

describe('chronological ordering and ranges', () => {
  it('sorts points by parsed timestamp even if the source returns them reversed', async () => {
    const r = await svc().history(1, 'Tmp', {});
    const times = r.points.map((p) => p.epochMs);
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
  });

  it('orders across a month boundary correctly', async () => {
    const source = new ArraySource(
      [m(1, 'Tmp', '3', D, '00:00:05'), m(1, 'Tmp', '1', '31-10-2026', '23:59:50'), m(1, 'Tmp', '2', '01-11-2026', '00:00:10')],
      [],
    );
    const r = await svc(source).history(1, 'Tmp', { fromMs: at('31-10-2026', '00:00:00'), toMs: at(D, '23:59:59') });
    assert.deepEqual(r.points.map((p) => p.value), [1, 2, 3]);
  });

  it('defaults to a window ending at the newest record of the zone', async () => {
    const source = new ArraySource([m(1, 'Tmp', '1', D, '10:00:00'), m(1, 'Tmp', '2', D, '11:30:00'), m(1, 'Tmp', '3', D, '13:00:00')], []);
    const r = await svc(source).series(1, {}); // default window: 120 minutes
    assert.deepEqual(r.temperature.points.map((p) => p.value), [2, 3]);
    assert.equal(r.window?.toMs, at(D, '13:00:00'));
    assert.equal(r.window?.fromMs, at(D, '13:00:00') - 120 * 60_000);
    assert.equal(r.window?.to, '2026-11-10T13:00:00.000+01:00');
  });

  it('honours windowMinutes, and from/to (inclusive) filters', async () => {
    const source = new ArraySource([m(1, 'Tmp', '1', D, '10:00:00'), m(1, 'Tmp', '2', D, '11:30:00'), m(1, 'Tmp', '3', D, '13:00:00')], []);
    assert.deepEqual((await svc(source).history(1, 'Tmp', { windowMinutes: 30 })).points.map((p) => p.value), [3]);
    const r = await svc(source).history(1, 'Tmp', { fromMs: at(D, '10:00:00'), toMs: at(D, '11:30:00') });
    assert.deepEqual(r.points.map((p) => p.value), [1, 2]);
    assert.deepEqual((await svc(source).history(1, 'Tmp', { fromMs: at(D, '11:30:00') })).points.map((p) => p.value), [2, 3]);
  });

  it('series share one window anchored at the newest record of any type', async () => {
    const source = new ArraySource([m(1, 'Tmp', '1', D, '13:00:00'), m(1, 'Lum', '5', D, '12:59:00')], []);
    const r = await svc(source).series(1, { windowMinutes: 5 });
    assert.equal(r.window?.toMs, at(D, '13:00:00'));
    assert.equal(r.temperature.count, 1);
    assert.equal(r.luminosity.count, 1);
    assert.equal(r.humidity.count, 0);
    assert.deepEqual(r.humidity.points, []);
  });

  it('works across midnight (window spans two local days)', async () => {
    const source = new ArraySource([m(1, 'Tmp', '1', '09-11-2026', '23:55:00'), m(1, 'Tmp', '2', D, '00:05:00')], []);
    const r = await svc(source).history(1, 'Tmp', { fromMs: at('09-11-2026', '23:50:00'), toMs: at(D, '00:10:00') });
    assert.deepEqual(r.points.map((p) => p.value), [1, 2]);
  });

  it('returns an empty series with a null window when the zone has no data', async () => {
    const r = await svc(new ArraySource([], [])).series(1, {});
    assert.equal(r.window, null);
    assert.equal(r.temperature.count, 0);
  });

  it('reports the data source in every response', async () => {
    const r = await svc().latest(1);
    assert.deepEqual(r.meta, { dataSource: 'mock', isMock: true, timeZone: TZ });
  });
});
