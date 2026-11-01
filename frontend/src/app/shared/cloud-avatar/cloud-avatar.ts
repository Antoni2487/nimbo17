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
import { IDLE_POSE, MouthPose, mouthGeometry, smoothPose, targetPose } from './mouth';

type SvgRef<T extends SVGElement> = ElementRef<T>;

/**
 * Nimbo: una nube con una boquita flotante que se mueve con su voz.
 *
 * La nube (colores, ojos, aro, burbujas) se anima con CSS según el estado.
 * La boca se anima con requestAnimationFrame (~60 fps) leyendo el volumen real
 * del audio. Para no pagar el costo de la detección de cambios de Angular 60
 * veces por segundo, el loop escribe directo en los atributos del SVG: la app es
 * "zoneless", así que requestAnimationFrame no dispara ninguna revisión de Angular.
 */
@Component({
  selector: 'app-cloud-avatar',
  templateUrl: './cloud-avatar.html',
  styleUrl: './cloud-avatar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': '"state-" + state()',
    role: 'img',
    '[attr.aria-label]': '"Nimbo está " + labels[state()]',
  },
})
export class CloudAvatar {
  readonly state = input<TutorState>('idle');
  /** Voz que mueve la boca (la de Nimbo al hablar, la tuya al escuchar). */
  readonly voice = input<VoiceMeter | null>(null);

  protected readonly labels: Record<TutorState, string> = {
    idle: 'esperando',
    listening: 'escuchando',
    thinking: 'pensando',
    speaking: 'hablando',
  };

  private readonly mouth = viewChild.required<SvgRef<SVGGElement>>('mouth');
  private readonly inner = viewChild.required<SvgRef<SVGPathElement>>('mouthInner');
  private readonly lips = viewChild.required<SvgRef<SVGPathElement>>('mouthLips');
  private readonly clip = viewChild.required<SvgRef<SVGPathElement>>('mouthClip');
  private readonly teeth = viewChild.required<SvgRef<SVGRectElement>>('teeth');
  private readonly tongue = viewChild.required<SvgRef<SVGEllipseElement>>('tongue');
  private readonly shadow = viewChild.required<SvgRef<SVGEllipseElement>>('mouthShadow');

  private pose: MouthPose = IDLE_POSE;

  constructor() {
    const destroyRef = inject(DestroyRef);
    // afterNextRender: corre solo en el navegador y cuando el SVG ya existe en el DOM.
    afterNextRender(() => {
      const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      let frame = requestAnimationFrame(
        function loop(this: CloudAvatar, now: number) {
          this.drawFrame(now / 1000, reduceMotion);
          frame = requestAnimationFrame(loop.bind(this));
        }.bind(this),
      );
      destroyRef.onDestroy(() => cancelAnimationFrame(frame));
    });
  }

  private drawFrame(t: number, reduceMotion: boolean): void {
    const reading = this.voice()?.read() ?? null;
    this.pose = smoothPose(this.pose, targetPose(this.state(), reading, t));
    const g = mouthGeometry(this.pose);

    this.inner().nativeElement.setAttribute('d', g.outline);
    this.lips().nativeElement.setAttribute('d', g.outline);
    this.clip().nativeElement.setAttribute('d', g.outline);

    const teeth = this.teeth().nativeElement;
    teeth.setAttribute('y', (g.top - 1).toFixed(2));
    teeth.setAttribute('opacity', Math.min(1, this.pose.open * 4).toFixed(2));

    const tongue = this.tongue().nativeElement;
    tongue.setAttribute('cy', g.tongue.cy.toFixed(2));
    tongue.setAttribute('rx', g.tongue.rx.toFixed(2));
    tongue.setAttribute('ry', g.tongue.ry.toFixed(2));

    // Vaivén propio de la boca (distinto ritmo que la nube): por eso parece flotar.
    const bob = reduceMotion ? 0 : Math.sin(t * 1.9) * 2.5;
    // 1.2: la boca es la protagonista, un poco más grande que la cara "normal".
    const scale = 1.2 + 0.1 * this.pose.open;
    this.mouth().nativeElement.setAttribute(
      'transform',
      `translate(${(121 + this.pose.shiftX).toFixed(2)} ${(148 + bob).toFixed(2)}) ` +
        `rotate(${this.pose.tilt.toFixed(2)}) scale(${scale.toFixed(3)})`,
    );
    // La sombra se achica cuando la boca sube: refuerza la sensación de altura.
    const shadow = this.shadow().nativeElement;
    shadow.setAttribute('cx', (121 + this.pose.shiftX).toFixed(2));
    shadow.setAttribute('rx', (g.halfWidth * scale * (1.05 - bob * 0.03)).toFixed(2));
  }
}
