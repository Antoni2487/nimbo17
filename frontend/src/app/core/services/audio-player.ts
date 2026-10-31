import { Injectable, signal } from '@angular/core';

/** Reproduce la voz de Nimbo. En la Fase 2 se convertirá en una cola de fragmentos. */
@Injectable({ providedIn: 'root' })
export class AudioPlayer {
  readonly isPlaying = signal(false);

  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;

  /** Resuelve cuando termina de sonar (o si se interrumpe). */
  async playBase64(base64: string, mimeType: string): Promise<void> {
    this.stop();
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    this.objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    const audio = new Audio(this.objectUrl);
    this.audio = audio;

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

  private cleanup(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.audio = null;
    this.isPlaying.set(false);
  }
}
