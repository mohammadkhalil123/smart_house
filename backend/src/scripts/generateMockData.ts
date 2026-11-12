/**
 * Generates the deterministic demo dataset (backend/data/Measures.json and Sprinkler.json).
 * Fixed seed: running it again always produces byte-identical files.
 *
 *   npm run mock:generate
 *
 * The documents use exactly the structure of the real MongoDB collections.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { RawMeasureDoc, RawSprinklerDoc } from '../models/types';
import { dateToDayNumber, parseDateString } from '../utils/dateTime';

const SEED = 20261110;
const DAY = '10-11-2026';
const START_SECOND = 12 * 3600; // 12:00:00
const END_SECOND = 15 * 3600; //   15:00:00 (exclusive)

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED);
let idCounter = 0;

/** 24 hex characters; the first 8 are a bijective mix of a counter, so ids are unique. */
function nextId(): string {
  idCounter++;
  const head = (Math.imul(idCounter, 2654435761) >>> 0).toString(16).padStart(8, '0');
  let tail = '';
  for (let i = 0; i < 4; i++) tail += Math.floor(rand() * 0x10000).toString(16).padStart(4, '0');
  return head + tail;
}

const p2 = (n: number): string => String(n).padStart(2, '0');
const hms = (s: number): string => `${p2(Math.floor(s / 3600))}:${p2(Math.floor((s % 3600) / 60))}:${p2(s % 60)}`;

interface ZoneProfile {
  tmp: { base: number; amp: number; phase: number };
  hum: { base: number; amp: number; phase: number };
  lum: { base: number; amp: number; phase: number };
}

const PROFILES: Record<number, ZoneProfile> = {
  1: { tmp: { base: 22.5, amp: 1.4, phase: 0.4 }, hum: { base: 255, amp: 14, phase: 1.1 }, lum: { base: 750, amp: 170, phase: 0.2 } },
  2: { tmp: { base: 27.6, amp: 2.6, phase: 1.3 }, hum: { base: 312, amp: 18, phase: 2.0 }, lum: { base: 920, amp: 190, phase: 0.9 } },
  3: { tmp: { base: 21.3, amp: 1.1, phase: 2.2 }, hum: { base: 205, amp: 11, phase: 0.5 }, lum: { base: 580, amp: 140, phase: 1.7 } },
};

const TYPE_OFFSET: Record<'Tmp' | 'Hum' | 'Lum', number> = { Tmp: 0, Hum: 1, Lum: 2 };

function wave(t: number, period: number, phase: number): number {
  return Math.sin((2 * Math.PI * t) / period + phase);
}

function valueFor(type: 'Tmp' | 'Hum' | 'Lum', p: ZoneProfile, t: number): string {
  const elapsedHours = t / 3600;
  switch (type) {
    case 'Tmp': {
      const v = p.tmp.base + p.tmp.amp * wave(t, 9400, p.tmp.phase) + p.tmp.amp * 0.25 * wave(t, 840, 0) + 0.25 * elapsedHours + (rand() - 0.5) * 0.3;
      return v.toFixed(1);
    }
    case 'Hum': {
      const v = p.hum.base + p.hum.amp * wave(t, 7200, p.hum.phase) - 3 * elapsedHours + (rand() - 0.5) * 6;
      return String(Math.round(v));
    }
    case 'Lum': {
      const cloud = wave(t, 2300, 0.8) > 0.93 ? -260 : 0; // short passing clouds
      const v = p.lum.base + p.lum.amp * wave(t, 6200, p.lum.phase) + cloud + (rand() - 0.5) * 50;
      return String(Math.max(0, Math.round(v)));
    }
  }
}

interface Keyed<T> {
  key: number;
  doc: T;
}

function sortKey(date: string, time: string): number {
  const d = parseDateString(date);
  if (!d) throw new Error(`bad date ${date}`);
  const [h, m, s] = time.split(':').map(Number);
  return dateToDayNumber(d) * 86400 + h * 3600 + m * 60 + s;
}

function measures(): RawMeasureDoc[] {
  const out: Keyed<RawMeasureDoc>[] = [];
  const push = (type: string, value: string, place: number, date: string, time: string): void => {
    out.push({ key: sortKey(date, time), doc: { _id: nextId(), measure_type: type, value, place, date, date_hour: time } });
  };

  for (const place of [1, 2, 3]) {
    const profile = PROFILES[place];
    for (const type of ['Tmp', 'Hum', 'Lum'] as const) {
      // Zone 3 luminosity sensor stalls at 14:52:30: its newest record is older than the other types.
      const stopAt = place === 3 && type === 'Lum' ? 14 * 3600 + 52 * 60 + 30 : END_SECOND;
      let s = START_SECOND + TYPE_OFFSET[type] + place; // different phase per zone and type
      while (s < stopAt) {
        const inGap = place === 2 && type === 'Hum' && s >= 13 * 3600 + 20 * 60 && s < 13 * 3600 + 21 * 60; // 1 min without humidity
        if (!inGap && rand() >= 0.02) push(type, valueFor(type, profile, s - START_SECOND), place, DAY, hms(s));
        s += 8 + (rand() < 0.25 ? 1 : 0); // about every 8 seconds
      }
    }
  }

  // A few older records across a month boundary, to catch date-sorting bugs
  // ("31-10-2026" sorts after "10-11-2026" if dates are compared as strings).
  const older: [string, string][] = [
    ['31-10-2026', '23:58:41'],
    ['01-11-2026', '00:03:12'],
    ['09-11-2026', '18:00:05'],
  ];
  for (const place of [1, 2, 3]) {
    const profile = PROFILES[place];
    for (const type of ['Tmp', 'Hum', 'Lum'] as const) {
      older.forEach(([date, time], i) => push(type, valueFor(type, profile, 600 + i * 1700), place, date, time));
    }
  }

  return out.sort((a, b) => a.key - b.key).map((k) => k.doc);
}

function sprinkler(): RawSprinklerDoc[] {
  const out: Keyed<RawSprinklerDoc>[] = [];
  const add = (place: number, date: string, time: string, type: 'auto' | 'manual', runTime: string): void => {
    out.push({
      key: sortKey(date, time),
      doc: { _id: nextId(), run_time: runTime, place, date, date_hour: time, activation_type: type },
    });
  };

  // Zone 1: includes overlapping runs (manual 14:10:00 + auto 14:10:20 + auto 14:10:40) and a run
  // that started just before the main day's measurements.
  add(1, '09-11-2026', '18:00:30', 'auto', '0:00:14.201733');
  add(1, DAY, '11:58:30', 'manual', '0:03:45.250000');
  add(1, DAY, '12:20:15', 'auto', '0:00:14.015384');
  add(1, DAY, '13:05:42', 'auto', '0:00:13.987201');
  add(1, DAY, '13:30:05', 'manual', '0:00:32.500000');
  add(1, DAY, '14:10:00', 'manual', '0:00:45');
  add(1, DAY, '14:10:20', 'auto', '0:00:14.015384 '); // trailing whitespace, fully inside the manual run
  add(1, DAY, '14:10:40', 'auto', '0:00:14.102233'); // starts inside, ends after the manual run
  add(1, DAY, '14:45:50', 'auto', '0:00:14.015384');

  // Zone 2: a short run nested inside a longer manual run.
  add(2, DAY, '12:40:10', 'auto', '0:00:14.000000');
  add(2, DAY, '13:15:30', 'manual', '0:01:00');
  add(2, DAY, '13:15:50', 'auto', '0:00:20.500000');
  add(2, DAY, '14:05:00', 'auto', '0:00:14.4 ');
  add(2, DAY, '14:55:12', 'auto', '0:00:14.015384');

  // Zone 3: two back-to-back runs (the first ends exactly when the second starts).
  add(3, DAY, '12:10:00', 'auto', '0:00:14.2 ');
  add(3, DAY, '13:45:20', 'manual', '0:00:25.123456');
  add(3, DAY, '14:30:00', 'auto', '0:00:14');
  add(3, DAY, '14:30:14', 'auto', '0:00:14');

  return out.sort((a, b) => a.key - b.key).map((k) => k.doc);
}

function toJsonLines(docs: object[]): string {
  return `[\n${docs.map((d) => `  ${JSON.stringify(d)}`).join(',\n')}\n]\n`;
}

async function main(): Promise<void> {
  const dir = path.resolve(__dirname, '..', '..', 'data');
  await fs.mkdir(dir, { recursive: true });
  const m = measures();
  const s = sprinkler();
  await fs.writeFile(path.join(dir, 'Measures.json'), toJsonLines(m), 'utf8');
  await fs.writeFile(path.join(dir, 'Sprinkler.json'), toJsonLines(s), 'utf8');
  console.log(`Wrote ${m.length} measures and ${s.length} sprinkler activations to ${dir}`);
}

void main();
