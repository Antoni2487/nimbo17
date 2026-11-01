import { Injectable, computed, inject, signal } from '@angular/core';

import { AudioEngine } from '../../core/audio/audio-engine';
import { VoiceMeter } from '../../core/audio/voice-meter';
import {
  Correction,
  Level,
  PracticeMode,
  TutorMessage,
  TutorState,
} from '../../core/models/tutor.models';
import { AudioPlayer } from '../../core/services/audio-player';
import { HandsFreeListener } from '../../core/services/hands-free-listener';
import { TutorApi, apiErrorMessage, isNoMoreNudges } from '../../core/services/tutor-api';

export type SessionStatus = 'setup' | 'starting' | 'ready' | 'recording' | 'thinking' | 'speaking';

export interface ChatEntry {
  id: number;
  role: 'user' | 'tutor';
  text: string;
  /** Las correcciones se muestran bajo el mensaje del USUARIO, que es donde estuvo el error. */
  corrections: Correction[];
}

/** Si el estudiante no habla en este tiempo después de que Nimbo pregunta, Nimbo da una pista. */
export const NUDGE_DELAY_MS = 10_000;

/**
 * Estado + lógica de una sesión de práctica, manos libres.
 *
 * El micrófono queda abierto toda la sesión y HandsFreeListener avisa cuándo
 * empiezas y terminas de hablar. Según el estado, el detector está:
 *   ready → 'listening' · speaking → 'barge-in' (puedes interrumpir a Nimbo)
 *   thinking / en pausa → 'off'
 *
 * No es `providedIn: 'root'`: se declara en `providers` del componente de la página,
 * así cada vez que entras a la pantalla tienes una instancia nueva y limpia.
 * Signals: `signal()` guarda un valor reactivo; `computed()` deriva otro valor y se
 * recalcula solo cuando cambian sus dependencias. La plantilla se actualiza sola.
 */
@Injectable()
export class PracticeSession {
  private readonly api = inject(TutorApi);
  private readonly listener = inject(HandsFreeListener);
  private readonly player = inject(AudioPlayer);
  private readonly engine = inject(AudioEngine);

  private sessionId: string | null = null;
  private nextId = 0;
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;

  readonly status = signal<SessionStatus>('setup');
  readonly messages = signal<ChatEntry[]>([]);
  readonly error = signal<string | null>(null);
  readonly level = signal<Level>('B1');
  readonly mode = signal<PracticeMode>('free_talk');
  /** En pausa: Nimbo no escucha ni da pistas (para cuando te llaman o hablas con alguien). */
  readonly paused = signal(false);

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

  /** De quién es la voz que mueve la boca: la de Nimbo al hablar, la tuya al escuchar. */
  readonly voiceMeter = computed<VoiceMeter | null>(() => {
    switch (this.tutorState()) {
      case 'speaking':
        return this.player.meter();
      case 'listening':
        return this.listener.meter();
      default:
        return null;
    }
  });

  async start(mode: PracticeMode, level: Level): Promise<void> {
    // Síncrono, antes de cualquier await: todavía estamos dentro del clic del usuario.
    this.engine.unlock();
    this.mode.set(mode);
    this.level.set(level);
    this.error.set(null);
    this.messages.set([]);
    this.paused.set(false);
    this.status.set('starting');
    try {
      // Pedimos el micrófono ya, para que el permiso no interrumpa el primer turno.
      await this.listener.start({
        onSpeechStart: () => this.onSpeechStart(),
        onUtterance: (audio) => void this.onUtterance(audio),
        onDiscard: () => this.onDiscard(),
      });
      const res = await this.api.startSession(mode, level);
      this.sessionId = res.session_id;
      await this.say(res.tutor);
    } catch (e) {
      this.error.set(
        e instanceof DOMException ? 'Necesito permiso para usar tu micrófono.' : apiErrorMessage(e),
      );
      this.listener.stop();
      this.status.set('setup');
    }
  }

  togglePause(): void {
    const paused = !this.paused();
    this.paused.set(paused);
    if (paused) {
      this.cancelNudge();
      this.listener.mode = 'off';
      if (this.status() === 'recording') this.status.set('ready');
    } else if (this.status() === 'ready') {
      this.listen();
    }
  }

  /** Nimbo da una pista porque pasó un rato sin que el estudiante hablara. */
  async nudge(): Promise<void> {
    this.nudgeTimer = null;
    if (this.status() !== 'ready' || this.paused() || !this.sessionId) return;
    this.status.set('thinking');
    this.listener.mode = 'off';
    try {
      await this.say(await this.api.nudge(this.sessionId));
    } catch (e) {
      // 409: ya dio sus 2 pistas; Nimbo espera en silencio, sin mostrar error.
      if (!isNoMoreNudges(e)) this.error.set(apiErrorMessage(e));
      if (this.status() === 'thinking') {
        this.status.set('ready');
        this.listener.mode = this.paused() ? 'off' : 'listening';
      }
    }
  }

  async end(): Promise<void> {
    this.cancelNudge();
    this.player.stop();
    this.listener.stop();
    if (this.sessionId) {
      this.api.endSession(this.sessionId).catch(() => undefined); // no bloquea la salida
    }
    this.sessionId = null;
    this.status.set('setup');
  }

  private onSpeechStart(): void {
    if (this.paused() || !['ready', 'speaking'].includes(this.status())) return;
    this.cancelNudge();
    this.error.set(null);
    // Primero el estado y después parar el audio: así say() ve 'recording' y no lo pisa.
    this.status.set('recording');
    this.player.stop(); // si Nimbo estaba hablando, lo interrumpiste
    this.listener.mode = 'listening';
  }

  private onDiscard(): void {
    if (this.status() === 'recording') this.listen();
  }

  private async onUtterance(audio: Blob): Promise<void> {
    if (this.status() !== 'recording' || !this.sessionId) return;
    this.listener.mode = 'off';
    this.status.set('thinking');
    try {
      const res = await this.api.sendTurn(this.sessionId, audio);
      this.push('user', res.transcript, res.tutor.corrections);
      await this.say(res.tutor);
    } catch (e) {
      this.error.set(apiErrorMessage(e));
      this.listen();
    }
  }

  private async say(message: TutorMessage): Promise<void> {
    this.push('tutor', message.text, []);
    if (message.warning) this.error.set(message.warning);
    if (message.audio_base64 && message.audio_mime_type) {
      this.status.set('speaking');
      this.listener.mode = this.paused() ? 'off' : 'barge-in';
      await this.player.playBase64(message.audio_base64, message.audio_mime_type);
    }
    // Si el usuario interrumpió, ya estamos en 'recording': no pisamos ese estado.
    if (['speaking', 'starting', 'thinking'].includes(this.status())) this.listen();
  }

  /** Turno del estudiante: escuchar y, si no habla, preparar una pista. */
  private listen(): void {
    this.status.set('ready');
    if (this.paused()) {
      this.listener.mode = 'off';
      return;
    }
    this.listener.mode = 'listening';
    this.scheduleNudge();
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
