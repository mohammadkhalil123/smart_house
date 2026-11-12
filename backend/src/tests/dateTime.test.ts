import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertValidTimeZone,
  formatIsoWithOffset,
  localDaysBetween,
  parseDateString,
  parseInstant,
  parseMeasurementTimestamp,
  parseTimeString,
} from '../utils/dateTime';
import { TZ } from './helpers';

describe('date and time parsing', () => {
  it('parses DD-MM-YYYY strictly', () => {
    assert.deepEqual(parseDateString('10-11-2026'), { year: 2026, month: 11, day: 10 });
    assert.deepEqual(parseDateString(' 01-02-2027 '), { year: 2027, month: 2, day: 1 });
    for (const bad of ['2026-11-10', '10/11/2026', '31-02-2026', '00-01-2026', '10-13-2026', '1-1-2026', '', null, 42]) {
      assert.equal(parseDateString(bad), null, `should reject ${String(bad)}`);
    }
    assert.notEqual(parseDateString('29-02-2028'), null); // leap year
    assert.equal(parseDateString('29-02-2026'), null); // not a leap year
  });

  it('parses HH:mm:ss strictly', () => {
    assert.deepEqual(parseTimeString('13:34:25'), { hour: 13, minute: 34, second: 25 });
    for (const bad of ['24:00:00', '12:60:00', '12:00:60', '1:02:03', '12:00', '', undefined]) {
      assert.equal(parseTimeString(bad), null, `should reject ${String(bad)}`);
    }
  });

  it('combines date and date_hour using the configured zone, not UTC', () => {
    // 10 Nov 2026: Paris is on CET (UTC+1) -> 13:34:25 local = 12:34:25 UTC
    assert.equal(parseMeasurementTimestamp('10-11-2026', '13:34:25', TZ), Date.UTC(2026, 10, 10, 12, 34, 25));
    // 15 Jul 2026: Paris is on CEST (UTC+2)
    assert.equal(parseMeasurementTimestamp('15-07-2026', '13:34:25', TZ), Date.UTC(2026, 6, 15, 11, 34, 25));
    // The same wall-clock text in UTC is a different instant
    assert.notEqual(parseMeasurementTimestamp('10-11-2026', '13:34:25', TZ), parseMeasurementTimestamp('10-11-2026', '13:34:25', 'UTC'));
    assert.equal(parseMeasurementTimestamp('10-11-2026', '13:34:25', 'UTC'), Date.UTC(2026, 10, 10, 13, 34, 25));
  });

  it('returns null when either part is invalid', () => {
    assert.equal(parseMeasurementTimestamp('31-02-2026', '10:00:00', TZ), null);
    assert.equal(parseMeasurementTimestamp('10-11-2026', '25:00:00', TZ), null);
    assert.equal(parseMeasurementTimestamp(undefined, '10:00:00', TZ), null);
  });

  it('handles daylight-saving transitions', () => {
    // Clocks go forward 02:00 -> 03:00 on 29 Mar 2026: 02:30 does not exist, it is shifted forward.
    assert.equal(parseMeasurementTimestamp('29-03-2026', '02:30:00', TZ), Date.UTC(2026, 2, 29, 1, 30, 0));
    // Clocks go back 03:00 -> 02:00 on 25 Oct 2026: 02:30 happens twice, the first occurrence wins.
    assert.equal(parseMeasurementTimestamp('25-10-2026', '02:30:00', TZ), Date.UTC(2026, 9, 25, 0, 30, 0));
    // Just after the change the offset is +1h again.
    assert.equal(parseMeasurementTimestamp('25-10-2026', '03:30:00', TZ), Date.UTC(2026, 9, 25, 2, 30, 0));
  });

  it('sorts chronologically after parsing (string order would be wrong)', () => {
    const stamps = [
      ['10-11-2026', '08:00:00'],
      ['31-10-2026', '23:59:59'],
      ['01-11-2026', '00:00:01'],
      ['09-11-2026', '12:00:00'],
    ];
    const lexicographic = [...stamps].sort((a, b) => (a.join(' ') < b.join(' ') ? -1 : 1));
    assert.deepEqual(lexicographic[0], ['01-11-2026', '00:00:01']); // proves the trap exists

    const chronological = [...stamps].sort(
      (a, b) => (parseMeasurementTimestamp(a[0], a[1], TZ) as number) - (parseMeasurementTimestamp(b[0], b[1], TZ) as number),
    );
    assert.deepEqual(chronological.map((x) => x[0]), ['31-10-2026', '01-11-2026', '09-11-2026', '10-11-2026']);
  });

  it('formats ISO strings with the zone offset', () => {
    const winter = Date.UTC(2026, 10, 10, 12, 34, 25);
    assert.equal(formatIsoWithOffset(winter, TZ), '2026-11-10T13:34:25.000+01:00');
    assert.equal(formatIsoWithOffset(winter + 15, TZ), '2026-11-10T13:34:25.015+01:00');
    assert.equal(formatIsoWithOffset(Date.UTC(2026, 6, 15, 11, 34, 25), TZ), '2026-07-15T13:34:25.000+02:00');
    assert.equal(formatIsoWithOffset(winter, 'UTC'), '2026-11-10T12:34:25.000+00:00');
    assert.equal(formatIsoWithOffset(winter, 'America/New_York'), '2026-11-10T07:34:25.000-05:00');
  });

  it('parses query instants: explicit offsets win, otherwise local time in the zone', () => {
    const utc = Date.UTC(2026, 10, 10, 12, 34, 25);
    assert.equal(parseInstant('2026-11-10T13:34:25+01:00', TZ), utc);
    assert.equal(parseInstant('2026-11-10T12:34:25Z', TZ), utc);
    assert.equal(parseInstant('2026-11-10T13:34:25', TZ), utc); // no offset -> Paris, not UTC
    assert.equal(parseInstant('2026-11-10T13:34:25.250+01:00', TZ), utc + 250);
    assert.equal(parseInstant('2026-11-10', TZ), Date.UTC(2026, 10, 9, 23, 0, 0)); // midnight Paris
    for (const bad of ['yesterday', '2026-13-01', '2026-02-30T10:00:00', '2026-11-10T25:00:00', '10-11-2026', '']) {
      assert.equal(parseInstant(bad, TZ), null, `should reject ${bad}`);
    }
  });

  it('lists local calendar days across month boundaries', () => {
    const from = parseMeasurementTimestamp('31-10-2026', '23:00:00', TZ) as number;
    const to = parseMeasurementTimestamp('02-11-2026', '01:00:00', TZ) as number;
    assert.deepEqual(localDaysBetween(from, to, TZ), ['31-10-2026', '01-11-2026', '02-11-2026']);
    assert.deepEqual(localDaysBetween(from, from, TZ), ['31-10-2026']);
  });

  it('validates time zone names', () => {
    assert.doesNotThrow(() => assertValidTimeZone('Europe/Paris'));
    assert.throws(() => assertValidTimeZone('Mars/Olympus'), RangeError);
  });
});
