import { DecimalPipe } from '@angular/common';
import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild } from '@angular/core';
import { Chart, ChartOptions, Plugin, registerables } from 'chart.js';
import { SensorPoint } from '../../models/zone.model';
import { formatTime, timeTicks } from '../../utils/time-axis';

Chart.register(...registerables);

export type SensorType = 'temperature' | 'humidity' | 'luminosity';

const COLORS: Record<SensorType, string> = {
  temperature: '#1e90ff',
  humidity: '#22e06b',
  luminosity: '#ffb020',
};

const RED = '#ef2f45';
const GRID = 'rgba(120,160,220,0.18)';
const TICK = '#9fb3d1';

type Point = { x: number; y: number };

/**
 * Reusable card: icon, label, current value and a historical chart (timestamped points from the backend).
 * Default = compact sparkline (luminosity). With `detailed` = full chart with axes,
 * optional dotted maximum threshold and a marker on the highest reading.
 */
@Component({
  selector: 'app-sensor-card',
  imports: [DecimalPipe],
  templateUrl: './sensor-card.component.html',
  styleUrl: './sensor-card.component.scss',
})
export class SensorCardComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) type!: SensorType;
  @Input({ required: true }) label!: string;
  /** Latest reading; null when the zone has none. */
  @Input({ required: true }) value!: number | null;
  /** Unit label; empty when the stored unit is undefined. */
  @Input({ required: true }) unit!: string;
  @Input() digits = '1.0-0';
  @Input() points: SensorPoint[] = [];

  /** Detailed mode (axes, grid, tooltip). Leave off for the compact sparkline. */
  @Input() detailed = false;
  /** Maximum threshold drawn as a dotted red line (detailed mode only). */
  @Input() max?: number;
  @Input() maxLabel = 'MAX';
  /** Highlights the highest value of the history with a dot and label (detailed mode only). */
  @Input() markPeak = false;
  /** Y-axis tick spacing (detailed mode only). */
  @Input() yStep = 5;
  /** Suffix appended to Y ticks and the peak label, e.g. '%' (detailed mode only). */
  @Input() yUnit = '';
  /** Time range shown on the X axis (epoch ms); defaults to the first/last point (detailed mode only). */
  @Input() windowStart: number | null = null;
  @Input() windowEnd: number | null = null;
  /** IANA zone used to print times (the zone the data was recorded in). */
  @Input() timeZone?: string;

  @ViewChild('canvas', { static: true }) canvas!: ElementRef<HTMLCanvasElement>;

  private chart?: Chart<'line', any, any>;
  private viewReady = false;

  get color(): string {
    return COLORS[this.type];
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    if (this.detailed) {
      this.renderDetailed();
      return;
    }
    const color = this.color;
    this.chart = new Chart<'line', number[], number>(this.canvas.nativeElement, {
      type: 'line',
      data: {
        labels: this.points.map((_, i) => i),
        datasets: [
          {
            data: this.points.map((p) => p.v),
            borderColor: color,
            borderWidth: 3,
            tension: 0.4,
            pointRadius: 0,
            fill: true,
            backgroundColor: (c) => {
              const { ctx, chartArea } = c.chart;
              if (!chartArea) return 'transparent';
              const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
              g.addColorStop(0, color + '55');
              g.addColorStop(1, color + '00');
              return g;
            },
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500 },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false, grace: '15%' } },
      },
    });
  }

  ngOnChanges(): void {
    if (!this.viewReady) return;
    if (this.detailed) {
      this.renderDetailed();
      return;
    }
    if (!this.chart) return;
    this.chart.data.labels = this.points.map((_, i) => i);
    this.chart.data.datasets[0].data = this.points.map((p) => p.v);
    this.chart.update();
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  /** Plots the real timestamps over the requested window (no more "evenly spread, ending now"). */
  private renderDetailed(): void {
    this.chart?.destroy();
    this.chart = undefined;
    if (!this.points.length) return;

    const color = this.color;
    const values = this.points.map((p) => p.v);
    const first = this.points[0].t;
    const last = this.points[this.points.length - 1].t;
    const start = this.windowStart ?? first;
    let end = this.windowEnd ?? last;
    if (end <= start) end = start + 30 * 60_000;
    const points: Point[] = this.points.map((p) => ({ x: p.t, y: p.v }));

    // Y bounds: snap to the tick step and always leave the threshold inside the plot.
    const step = this.yStep;
    const lo = Math.min(...values);
    const hi = Math.max(...values, this.max ?? -Infinity);
    let yMin = Math.floor(lo / step) * step;
    if (lo - yMin < step * 0.25) yMin -= step;
    const yMax = Math.max(Math.ceil(hi / step) * step, yMin + step);

    const peak = this.markPeak ? points.reduce((a, b) => (b.y > a.y ? b : a)) : undefined;
    const unit = this.yUnit;
    const max = this.max;
    const maxLabel = this.maxLabel;
    const fmtVal = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

    // Draws the dotted threshold line + label and the peak marker above the data.
    const annotations: Plugin<'line'> = {
      id: 'annotations',
      afterDatasetsDraw: (chart) => {
        const { ctx, chartArea, scales } = chart;
        const y = scales['y'];
        const x = scales['x'];
        ctx.save();
        ctx.font = "600 12px 'Plus Jakarta Sans', system-ui, sans-serif";

        if (max !== undefined) {
          const py = y.getPixelForValue(max);
          ctx.strokeStyle = RED;
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.setLineDash([1, 7]);
          ctx.beginPath();
          ctx.moveTo(chartArea.left, py);
          ctx.lineTo(chartArea.right, py);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#eaf1ff';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'bottom';
          ctx.fillText(`${maxLabel} ${fmtVal(max)}${unit}`, chartArea.right - 2, py - 7);
        }

        if (peak) {
          const px = x.getPixelForValue(peak.x);
          const py = y.getPixelForValue(peak.y);
          ctx.fillStyle = color + '40';
          ctx.beginPath();
          ctx.arc(px, py, 11, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = color;
          ctx.strokeStyle = '#eaf1ff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px, py, 5.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          const text = `Peak ${fmtVal(peak.y)}${unit}`;
          const half = ctx.measureText(text).width / 2;
          const tx = Math.min(Math.max(px, chartArea.left + half + 2), chartArea.right - half - 2);
          ctx.fillStyle = color;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(text, tx, py - 16);
        }
        ctx.restore();
      },
    };

    const options: ChartOptions<'line'> = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500 },
      layout: { padding: { top: 22, right: 6 } },
      interaction: { mode: 'nearest', intersect: false, axis: 'x' },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: {
            title: (items) => this.fmtTime(Number(items[0].parsed.x)),
            label: (item) => `${this.label}: ${fmtVal(Number(item.parsed.y))} ${this.unit}`.trim(),
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          min: start,
          max: end,
          // Evenly spaced ticks (every half hour for a 2 h window).
          afterBuildTicks: (axis) => {
            axis.ticks = timeTicks(start, end).map((value) => ({ value }));
          },
          ticks: { color: TICK, maxRotation: 0, callback: (v) => this.fmtTime(Number(v)) },
          grid: { color: GRID },
          border: { color: TICK },
        },
        y: {
          min: yMin,
          max: yMax,
          afterBuildTicks: (axis) => {
            const ticks: { value: number }[] = [];
            for (let v = yMin; v <= yMax; v += step) ticks.push({ value: v });
            axis.ticks = ticks;
          },
          ticks: { color: TICK, callback: (v) => `${v}${unit}` },
          grid: { color: GRID },
          border: { color: TICK },
        },
      },
    };

    this.chart = new Chart<'line', Point[], number>(this.canvas.nativeElement, {
      type: 'line',
      data: {
        datasets: [
          {
            data: points,
            borderColor: color,
            borderWidth: 3,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 5,
            fill: true,
            backgroundColor: (c) => {
              const { ctx, chartArea } = c.chart;
              if (!chartArea) return 'transparent';
              const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
              g.addColorStop(0, color + '66');
              g.addColorStop(1, color + '05');
              return g;
            },
          },
        ],
      },
      options,
      plugins: [annotations],
    });
  }

  private fmtTime(ms: number): string {
    return formatTime(ms, this.timeZone);
  }
}
