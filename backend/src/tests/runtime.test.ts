import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRunTimeMs } from '../utils/runtime';

describe('run_time parsing', () => {
  it('parses the real format with microseconds', () => {
    assert.equal(parseRunTimeMs('0:00:14.015384'), 14015);
    assert.equal(parseRunTimeMs('0:00:13.987201'), 13987);
  });

  it('does not hardcode 14 seconds', () => {
    assert.equal(parseRunTimeMs('0:00:45'), 45_000);
    assert.equal(parseRunTimeMs('0:03:45.250000'), 225_250);
    assert.equal(parseRunTimeMs('1:02:03'), 3_723_000);
  });

  it('tolerates surrounding whitespace', () => {
    assert.equal(parseRunTimeMs('0:00:14.015384 '), 14015);
    assert.equal(parseRunTimeMs('  0:00:20\t'), 20_000);
    assert.equal(parseRunTimeMs('0:00:14.4 '), 14_400);
  });

  it('handles Python day prefixes and short fractions', () => {
    assert.equal(parseRunTimeMs('1 day, 0:00:14'), 86_414_000);
    assert.equal(parseRunTimeMs('2 days, 1:00:00.5'), 2 * 86_400_000 + 3_600_000 + 500);
    assert.equal(parseRunTimeMs('0:00:00.5'), 500);
    assert.equal(parseRunTimeMs('0:00:00'), 0);
  });

  it('rounds sub-millisecond precision to the nearest millisecond', () => {
    assert.equal(parseRunTimeMs('0:00:00.0004'), 0);
    assert.equal(parseRunTimeMs('0:00:00.0006'), 1);
    assert.equal(parseRunTimeMs('0:00:25.123456'), 25_123);
  });

  it('rejects invalid values safely', () => {
    for (const bad of ['', '   ', 'abc', '14', '0:00', '0:61:00', '0:00:61', '-0:00:14', '0:00:14.', '0:00:14.1234567890', null, undefined, 14, {}]) {
      assert.equal(parseRunTimeMs(bad), null, `should reject ${JSON.stringify(bad)}`);
    }
  });
});
