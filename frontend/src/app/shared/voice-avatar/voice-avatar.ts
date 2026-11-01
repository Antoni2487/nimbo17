import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { VoiceMeter } from '../../core/audio/voice-meter';
import { TutorState } from '../../core/models/tutor.models';
import { POINTS, smoothWave, targetWave, wavePath } from './wave';

/** Geometría de la línea dentro de la pantalla (viewBox 240×190). */
const LINE = { x0: 20, width: 200, cy: 80, amplitude: 46 };
/** Cuánto pueden moverse los ojos (px del viewBox) al mirar hacia algún lado. */
const LOOK = { x: 7, y: 4 };

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
    '[class]': 'hostClass()',
    role: 'button',
    tabindex: '0',
    '[attr.aria-label]': 'ariaLabel()',
    '(click)': 'boop()',
    '(keydown.enter)': 'boop()',
    '(pointermove)': 'lookAt($event)',
    '(pointerleave)': 'pointer = null',
  },
})
export class VoiceAvatar {
  readonly state = input<TutorState>('idle');
  /** Voz que mueve la línea (la de Nimbo al hablar, la tuya al escuchar). */
  readonly voice = input<VoiceMeter | null>(null);
  /** En pausa: Nimbo "duerme" (ojos cerrados, línea apagada). */
  readonly sleeping = input(false);
  /** Lo tocaste (clic o Enter). */
  readonly tapped = output<void>();

  private readonly booping = signal(false);
  protected readonly hostClass = computed(
    () =>
      `state-${this.state()}` +
      (this.sleeping() ? ' sleeping' : '') +
      (this.booping() ? ' boop' : ''),
  );
  protected readonly ariaLabel = computed(
    () =>
      `Nimbo está ${this.sleeping() ? 'en pausa' : this.labels[this.state()]}. ` +
      `Tócalo para ${this.sleeping() ? 'continuar' : 'pausar'}.`,
  );

  protected readonly labels: Record<TutorState, string> = {
    idle: 'esperando',
    listening: 'escuchando',
    thinking: 'pensando',
    speaking: 'hablando',
  };

  private readonly line = viewChild.required<ElementRef<SVGPathElement>>('line');
  private readonly trail = viewChild.required<ElementRef<SVGPathElement>>('trail');
  private readonly eyes = viewChild.required<ElementRef<SVGGElement>>('eyes');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Posición del cursor relativa al centro del avatar (-1..1), o null si no está encima. */
  protected pointer: { x: number; y: number } | null = null;
  private look = { x: 0, y: 0 };

  private wave: number[] = new Array(POINTS).fill(0);
  /** Copia atrasada de la onda: deja una estela tenue detrás de la línea. */
  private trailWave: number[] = new Array(POINTS).fill(0);

  constructor() {
    const destroyRef = inject(DestroyRef);
    // afterNextRender: corre solo en el navegador y cuando el SVG ya existe en el DOM.
    afterNextRender(() => {
      let frame = 0;
      // Se pide el frame a la ventana DONDE ESTÁ el avatar: si se movió a la ventana
      // flotante, la pestaña principal puede estar oculta (y ahí los frames se pausan).
      const win = () => this.host.nativeElement.ownerDocument.defaultView ?? window;
      let current = win();
      const loop = (now: number) => {
        this.draw(now / 1000);
        current = win();
        frame = current.requestAnimationFrame(loop);
      };
      frame = current.requestAnimationFrame(loop);
      destroyRef.onDestroy(() => current.cancelAnimationFrame(frame));
    });
  }

  protected boop(): void {
    this.tapped.emit();
    this.booping.set(false);
    // Reinicia la animación del saltito aunque toques varias veces seguidas.
    queueMicrotask(() => this.booping.set(true));
    setTimeout(() => this.booping.set(false), 600);
  }

  protected lookAt(event: PointerEvent): void {
    const r = this.host.nativeElement.getBoundingClientRect();
    this.pointer = {
      x: Math.max(-1, Math.min(1, ((event.clientX - r.left) / r.width) * 2 - 1)),
      y: Math.max(-1, Math.min(1, ((event.clientY - r.top) / r.height) * 2 - 1)),
    };
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
    this.drawEyes(t);
  }

  /**
   * Los ojos miran tu cursor; al pensar, miran hacia arriba; si no, de vez en
   * cuando echan un vistazo a los lados para que se sienta vivo.
   */
  private drawEyes(t: number): void {
    const glance = Math.sin(t * 0.37);
    const target = this.pointer
      ? this.pointer
      : this.state() === 'thinking'
        ? { x: 0.6, y: -0.9 }
        : { x: glance > 0.92 ? 0.7 : glance < -0.95 ? -0.7 : 0, y: 0 };
    this.look.x += (target.x - this.look.x) * 0.15;
    this.look.y += (target.y - this.look.y) * 0.15;
    const dx = (this.look.x * LOOK.x).toFixed(2);
    const dy = (this.look.y * LOOK.y).toFixed(2);
    this.eyes().nativeElement.setAttribute('transform', `translate(${dx} ${dy})`);
  }
}
