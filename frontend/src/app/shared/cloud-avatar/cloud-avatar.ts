import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { TutorState } from '../../core/models/tutor.models';

/**
 * Nimbo, la nube. Fase 1: animaciones CSS según el estado.
 * Fase 3: reaccionará al volumen real del audio (AnalyserNode).
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

  protected readonly labels: Record<TutorState, string> = {
    idle: 'esperando',
    listening: 'escuchando',
    thinking: 'pensando',
    speaking: 'hablando',
  };
}
