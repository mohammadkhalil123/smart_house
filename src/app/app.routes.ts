import { Routes } from '@angular/router';
import { ZoneSelectionComponent } from './components/zone-selection/zone-selection.component';
import { ZoneDashboardComponent } from './components/zone-dashboard/zone-dashboard.component';

export const routes: Routes = [
  { path: '', component: ZoneSelectionComponent, title: 'Smart Greenhouse' },
  { path: 'zone', redirectTo: 'zone/1', pathMatch: 'full' }, // Zone 1 is the default zone
  { path: 'zone/:id', component: ZoneDashboardComponent, title: 'Zone – Smart Greenhouse' },
  { path: '**', redirectTo: '' },
];
