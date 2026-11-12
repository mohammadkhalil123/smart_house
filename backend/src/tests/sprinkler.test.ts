import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeActivations, buildTransitions } from '../services/sprinklerIntervals';
import { parseSprinklerDocs, SprinklerService } from '../services/sprinklerService';
import { ArraySource, LeakyZoneSource, at, s, settings, TZ } from './helpers';

const D = '10-11-2026';

function intervalsOf(docs: ReturnType<typeof s>[], place = 1) {
  return mergeActivations(parseSprinklerDocs(docs, place, TZ).activations, TZ);
}

describe('sprinkler activation parsing', () => {
  it('computes end = start + parsed run_time and keeps the original strings', () => {
    const { activations, invalid } = parseSprinklerDocs([s(1, D, '14:45:50', '0:00:14.015384 ', 'auto', 'abc')], 1, TZ);
    assert.equal(invalid, 0);
    const a = activations[0];
    assert.equal(a.startMs, at(D, '14:45:50'));
    assert.equal(a.runTimeMs, 14015);
    assert.equal(a.endMs, at(D, '14:45:50') + 14015);
    assert.equal(a.runTime, '0:00:14.015384 ');
    assert.equal(a.date, D);
    assert.equal(a.dateHour, '14:45:50');
    assert.equal(a.activationType, 'auto');
    assert.equal(a.startTimestamp, '2026-11-10T14:45:50.000+01:00');
    assert.equal(a.endTimestamp, '2026-11-10T14:46:04.015+01:00');
  });

  it('skips and counts invalid documents; accepts only auto/manual; drops other zones', () => {
    const docs = [
      s(1, D, '10:00:00', 'garbage'),
      s(1, '31-02-2026', '10:00:00', '0:00:10'),
      s(1, D, '10:00:00', '0:00:10', 'remote'),
      s(1, D, '10:05:00', '0:00:10', 'manual'),
      s(2, D, '10:06:00', '0:00:10'),
    ];
    const { activations, invalid } = parseSprinklerDocs(docs, 1, TZ);
    assert.equal(invalid, 3);
    assert.equal(activations.length, 1);
    assert.equal(activations[0].activationType, 'manual');
  });
});

describe('sprinkler ON/OFF reconstruction', () => {
  it('turns a single activation into one ON interval of the parsed length', () => {
    const [i, ...rest] = intervalsOf([s(1, D, '12:00:00', '0:00:20.5')]);
    assert.equal(rest.length, 0);
    assert.equal(i.startMs, at(D, '12:00:00'));
    assert.equal(i.durationMs, 20_500);
  });

  it('keeps separate activations as separate intervals, regardless of input order', () => {
    const intervals = intervalsOf([s(1, D, '13:00:00', '0:00:10'), s(1, D, '12:00:00', '0:00:10')]);
    assert.equal(intervals.length, 2);
    assert.equal(intervals[0].startMs, at(D, '12:00:00'));
  });

  it('merges overlapping activations: ON until all active intervals have ended', () => {
    // 12:00:00-12:00:30 and 12:00:20-12:00:50 overlap
    const [i, ...rest] = intervalsOf([s(1, D, '12:00:00', '0:00:30', 'manual', 'a'), s(1, D, '12:00:20', '0:00:30', 'auto', 'b')]);
    assert.equal(rest.length, 0);
    assert.equal(i.startMs, at(D, '12:00:00'));
    assert.equal(i.endMs, at(D, '12:00:50'));
    assert.deepEqual(i.activationIds, ['a', 'b']);
    assert.deepEqual(i.activationTypes.sort(), ['auto', 'manual']);
  });

  it('keeps ON when a short activation is nested inside a long one', () => {
    const [i] = intervalsOf([s(1, D, '12:00:00', '0:01:00'), s(1, D, '12:00:10', '0:00:05')]);
    assert.equal(i.endMs, at(D, '12:01:00')); // the short run ending first must not switch it OFF
  });

  it('chains overlaps A->B->C into one interval', () => {
    const intervals = intervalsOf([
      s(1, D, '12:00:00', '0:00:10'),
      s(1, D, '12:00:08', '0:00:10'),
      s(1, D, '12:00:16', '0:00:10'),
    ]);
    assert.equal(intervals.length, 1);
    assert.equal(intervals[0].endMs, at(D, '12:00:26'));
  });

  it('merges back-to-back activations (end == next start) without a spurious OFF', () => {
    const intervals = intervalsOf([s(1, D, '14:30:00', '0:00:14'), s(1, D, '14:30:14', '0:00:14')]);
    assert.equal(intervals.length, 1);
    assert.equal(intervals[0].durationMs, 28_000);
  });

  it('ignores zero-length activations', () => {
    assert.equal(intervalsOf([s(1, D, '12:00:00', '0:00:00')]).length, 0);
  });

  it('handles an activation that crosses midnight', () => {
    const [i] = intervalsOf([s(1, D, '23:59:50', '0:00:30')]);
    assert.equal(i.end, '2026-11-11T00:00:20.000+01:00');
  });

  it('emits chronological ON/OFF transitions', () => {
    const intervals = intervalsOf([s(1, D, '12:00:00', '0:00:10'), s(1, D, '12:00:05', '0:00:10'), s(1, D, '13:00:00', '0:00:10')]);
    const t = buildTransitions(intervals, TZ);
    assert.deepEqual(t.map((x) => x.state), ['ON', 'OFF', 'ON', 'OFF']);
    assert.deepEqual(t.map((x) => x.epochMs), [at(D, '12:00:00'), at(D, '12:00:15'), at(D, '13:00:00'), at(D, '13:00:10')]);
    const limited = buildTransitions(intervals, TZ, at(D, '12:30:00'), at(D, '14:00:00'));
    assert.equal(limited.length, 2);
  });
});

describe('SprinklerService.state', () => {
  const docs = [
    s(1, D, '12:00:00', '0:01:00', 'manual', 'long'),
    s(1, D, '12:00:10', '0:00:05', 'auto', 'nested'),
    s(2, D, '12:00:00', '0:05:00', 'auto', 'other-zone'),
  ];
  const svc = (now = at(D, '12:00:00')) => new SprinklerService(new ArraySource([], docs), settings, () => now);

  it('is ON during an activation and OFF before and after (start inclusive, end exclusive)', async () => {
    assert.equal((await svc().state(1, at(D, '11:59:59'))).state, 'OFF');
    assert.equal((await svc().state(1, at(D, '12:00:00'))).state, 'ON');
    assert.equal((await svc().state(1, at(D, '12:00:59'))).state, 'ON');
    assert.equal((await svc().state(1, at(D, '12:01:00'))).state, 'OFF');
  });

  it('stays ON after a nested activation ended, until all active ones are over', async () => {
    const r = await svc().state(1, at(D, '12:00:30')); // nested ended at 12:00:15
    assert.equal(r.state, 'ON');
    assert.equal(r.isOn, true);
    assert.deepEqual(r.activeActivations.map((a) => a.id), ['long']);
    assert.equal(r.onUntilMs, at(D, '12:01:00'));
  });

  it('reports every overlapping active activation', async () => {
    const r = await svc().state(1, at(D, '12:00:12'));
    assert.deepEqual(r.activeActivations.map((a) => a.id), ['long', 'nested']);
  });

  it('never uses another zone', async () => {
    assert.equal((await svc().state(3, at(D, '12:00:30'))).state, 'OFF');
    const zone2 = await svc().state(2, at(D, '12:00:30'));
    assert.equal(zone2.state, 'ON');
    assert.deepEqual(zone2.activeActivations.map((a) => a.id), ['other-zone']);
    // even if the data source leaks other zones, the service filters them out
    const leaky = new SprinklerService(new LeakyZoneSource([], docs), settings, () => 0);
    assert.deepEqual((await leaky.state(1, at(D, '12:00:12'))).activeActivations.map((a) => a.id), ['long', 'nested']);
  });

  it('reports the last activation, ignoring future ones', async () => {
    const r = await svc().state(1, at(D, '12:30:00'));
    assert.equal(r.lastActivation?.id, 'nested');
    const before = await svc().state(1, at(D, '11:00:00'));
    assert.equal(before.lastActivation, null);
    assert.equal(before.state, 'OFF');
  });

  it('finds the last activation on an older day', async () => {
    const old = new SprinklerService(new ArraySource([], [s(1, '31-10-2026', '08:00:00', '0:00:14', 'auto', 'old'), s(1, '01-11-2026', '08:00:00', '0:00:14', 'manual', 'newer')]), settings, () => at(D, '12:00:00'));
    const r = await old.state(1);
    assert.equal(r.state, 'OFF');
    assert.equal(r.lastActivation?.id, 'newer'); // 01-11 is later than 31-10, though it sorts first as text
  });

  it('sees an activation that started before midnight and is still running after it', async () => {
    const night = new SprinklerService(new ArraySource([], [s(1, D, '23:59:50', '0:00:30', 'auto', 'night')]), settings, () => 0);
    const r = await night.state(1, at('11-11-2026', '00:00:10'));
    assert.equal(r.state, 'ON');
    assert.equal(r.onUntil, '2026-11-11T00:00:20.000+01:00');
  });

  it('labels where the evaluation time came from', async () => {
    assert.equal((await svc().state(1)).evaluatedAtSource, 'system-clock');
    assert.equal((await svc().state(1, at(D, '12:00:30'))).evaluatedAtSource, 'query');
    const mock = new SprinklerService(new ArraySource([], docs), settings, () => at(D, '12:00:30'), 'mock-now');
    const r = await mock.state(1);
    assert.equal(r.evaluatedAtSource, 'mock-now');
    assert.equal(r.state, 'ON');
  });

  it('counts invalid records instead of failing', async () => {
    const bad = new SprinklerService(new ArraySource([], [s(1, D, '12:00:00', 'oops'), s(1, D, '12:00:00', '0:00:30')]), settings, () => 0);
    const r = await bad.state(1, at(D, '12:00:10'));
    assert.equal(r.invalidRecords, 1);
    assert.equal(r.state, 'ON');
  });
});

describe('SprinklerService.history', () => {
  const docs = [
    s(1, D, '11:58:30', '0:03:45.250000', 'manual', 'early'), // ends 12:02:15.25
    s(1, D, '12:20:15', '0:00:14.015384', 'auto', 'a1'),
    s(1, D, '14:10:00', '0:00:45', 'manual', 'm1'),
    s(1, D, '14:10:20', '0:00:14.015384 ', 'auto', 'a2'),
    s(2, D, '12:30:00', '0:00:10', 'auto', 'z2'),
  ];
  const svc = () => new SprinklerService(new ArraySource([], docs), settings);

  it('returns activations with runtime, type, end time, intervals and transitions for one zone', async () => {
    const r = await svc().history(1, { fromMs: at(D, '12:10:00'), toMs: at(D, '15:00:00') });
    assert.equal(r.place, 1);
    assert.deepEqual(r.activations.map((a) => a.id), ['a1', 'm1', 'a2']);
    assert.equal(r.activations[0].runTimeMs, 14015);
    assert.equal(r.activations[1].activationType, 'manual');
    assert.equal(r.intervals.length, 2); // m1 + a2 merged
    assert.deepEqual(r.intervals[1].activationIds, ['m1', 'a2']);
    assert.equal(r.intervals[1].endMs, at(D, '14:10:45'));
    assert.deepEqual(r.transitions.map((t) => t.state), ['ON', 'OFF', 'ON', 'OFF']);
    assert.equal(r.stateAtWindowStart, 'OFF');
    assert.equal(r.count, 3);
  });

  it('includes an activation that began before the window and is ON at its start', async () => {
    const r = await svc().history(1, { fromMs: at(D, '12:00:00'), toMs: at(D, '12:30:00') });
    assert.equal(r.stateAtWindowStart, 'ON');
    assert.deepEqual(r.activations.map((a) => a.id), ['early', 'a1']);
    assert.deepEqual(r.transitions.map((t) => t.state), ['OFF', 'ON', 'OFF']); // first event is the early run ending
  });

  it('defaults to a window ending at the newest activation', async () => {
    const r = await svc().history(1, {});
    // anchored at the end of the most recently *started* activation (a2: 14:10:20 + 14.015 s)
    const anchor = at(D, '14:10:20') + 14_015;
    assert.equal(r.window?.toMs, anchor);
    assert.equal(r.window?.fromMs, anchor - 120 * 60_000);
    assert.deepEqual(r.activations.map((a) => a.id), ['a1', 'm1', 'a2']); // 'early' (11:58) is outside the 2 h window
  });

  it('returns an empty history (no window) when the zone has no activations', async () => {
    const r = await svc().history(3, {});
    assert.equal(r.window, null);
    assert.equal(r.count, 0);
    assert.deepEqual(r.intervals, []);
  });

  it('is zone specific', async () => {
    const r = await svc().history(2, { fromMs: at(D, '12:00:00'), toMs: at(D, '13:00:00') });
    assert.deepEqual(r.activations.map((a) => a.id), ['z2']);
  });
});
