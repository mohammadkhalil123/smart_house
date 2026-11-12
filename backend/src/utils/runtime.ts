/**
 * Parses the sprinkler `run_time` field into milliseconds.
 *
 * Accepted shapes (Python `str(timedelta)` style), with optional surrounding whitespace:
 *   "0:00:14"            "0:00:14.015384"        "00:01:05.5"
 *   "1 day, 0:00:14"     "2 days, 1:02:03.250000"
 *
 * Sub-millisecond precision is rounded to the nearest millisecond. Anything else
 * (empty, negative, minutes/seconds >= 60, non-string) returns null.
 */
const RUNTIME_RE = /^(?:(\d+)\s+days?,\s*)?(\d+):(\d{1,2}):(\d{1,2})(?:\.(\d{1,9}))?$/;

export function parseRunTimeMs(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const m = RUNTIME_RE.exec(raw.trim());
  if (!m) return null;

  const days = m[1] ? Number(m[1]) : 0;
  const hours = Number(m[2]);
  const minutes = Number(m[3]);
  const seconds = Number(m[4]);
  if (minutes >= 60 || seconds >= 60) return null;

  const fraction = m[5] ? Number(`0.${m[5]}`) : 0;
  const totalSeconds = ((days * 24 + hours) * 60 + minutes) * 60 + seconds + fraction;
  const ms = Math.round(totalSeconds * 1000);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}
