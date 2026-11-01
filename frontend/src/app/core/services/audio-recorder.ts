import { Injectable, inject, signal } from '@angular/core';

import { AudioEngine } from '../audio/audio-engine';
import { VoiceMeter } from '../audio/voice-meter';

// Formatos que intentamos grabar, en orden de preferencia. Chrome/Edge/Firefox
// graban webm/opus; Safari graba mp4/aac. Whisper acepta todos.
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

/** Graba el micrófono con MediaRecorder. */
@Injectable({ providedIn: 'root' })
export class AudioRecorder {
  private readonly engine = inject(AudioEngine);

  readonly isRecording = signal(false);
  /** Medidor del micrófono (para que la boca de Nimbo "asienta" mientras hablas). */
  readonly meter = signal<VoiceMeter | null>(null);

  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;

  /** Pide permiso del micrófono una vez y reutiliza el stream. */
  async ensureMicrophone(): Promise<MediaStream> {
    if (this.stream?.active) return this.stream;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const ctx = this.engine.running;
    // Solo se mide: el micrófono NO se conecta a los parlantes (si no, te escucharías).
    if (ctx) this.meter.set(this.engine.meter(ctx, ctx.createMediaStreamSource(this.stream)));
    return this.stream;
  }

  async start(): Promise<void> {
    if (this.recorder?.state === 'recording') return;
    const stream = await this.ensureMicrophone();
    const mimeType = PREFERRED_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));

    this.chunks = [];
    this.recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();
    this.startedAt = performance.now();
    this.isRecording.set(true);
  }

  /** Detiene la grabación y devuelve el audio y cuánto duró (ms). */
  stop(): Promise<{ blob: Blob; durationMs: number }> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === 'inactive') {
      return Promise.resolve({ blob: new Blob(), durationMs: 0 });
    }
    return new Promise((resolve) => {
      recorder.onstop = () => {
        this.isRecording.set(false);
        resolve({
          blob: new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' }),
          durationMs: performance.now() - this.startedAt,
        });
      };
      recorder.stop();
    });
  }

  /** Suelta el micrófono (se apaga el indicador rojo del navegador). */
  release(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.meter.set(null);
  }
}
