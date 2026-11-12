import { Component, computed, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { BehaviorSubject, combineLatest, of, switchMap } from 'rxjs';
import { THRESHOLDS } from '../../config/dashboard.config';
import { GreenhouseService, LOADING_STATE, ZoneState } from '../../services/greenhouse.service';
import { AppHeaderComponent } from '../app-header/app-header.component';
import { BinaryChartComponent } from '../binary-chart/binary-chart.component';
import { SensorCardComponent } from '../sensor-card/sensor-card.component';
import { SprinklerControlComponent } from '../sprinkler-control/sprinkler-control.component';

@Component({
  selector: 'app-zone-dashboard',
  imports: [RouterLink, RouterLinkActive, AppHeaderComponent, SensorCardComponent, SprinklerControlComponent, BinaryChartComponent],
  templateUrl: './zone-dashboard.component.html',
  styleUrl: './zone-dashboard.component.scss',
})
export class ZoneDashboardComponent {
  private readonly service = inject(GreenhouseService);

  /** Bound from the `:id` route parameter (withComponentInputBinding). */
  readonly id = input<string>();

  /** Display-only thresholds for the Temperature / Humidity charts. */
  readonly maxTemperature = THRESHOLDS.temperatureMax;
  readonly maxHumidity = THRESHOLDS.humidityMax;

  readonly zones = this.service.zones;

  /** Selected zone number, or null when the URL is not a number. */
  readonly place = computed(() => {
    const id = this.id();
    return id !== undefined && /^\d+$/.test(id) ? Number(id) : null;
  });

  /** True when the zone is unknown (bad URL, or not in the list the backend returned). */
  readonly missing = computed(() => {
    const place = this.place();
    if (place === null) return true;
    return this.service.zonesStatus() === 'ready' && !this.zones().some((z) => z.place === place);
  });

  readonly zoneInfo = computed(() => this.zones().find((z) => z.place === this.place()));

  private readonly reload$ = new BehaviorSubject(0);

  /** Re-created whenever the selected zone changes, so data from two zones is never shown together. */
  readonly state = toSignal(
    combineLatest([toObservable(this.place), this.reload$]).pipe(
      switchMap(([place]) => (place === null ? of(LOADING_STATE) : this.service.watchZone(place))),
    ),
    { initialValue: LOADING_STATE as ZoneState },
  );

  readonly view = computed(() => this.state().view);

  retry(): void {
    this.reload$.next(this.reload$.value + 1);
  }
}
