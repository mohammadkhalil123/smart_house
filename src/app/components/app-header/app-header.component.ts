import { DatePipe } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GreenhouseService } from '../../services/greenhouse.service';

@Component({
  selector: 'app-header',
  imports: [DatePipe, RouterLink],
  templateUrl: './app-header.component.html',
  styleUrl: './app-header.component.scss',
})
export class AppHeaderComponent implements OnDestroy {
  readonly now = signal(new Date());
  private readonly timer = setInterval(() => this.now.set(new Date()), 1000);
  private readonly backend = inject(GreenhouseService).backend;

  /** "Live" only when the backend reads the real database; demo records are labelled as such. */
  readonly badge = computed(() => {
    const b = this.backend();
    if (b.status === 'loading') return { text: 'Connecting…', kind: 'pending' };
    if (b.status === 'error') return { text: 'Backend offline', kind: 'offline' };
    return b.isMock ? { text: 'Mock data', kind: 'mock' } : { text: 'Live', kind: 'live' };
  });

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }
}
