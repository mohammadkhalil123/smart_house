import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, catchError, exhaustMap, forkJoin, map, of, scan, startWith, switchMap, timer } from 'rxjs';
import { HEALTH_INTERVAL_MS, POLL_INTERVAL_MS } from '../config/api.config';
import { ApiErrorBody } from '../models/api.model';
import { ZoneInfo, ZoneView, accentFor } from '../models/zone.model';
import { GreenhouseApiService } from './greenhouse-api.service';
import { buildZoneView, sameView } from './zone-view.mapper';

export type LoadStatus = 'loading' | 'ready' | 'error';

export interface ZoneState {
  status: LoadStatus;
  view: ZoneView | null;
  /** Set when the latest refresh failed; `view` may still hold the previous data. */
  error: string | null;
}

export interface BackendStatus {
  status: LoadStatus;
  isMock: boolean;
}

export const LOADING_STATE: ZoneState = { status: 'loading', view: null, error: null };

export function describeError(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'Cannot reach the backend. Is it running on port 3000?';
    const body = err.error as Partial<ApiErrorBody> | null;
    if (body?.error?.message) return body.error.message;
    return `The backend answered with an error (HTTP ${err.status}).`;
  }
  return 'Unexpected error while loading data.';
}

/**
 * Talks to the backend through GreenhouseApiService. Components never know whether the
 * records come from the mock JSON files or from MongoDB.
 */
@Injectable({ providedIn: 'root' })
export class GreenhouseService {
  private readonly api = inject(GreenhouseApiService);

  readonly zones = signal<ZoneInfo[]>([]);
  readonly zonesStatus = signal<LoadStatus>('loading');
  readonly zonesError = signal<string | null>(null);
  readonly backend = signal<BackendStatus>({ status: 'loading', isMock: false });

  constructor() {
    this.loadZones();

    timer(0, HEALTH_INTERVAL_MS)
      .pipe(
        exhaustMap(() =>
          this.api.health().pipe(
            map((h): BackendStatus => ({ status: h.status === 'ok' ? 'ready' : 'error', isMock: h.isMock })),
            catchError(() => of<BackendStatus>({ status: 'error', isMock: false })),
          ),
        ),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((s) => this.backend.set(s));
  }

  loadZones(): void {
    this.zonesStatus.set('loading');
    this.zonesError.set(null);
    this.api.zones().subscribe({
      next: (r) => {
        this.zones.set(r.zones.map((z) => ({ ...z, accent: accentFor(z.place) })));
        this.zonesStatus.set('ready');
      },
      error: (err: unknown) => {
        this.zonesError.set(describeError(err));
        this.zonesStatus.set('error');
      },
    });
  }

  /** Reads everything for one zone. All requests carry the same `place`. */
  loadZone(place: number): Observable<ZoneView> {
    return forkJoin({
      latest: this.api.latest(place),
      series: this.api.series(place),
      state: this.api.sprinklerState(place),
    }).pipe(
      // The sprinkler history uses the chart window, which the series response defines.
      switchMap((r) =>
        this.api.sprinklerHistory(place, r.series.window).pipe(map((history) => buildZoneView(r.latest, r.series, r.state, history))),
      ),
    );
  }

  /**
   * Loads a zone now and then every POLL_INTERVAL_MS. A failed refresh keeps the last good data
   * and reports the error; an unchanged result keeps the same object so charts are not redrawn.
   */
  watchZone(place: number): Observable<ZoneState> {
    type Result = { ok: true; view: ZoneView } | { ok: false; message: string };
    return timer(0, POLL_INTERVAL_MS).pipe(
      exhaustMap(() =>
        this.loadZone(place).pipe(
          map((view): Result => ({ ok: true, view })),
          catchError((err: unknown) => of<Result>({ ok: false, message: describeError(err) })),
        ),
      ),
      scan((state: ZoneState, r: Result): ZoneState => {
        if (r.ok) {
          const view = sameView(state.view, r.view) ? state.view : r.view;
          return { status: 'ready', view, error: null };
        }
        return { status: state.view ? 'ready' : 'error', view: state.view, error: r.message };
      }, LOADING_STATE),
      startWith(LOADING_STATE),
    );
  }
}
