import { Injectable, inject, signal } from '@angular/core';

import { AudioEngine } from '../audio/audio-engine';
import { VoiceMeter } from '../audio/voice-meter';

/** Reproduce la voz de Nimbo. En la Fase 2 se convertirá en una cola de fragmentos. */
@Injectable({ providedIn: 'root' })
export class AudioPlayer {
  private readonly engine = inject(AudioEngine);

  readonly isPlaying = signal(false);
  /** Medidor de la voz que está sonando (para mover la boca). null = sin medición. */
  readonly meter = signal<VoiceMeter | null>(null);

  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;

  /** Resuelve cuando termina de sonar (o si se interrumpe). */
  async playBase64(base64: string, mimeType: string): Promise<void> {
    this.stop();
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    this.objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    const audio = new Audio(this.objectUrl);
    this.audio = audio;
    this.connectMeter(audio);

    await new Promise<void>((resolve) => {
      const done = () => {
        if (this.audio === audio) this.cleanup();
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      audio.onpause = done; // stop() pausa el audio
      this.isPlaying.set(true);
      audio.play().catch(done); // p. ej. si el navegador bloquea el autoplay
    });
  }

  stop(): void {
    this.audio?.pause();
    this.cleanup();
  }

  private connectMeter(audio: HTMLAudioElement): void {
    // Si el AudioContext no está activo, el audio suena directo, sin medidor:
    // enrutarlo por un contexto suspendido lo dejaría mudo.
    const ctx = this.engine.running;
    if (!ctx) return;
    // El audio pasa por el contexto: elemento → (medidor) → parlantes.
    const source = ctx.createMediaElementSource(audio);
    source.connect(ctx.destination);
    this.meter.set(this.engine.meter(ctx, source));
  }

  private cleanup(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.audio = null;
    this.meter.set(null);
    this.isPlaying.set(false);
  }
}
