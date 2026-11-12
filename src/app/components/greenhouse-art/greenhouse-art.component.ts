import { Component } from '@angular/core';

/** Glowing greenhouse illustration. Colour comes from the parent's CSS `color`. */
@Component({
  selector: 'app-greenhouse-art',
  template: `
    <svg viewBox="0 0 320 190" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
      <path d="M16 86 L160 14 L304 86 Z" fill="currentColor" fill-opacity=".1"/>
      <rect x="40" y="86" width="240" height="72" fill="currentColor" fill-opacity=".07"/>
      <path d="M160 14V86 M88 50V86 M232 50V86 M40 86V158 M280 86V158 M100 86V158 M160 86V158 M220 86V158 M40 122H280 M16 86H304" stroke-width="1.6" stroke-opacity=".85"/>
      <path d="M40 158H280" stroke-width="3"/>
      <g fill="currentColor" stroke="none" fill-opacity=".9">
        @for (x of plants; track x) {
          <path [attr.d]="'M' + x + ' 158 q -13 -20 0 -40 q 13 20 0 40 z'"/>
          <path [attr.d]="'M' + x + ' 158 q -24 -6 -26 -26 q 22 2 26 26 z'" fill-opacity=".7"/>
          <path [attr.d]="'M' + x + ' 158 q 24 -6 26 -26 q -22 2 -26 26 z'" fill-opacity=".7"/>
        }
      </g>
    </svg>
  `,
  styles: [`
    :host { display: block; }
    svg { width: 100%; height: auto; filter: drop-shadow(0 0 10px currentColor); }
  `],
})
export class GreenhouseArtComponent {
  readonly plants = [62, 100, 140, 180, 220, 258];
}
