import { Injectable, computed, inject, signal } from '@angular/core';

import {
  Correction,
  Level,
  PracticeMode,
  TutorMessage,
  TutorState,
} from '../../core/models/tutor.models';
import { AudioPlayer } from '../../core/services/audio-player';
import { AudioRecorder } from '../../core/services/audio-recorder';
import { TutorApi, apiErrorMessage, isNoMoreNudges } from '../../core/services/tutor-api';

export type SessionStatus = 'setup' | 'starting' | 'ready' | 'recording' | 'thinking' | 'speaking';

export interface ChatEntry {
  id: number;
  role: 'user' | 'tutor';
  text: string;
  /** Las correcciones se muestran bajo el mensaje del USUARIO, que es donde estuvo el error. */
  corrections: Correction[];
}

/** Grabaciones más cortas que esto se consideran un clic accidental. */
const MIN_RECORDING_MS = 400;

/** Si el estudiante no habla en este tiempo después de que Nimbo pregunta, Nimbo da una pista. */
export const NUDGE_DELAY_MS = 10_000;

/**
 * Estado + lógica de una sesión de práctica.
 *
 * No es `providedIn: 'root'`: se declara en `providers` del componente de la página,
 * así cada vez que entras a la pantalla tienes una instancia nueva y limpia.
 * Signals: `signal()` guarda un valor reactivo; `computed()` deriva otro valor y se
 * recalcula solo cuando cambian sus dependencias. La plantilla se actualiza sola.
 */
@Injectable()
export class PracticeSession {
  private readonly api = inject(TutorApi);
  private readonly recorder = inject(AudioRecorder);
  private readonly player = inject(AudioPlayer);

  private sessionId: string | null = null;
  private nextId = 0;
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;

  readonly status = signal<SessionStatus>('setup');
  readonly messages = signal<ChatEntry[]>([]);
  readonly error = signal<string | null>(null);
  readonly level = signal<Level>('B1');
  readonly mode = signal<PracticeMode>('free_talk');

  readonly tutorState = computed<TutorState>(() => {
    switch (this.status()) {
      case 'recording':
        return 'listening';
      case 'starting':
      case 'thinking':
        return 'thinking';
      case 'speaking':
        return 'speaking';
      default:
        return 'idle';
    }
  });

  /** Se puede hablar cuando Nimbo espera, o mientras habla (para interrumpirlo). */
  readonly canTalk = computed(() => ['ready', 'speaking'].includes(this.status()));

  async start(mode: PracticeMode, level: Level): Promise<void> {
    this.mode.set(mode);
    this.level.set(level);
    this.error.set(null);
    this.messages.set([]);
    this.status.set('starting');
    try {
      // Pedimos el micrófono ya, para que el permiso no interrumpa el primer turno.
      await this.recorder.ensureMicrophone();
      const res = await this.api.startSession(mode, level);
      this.sessionId = res.session_id;
      await this.say(res.tutor);
    } catch (e) {
      this.error.set(
        e instanceof DOMException
          ? 'Necesito permiso para usar tu micrófono.'
          : apiErrorMessage(e),
      );
      this.status.set('setup');
    }
  }

  async beginRecording(): Promise<void> {
    if (!this.canTalk()) return;
    this.cancelNudge();
    this.player.stop(); // si Nimbo estaba hablando, lo interrumpimos
    this.error.set(null);
    try {
      await this.recorder.start();
      this.status.set('recording');
    } catch {
      this.error.set('No pude acceder al micrófono.');
    }
  }

  async finishRecording(): Promise<void> {
    if (this.status() !== 'recording' || !this.sessionId) return;
    const { blob, durationMs } = await this.recorder.stop();

    if (durationMs < MIN_RECORDING_MS || blob.size === 0) {
      this.error.set('Mantén presionado el botón mientras hablas.');
      this.status.set('ready');
      this.scheduleNudge();
      return;
    }

    this.status.set('thinking');
    try {
      const res = await this.api.sendTurn(this.sessionId, blob);
      this.push('user', res.transcript, res.tutor.corrections);
      await this.say(res.tutor);
    } catch (e) {
      this.error.set(apiErrorMessage(e));
      this.status.set('ready');
    }
  }

  /** Nimbo da una pista porque pasó un rato sin que el estudiante hablara. */
  async nudge(): Promise<void> {
    this.nudgeTimer = null;
    if (this.status() !== 'ready' || !this.sessionId) return;
    this.status.set('thinking');
    try {
      await this.say(await this.api.nudge(this.sessionId));
    } catch (e) {
      // 409: ya dio sus 2 pistas; Nimbo espera en silencio, sin mostrar error.
      if (!isNoMoreNudges(e)) this.error.set(apiErrorMessage(e));
      if (this.status() === 'thinking') this.status.set('ready');
    }
  }

  async end(): Promise<void> {
    this.cancelNudge();
    this.player.stop();
    if (this.recorder.isRecording()) await this.recorder.stop();
    this.recorder.release();
    if (this.sessionId) {
      this.api.endSession(this.sessionId).catch(() => undefined); // no bloquea la salida
    }
    this.sessionId = null;
    this.status.set('setup');
  }

  private async say(message: TutorMessage): Promise<void> {
    this.push('tutor', message.text, []);
    if (message.warning) this.error.set(message.warning);
    if (message.audio_base64 && message.audio_mime_type) {
      this.status.set('speaking');
      await this.player.playBase64(message.audio_base64, message.audio_mime_type);
    }
    // Si el usuario interrumpió, ya estamos en 'recording': no pisamos ese estado.
    if (this.status() === 'speaking' || this.status() === 'starting' || this.status() === 'thinking') {
      this.status.set('ready');
      this.scheduleNudge();
    }
  }

  private scheduleNudge(): void {
    this.cancelNudge();
    // setTimeout sigue funcionando con la pestaña en segundo plano (el navegador lo
    // retrasa como mucho ~1 s), así que las pistas llegan aunque estés en otra ventana.
    this.nudgeTimer = setTimeout(() => void this.nudge(), NUDGE_DELAY_MS);
  }

  private cancelNudge(): void {
    if (this.nudgeTimer !== null) clearTimeout(this.nudgeTimer);
    this.nudgeTimer = null;
  }

  private push(role: ChatEntry['role'], text: string, corrections: Correction[]): void {
    this.messages.update((list) => [...list, { id: this.nextId++, role, text, corrections }]);
  }
}
