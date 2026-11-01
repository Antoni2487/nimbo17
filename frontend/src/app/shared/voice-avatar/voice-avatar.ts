import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  viewChild,
} from '@angular/core';

import { VoiceMeter } from '../../core/audio/voice-meter';
import { TutorState } from '../../core/models/tutor.models';
import { POINTS, smoothWave, targetWave, wavePath } from './wave';

/** Geometría de la línea dentro de la pantalla (viewBox 240×190). */
const LINE = { x0: 20, width: 200, cy: 80, amplitude: 46 };

/**
 * Nimbo: una pantalla de vidrio flotante con una línea de voz luminosa.
 * Cuando habla, la línea es la forma de onda real de su voz.
 *
 * Colores, halo y LED cambian con CSS según el estado. La línea se dibuja con
 * requestAnimationFrame (~60 fps) escribiendo directo en el SVG: la app es
 * "zoneless", así que eso no dispara la detección de cambios de Angular.
 */
@Component({
  selector: 'app-voice-avatar',
  templateUrl: './voice-avatar.html',
  styleUrl: './voice-avatar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': '"state-" + state()',
    role: 'img',
    '[attr.aria-label]': '"Nimbo está " + labels[state()]',
  },
})
export class VoiceAvatar {
  readonly state = input<TutorState>('idle');
  /** Voz que mueve la línea (la de Nimbo al hablar, la tuya al escuchar). */
  readonly voice = input<VoiceMeter | null>(null);

  protected readonly labels: Record<TutorState, string> = {
    idle: 'esperando',
    listening: 'escuchando',
    thinking: 'pensando',
    speaking: 'hablando',
  };

  private readonly line = viewChild.required<ElementRef<SVGPathElement>>('line');
  private readonly trail = viewChild.required<ElementRef<SVGPathElement>>('trail');

  private wave: number[] = new Array(POINTS).fill(0);
  /** Copia atrasada de la onda: deja una estela tenue detrás de la línea. */
  private trailWave: number[] = new Array(POINTS).fill(0);

  constructor() {
    const destroyRef = inject(DestroyRef);
    // afterNextRender: corre solo en el navegador y cuando el SVG ya existe en el DOM.
    afterNextRender(() => {
      let frame = 0;
      const loop = (now: number) => {
        this.draw(now / 1000);
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
      destroyRef.onDestroy(() => cancelAnimationFrame(frame));
    });
  }

  private draw(t: number): void {
    const reading = this.voice()?.read() ?? null;
    this.wave = smoothWave(this.wave, targetWave(this.state(), reading, t));
    this.trailWave = this.trailWave.map((v, i) => v + (this.wave[i] - v) * 0.12);

    const { x0, width, cy, amplitude } = LINE;
    this.line().nativeElement.setAttribute('d', wavePath(this.wave, x0, width, cy, amplitude));
    this.trail().nativeElement.setAttribute(
      'd',
      wavePath(this.trailWave, x0, width, cy, amplitude),
    );
  }
}
