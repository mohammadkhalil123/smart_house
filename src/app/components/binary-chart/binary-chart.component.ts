import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild } from '@angular/core';
import { Chart, ChartOptions, registerables } from 'chart.js';
import { SprinklerEvent } from '../../models/zone.model';
import { formatTime, timeTicks } from '../../utils/time-axis';

Chart.register(...registerables);

type Point = { x: number; y: number };

/** Step chart of the sprinkler ON/OFF history: 1 = ON, 0 = OFF. */
@Component({
  selector: 'app-binary-chart',
  templateUrl: './binary-chart.component.html',
  styleUrl: './binary-chart.component.scss',
})
export class BinaryChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) events: SprinklerEvent[] = [];
  /** Time range shown on the X axis (epoch ms); defaults to the first/last event. */
  @Input() windowStart: number | null = null;
  @Input() windowEnd: number | null = null;
  @Input() timeZone?: string;

  get hasActivation(): boolean {
    return this.events.some((e) => e.v === 1);
  }

  @ViewChild('canvas', { static: true }) canvas!: ElementRef<HTMLCanvasElement>;

  private chart?: Chart<'line', Point[]>;

  private viewReady = false;

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.render();
  }

  ngOnChanges(): void {
    if (this.viewReady) this.render();
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  private render(): void {
    this.chart?.destroy();
    this.chart = undefined;
    if (!this.events.length) return;

    const last = this.events[this.events.length - 1];
    const min = this.windowStart ?? this.events[0].t;
    let end = Math.max(this.windowEnd ?? last.t, last.t);
    if (end <= min) end = min + 30 * 60_000;
    // Extend the final state to the right edge of the window.
    const points: Point[] = [...this.events.map((e) => ({ x: e.t, y: e.v })), { x: end, y: last.v }];
    const grid = 'rgba(120,160,220,0.18)';
    const tick = '#9fb3d1';

    const options: ChartOptions<'line'> = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: {
            title: (items) => this.fmt(Number(items[0].parsed.x)),
            label: (item) => (item.parsed.y === 1 ? 'Sprinkler ON' : 'Sprinkler OFF'),
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          min,
          max: end,
          afterBuildTicks: (axis) => {
            axis.ticks = timeTicks(min, end).map((value) => ({ value }));
          },
          ticks: { color: tick, callback: (v) => this.fmt(Number(v)), maxRotation: 0 },
          grid: { color: grid },
          border: { color: tick },
        },
        y: {
          min: -0.2,
          max: 1.2,
          afterBuildTicks: (axis) => {
            axis.ticks = [{ value: 0 }, { value: 1 }];
          },
          ticks: { color: tick, font: { size: 15 } },
          grid: { color: grid },
          border: { color: tick },
        },
      },
    };

    this.chart = new Chart<'line', Point[]>(this.canvas.nativeElement, {
      type: 'line',
      data: {
        datasets: [
          {
            data: points,
            stepped: 'after',
            borderColor: '#22e06b',
            borderWidth: 3,
            pointRadius: 0,
            pointHoverRadius: 5,
            fill: false,
          },
        ],
      },
      options,
    });
  }

  private fmt(ms: number): string {
    return formatTime(ms, this.timeZone);
  }
}
