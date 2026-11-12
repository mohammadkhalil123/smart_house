/**
 * Date/time helpers.
 *
 * The database stores local wall-clock time in two separate strings
 * (`date` = DD-MM-YYYY, `date_hour` = HH:mm:ss). They are combined and converted to an
 * absolute instant (epoch ms) using an explicit IANA time zone, never the server's zone
 * and never silently UTC.
 */

const DAY_MS = 86_400_000;

export interface LocalDate {
  year: number;
  month: number; // 1-12
  day: number;
}

export interface LocalTime {
  hour: number;
  minute: number;
  second: number;
}

export type LocalDateTime = LocalDate & LocalTime;

/* ------------------------------ time zones ------------------------------ */

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** Throws a RangeError when `timeZone` is not a valid IANA zone. */
export function assertValidTimeZone(timeZone: string): void {
  try {
    formatter(timeZone);
  } catch {
    throw new RangeError(`Invalid time zone: "${timeZone}"`);
  }
}

/** Offset of `timeZone` from UTC at the given instant, in ms (Paris in winter = +3_600_000). */
export function tzOffsetMs(epochMs: number, timeZone: string): number {
  const wholeSecond = Math.floor(epochMs / 1000) * 1000;
  const parts = formatter(timeZone).formatToParts(new Date(wholeSecond));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asUtc - wholeSecond;
}

/**
 * Converts a local wall-clock time in `timeZone` to epoch ms.
 *  - Ambiguous times (clocks going back) resolve to the first occurrence.
 *  - Non-existent times (clocks going forward) are shifted forward by the gap.
 */
export function localToEpochMs(local: LocalDateTime, timeZone: string): number {
  const guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  const candidateOffsets = new Set([tzOffsetMs(guess - DAY_MS, timeZone), tzOffsetMs(guess + DAY_MS, timeZone)]);
  const valid: number[] = [];
  for (const offset of candidateOffsets) {
    const t = guess - offset;
    if (tzOffsetMs(t, timeZone) === offset) valid.push(t);
  }
  if (valid.length > 0) return Math.min(...valid);
  return guess - tzOffsetMs(guess - DAY_MS, timeZone);
}

export function epochToLocal(epochMs: number, timeZone: string): LocalDateTime {
  const local = new Date(Math.floor(epochMs / 1000) * 1000 + tzOffsetMs(epochMs, timeZone));
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds(),
  };
}

const p2 = (n: number): string => String(n).padStart(2, '0');

/** DD-MM-YYYY, the database format. */
export function formatDateString(date: LocalDate): string {
  return `${p2(date.day)}-${p2(date.month)}-${String(date.year).padStart(4, '0')}`;
}

/** HH:mm:ss, the database format. */
export function formatTimeString(time: LocalTime): string {
  return `${p2(time.hour)}:${p2(time.minute)}:${p2(time.second)}`;
}

/** ISO 8601 with milliseconds and the zone's UTC offset, e.g. 2026-11-10T13:34:25.000+01:00. */
export function formatIsoWithOffset(epochMs: number, timeZone: string): string {
  const ms = Math.round(epochMs);
  const l = epochToLocal(ms, timeZone);
  const offsetMin = Math.round(tzOffsetMs(ms, timeZone) / 60_000);
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const millis = String(((ms % 1000) + 1000) % 1000).padStart(3, '0');
  return (
    `${String(l.year).padStart(4, '0')}-${p2(l.month)}-${p2(l.day)}T${p2(l.hour)}:${p2(l.minute)}:${p2(l.second)}` +
    `.${millis}${sign}${p2(Math.floor(abs / 60))}:${p2(abs % 60)}`
  );
}

/* ------------------------------- parsing -------------------------------- */

/** Strict DD-MM-YYYY; returns null for anything else, including impossible dates (31-02-2026). */
export function parseDateString(input: unknown): LocalDate | null {
  if (typeof input !== 'string') return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(input.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Strict HH:mm:ss (00:00:00 - 23:59:59). */
export function parseTimeString(input: unknown): LocalTime | null {
  if (typeof input !== 'string') return null;
  const m = /^(\d{2}):(\d{2}):(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = Number(m[3]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second };
}

/** Combines the stored `date` and `date_hour` strings into epoch ms, or null when either is invalid. */
export function parseMeasurementTimestamp(date: unknown, dateHour: unknown, timeZone: string): number | null {
  const d = parseDateString(date);
  const t = parseTimeString(dateHour);
  if (!d || !t) return null;
  return localToEpochMs({ ...d, ...t }, timeZone);
}

/**
 * Parses an ISO 8601 instant. An explicit offset ("Z", "+01:00") is honoured; without one
 * the value is read as local time in `timeZone` (it is never assumed to be UTC).
 * A date without a time means 00:00:00 local.
 */
export function parseInstant(input: unknown, timeZone: string): number | null {
  if (typeof input !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(
    input.trim(),
  );
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = m[4] ? Number(m[4]) : 0;
  const minute = m[5] ? Number(m[5]) : 0;
  const second = m[6] ? Number(m[6]) : 0;
  const millis = m[7] ? Number(m[7].padEnd(3, '0')) : 0;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;

  if (m[8]) {
    const zone = m[8].toUpperCase();
    let offsetMs = 0;
    if (zone !== 'Z') {
      const digits = zone.replace(':', '');
      const sign = digits.startsWith('-') ? -1 : 1;
      const oh = Number(digits.slice(1, 3));
      const om = Number(digits.slice(3, 5));
      if (oh > 23 || om > 59) return null;
      offsetMs = sign * (oh * 60 + om) * 60_000;
    }
    return Date.UTC(year, month - 1, day, hour, minute, second, millis) - offsetMs;
  }
  return localToEpochMs({ year, month, day, hour, minute, second }, timeZone) + millis;
}

/* --------------------------- day enumeration ---------------------------- */

/** Numeric value usable for sorting: days since epoch of the (calendar) date. */
export function dateToDayNumber(date: LocalDate): number {
  return Math.round(Date.UTC(date.year, date.month - 1, date.day) / DAY_MS);
}

export function dayNumberToDate(dayNumber: number): LocalDate {
  const d = new Date(dayNumber * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Local calendar day (as a day number) that contains the instant. */
export function epochToDayNumber(epochMs: number, timeZone: string): number {
  return dateToDayNumber(epochToLocal(epochMs, timeZone));
}

/**
 * DD-MM-YYYY strings of every local calendar day from the day containing `fromMs`
 * through the day containing `toMs`, oldest first.
 */
export function localDaysBetween(fromMs: number, toMs: number, timeZone: string): string[] {
  const first = epochToDayNumber(fromMs, timeZone);
  const last = epochToDayNumber(toMs, timeZone);
  const days: string[] = [];
  for (let n = first; n <= last; n++) days.push(formatDateString(dayNumberToDate(n)));
  return days;
}
