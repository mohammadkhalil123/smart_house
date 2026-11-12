import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GreenhouseService } from '../../services/greenhouse.service';
import { AppHeaderComponent } from '../app-header/app-header.component';
import { GreenhouseArtComponent } from '../greenhouse-art/greenhouse-art.component';

@Component({
  selector: 'app-zone-selection',
  imports: [RouterLink, AppHeaderComponent, GreenhouseArtComponent],
  templateUrl: './zone-selection.component.html',
  styleUrl: './zone-selection.component.scss',
})
export class ZoneSelectionComponent {
  private readonly service = inject(GreenhouseService);
  readonly zones = this.service.zones;
  readonly status = this.service.zonesStatus;
  readonly error = this.service.zonesError;

  retry(): void {
    this.service.loadZones();
  }
}
