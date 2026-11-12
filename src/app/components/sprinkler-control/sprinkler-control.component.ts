import { Component, EventEmitter, Input, Output } from '@angular/core';
import { LastActivation } from '../../models/zone.model';
import { formatTime } from '../../utils/time-axis';

/**
 * Shows the sprinkler status reconstructed by the backend (activation time + run time).
 * The button keeps its place in the layout but is disabled: the backend is read-only and has
 * no endpoint to start or stop the sprinkler yet.
 */
@Component({
  selector: 'app-sprinkler-control',
  templateUrl: './sprinkler-control.component.html',
  styleUrl: './sprinkler-control.component.scss',
})
export class SprinklerControlComponent {
  @Input({ required: true }) on = false;
  /** End of the current ON period (epoch ms) while ON. */
  @Input() onUntilMs: number | null = null;
  @Input() last: LastActivation | null = null;
  @Input() timeZone?: string;
  @Output() toggle = new EventEmitter<boolean>();

  /** Manual control is not available until the backend offers a command endpoint. */
  readonly controlAvailable = false;

  onClick(): void {
    if (this.controlAvailable) this.toggle.emit(!this.on);
  }

  time(ms: number, seconds = false): string {
    return formatTime(ms, this.timeZone, seconds);
  }

  seconds(s: number): string {
    return s.toFixed(1);
  }
}
