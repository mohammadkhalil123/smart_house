import {
  ApiLatestResponse,
  ApiReading,
  ApiSeriesBlock,
  ApiSeriesResponse,
  ApiSprinklerHistoryResponse,
  ApiSprinklerStateResponse,
} from '../models/api.model';
import { SensorView, SprinklerEvent, SprinklerView, ZoneView } from '../models/zone.model';

function sensor(block: ApiSeriesBlock, latest: ApiReading | null): SensorView {
  return {
    current: latest ? latest.value : null,
    unit: latest?.unit ?? block.unit ?? '',
    points: block.points.map((p) => ({ t: p.epochMs, v: p.value })),
  };
}

/**
 * Step-chart events for the chart window: the state at the window start, then every
 * reconstructed ON/OFF switch. Returns [] when the window is unknown.
 */
export function buildSprinklerEvents(
  history: ApiSprinklerHistoryResponse,
  from: number | null,
  to: number | null,
): SprinklerEvent[] {
  if (from === null || to === null) return [];
  const events: SprinklerEvent[] = [{ t: from, v: history.stateAtWindowStart === 'ON' ? 1 : 0 }];
  for (const tr of history.transitions) {
    if (tr.epochMs > from && tr.epochMs <= to) events.push({ t: tr.epochMs, v: tr.state === 'ON' ? 1 : 0 });
  }
  return events;
}

function sprinkler(
  state: ApiSprinklerStateResponse,
  history: ApiSprinklerHistoryResponse,
  from: number | null,
  to: number | null,
): SprinklerView {
  const last = state.lastActivation;
  return {
    on: state.isOn,
    onUntilMs: state.onUntilMs,
    last: last ? { startMs: last.startMs, runTimeSeconds: last.runTimeSeconds, type: last.activationType } : null,
    events: buildSprinklerEvents(history, from, to),
  };
}

/** Combines the four backend responses of one zone into the dashboard's view model. */
export function buildZoneView(
  latest: ApiLatestResponse,
  series: ApiSeriesResponse,
  state: ApiSprinklerStateResponse,
  history: ApiSprinklerHistoryResponse,
): ZoneView {
  const from = series.window?.fromMs ?? history.window?.fromMs ?? null;
  const to = series.window?.toMs ?? history.window?.toMs ?? null;
  return {
    place: series.place,
    timeZone: series.meta.timeZone,
    isMock: series.meta.isMock,
    windowStart: from,
    windowEnd: to,
    temperature: sensor(series.temperature, latest.temperature),
    humidity: sensor(series.humidity, latest.humidity),
    luminosity: sensor(series.luminosity, latest.luminosity),
    sprinkler: sprinkler(state, history, from, to),
  };
}

/** Cheap change detection so polling does not redraw the charts when nothing changed. */
export function sameView(a: ZoneView | null, b: ZoneView): boolean {
  if (!a || a.place !== b.place) return false;
  const sig = (v: ZoneView): string =>
    JSON.stringify([
      v.windowStart,
      v.windowEnd,
      v.isMock,
      [v.temperature, v.humidity, v.luminosity].map((s) => [s.current, s.unit, s.points.length, s.points.at(-1)?.t]),
      v.sprinkler,
    ]);
  return sig(a) === sig(b);
}
