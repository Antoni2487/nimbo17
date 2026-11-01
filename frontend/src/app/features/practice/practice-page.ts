import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';

import { Level, PracticeMode } from '../../core/models/tutor.models';
import { FloatingWindow } from '../../core/services/floating-window';
import { VoiceAvatar } from '../../shared/voice-avatar/voice-avatar';
import { PracticeSession } from './practice-session';

interface Option<T> {
  value: T;
  label: string;
  hint: string;
}

@Component({
  selector: 'app-practice-page',
  imports: [VoiceAvatar],
  templateUrl: './practice-page.html',
  styleUrl: './practice-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Instancia propia de PracticeSession para esta pantalla (ver practice-session.ts).
  providers: [PracticeSession],
  host: {
    // Barra espaciadora = pausa / continuar
    '(window:keydown.space)': 'onSpace($event)',
  },
})
export class PracticePage implements OnDestroy {
  protected readonly session = inject(PracticeSession);
  protected readonly floating = inject(FloatingWindow);
  private readonly avatar = viewChild('avatar', { read: ElementRef<HTMLElement> });

  protected readonly levels: Option<Level>[] = [
    { value: 'A2', label: 'A2', hint: 'Básico' },
    { value: 'B1', label: 'B1', hint: 'Intermedio' },
    { value: 'B2', label: 'B2', hint: 'Intermedio alto' },
    { value: 'C1', label: 'C1', hint: 'Avanzado' },
  ];

  protected readonly modes: Option<PracticeMode>[] = [
    { value: 'free_talk', label: 'Charla libre', hint: 'Tu día, tus planes, tus gustos' },
    {
      value: 'job_interview',
      label: 'Entrevista de trabajo',
      hint: 'Preguntas típicas de RR. HH.',
    },
    { value: 'travel', label: 'Viajes', hint: 'Aeropuerto, hotel, restaurante' },
    { value: 'university_life', label: 'Vida universitaria', hint: 'Clases, proyectos, exámenes' },
    { value: 'tech_talk', label: 'Tech talk', hint: 'Programación, IA, proyectos' },
  ];

  protected readonly selectedLevel = signal<Level>('B1');
  protected readonly selectedMode = signal<PracticeMode>('free_talk');

  private readonly chatEnd = viewChild<ElementRef<HTMLElement>>('chatEnd');

  constructor() {
    // Si la sesión termina (botón Terminar o un error), la ventanita se cierra:
    // el avatar que vive en ella deja de existir.
    effect(() => {
      if (this.session.status() === 'setup') this.floating.close();
    });
    // effect(): se ejecuta cada vez que cambia un signal que lee. Aquí: auto-scroll del chat.
    effect(() => {
      this.session.messages();
      queueMicrotask(() => this.chatEnd()?.nativeElement.scrollIntoView({ behavior: 'smooth' }));
    });
  }

  protected start(): void {
    void this.session.start(this.selectedMode(), this.selectedLevel());
  }

  /** Saca a Nimbo a una ventanita siempre encima (tiene que ser desde un clic). */
  protected float(): void {
    const el = this.avatar()?.nativeElement;
    if (el) void this.floating.open(el);
  }

  protected modeLabel(mode: PracticeMode): string {
    return this.modes.find((m) => m.value === mode)?.label ?? mode;
  }

  protected onSpace(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (this.session.status() === 'setup' || target?.closest('button, select, input')) return;
    event.preventDefault();
    if (!(event as KeyboardEvent).repeat) this.session.togglePause();
  }

  ngOnDestroy(): void {
    this.floating.close();
    void this.session.end();
  }
}
