import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL, WINDOW_MINUTES } from '../config/api.config';
import {
  ApiHealth,
  ApiLatestResponse,
  ApiSeriesResponse,
  ApiSprinklerHistoryResponse,
  ApiSprinklerStateResponse,
  ApiTimeWindow,
  ApiZonesResponse,
} from '../models/api.model';

/** Thin typed wrapper over the REST endpoints. Every data call carries the selected zone (`place`). */
@Injectable({ providedIn: 'root' })
export class GreenhouseApiService {
  private readonly http = inject(HttpClient);

  health(): Observable<ApiHealth> {
    return this.http.get<ApiHealth>(`${API_BASE_URL}/health`);
  }

  zones(): Observable<ApiZonesResponse> {
    return this.http.get<ApiZonesResponse>(`${API_BASE_URL}/zones`);
  }

  latest(place: number): Observable<ApiLatestResponse> {
    return this.http.get<ApiLatestResponse>(`${API_BASE_URL}/measures/latest`, { params: this.zone(place) });
  }

  series(place: number): Observable<ApiSeriesResponse> {
    const params = this.zone(place).set('windowMinutes', WINDOW_MINUTES);
    return this.http.get<ApiSeriesResponse>(`${API_BASE_URL}/measures/series`, { params });
  }

  sprinklerState(place: number): Observable<ApiSprinklerStateResponse> {
    return this.http.get<ApiSprinklerStateResponse>(`${API_BASE_URL}/sprinkler/state`, { params: this.zone(place) });
  }

  /** History for the same window as the charts (ISO "Z" instants avoid "+" in the URL). */
  sprinklerHistory(place: number, window: ApiTimeWindow | null): Observable<ApiSprinklerHistoryResponse> {
    let params = this.zone(place);
    if (window) {
      params = params
        .set('from', new Date(window.fromMs).toISOString())
        .set('to', new Date(window.toMs).toISOString());
    }
    return this.http.get<ApiSprinklerHistoryResponse>(`${API_BASE_URL}/sprinkler/history`, { params });
  }

  private zone(place: number): HttpParams {
    return new HttpParams().set('place', place);
  }
}
