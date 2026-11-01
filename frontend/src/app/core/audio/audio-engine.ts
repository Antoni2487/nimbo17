import { Injectable } from '@angular/core';

import { AnalyserMeter, VoiceMeter } from './voice-meter';

/**
 * Un solo AudioContext para toda la app (crear varios gasta recursos).
 *
 * Los navegadores solo dejan arrancar el audio después de un gesto del usuario
 * (clic o tecla). Por eso `unlock()` se llama de forma síncrona en el clic de
 * "Empezar": si se llamara después de un `await`, el navegador ya no lo
 * consideraría parte del gesto y el contexto quedaría suspendido.
 */
@Injectable({ providedIn: 'root' })
export class AudioEngine {
  private ctx: AudioContext | null = null;

  unlock(): void {
    if (typeof AudioContext === 'undefined') return;
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
  }

  /** El contexto, solo si está sonando de verdad (si no, mejor no enrutar audio por él). */
  get running(): AudioContext | null {
    return this.ctx?.state === 'running' ? this.ctx : null;
  }

  /** Crea un medidor que escucha `source` sin alterarlo. */
  meter(ctx: AudioContext, source: AudioNode): VoiceMeter {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024; // ~21 ms a 48 kHz: unas pocas ondas de voz en pantalla
    analyser.smoothingTimeConstant = 0.5;
    source.connect(analyser);
    return new AnalyserMeter(analyser);
  }
}
