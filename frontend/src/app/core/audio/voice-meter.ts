/**
 * Mide la voz en tiempo real para animar la línea de voz de Nimbo.
 *
 * - `level` (0..1): qué tan fuerte suena.
 * - `waveform`: la forma de onda real de los últimos ~20 ms (valores entre -1 y 1).
 *   La línea que ves en pantalla ES la voz, no una animación inventada.
 */
export interface VoiceReading {
  level: number;
  waveform: Float32Array;
}

export interface VoiceMeter {
  read(): VoiceReading;
}

/** Volumen típico de una voz normal (RMS) que debería mover la línea casi al máximo. */
const FULL_VOICE_RMS = 0.16;

/** Función pura (fácil de testear): volumen de un frame de audio, de 0 a 1. */
export function levelOf(timeData: Float32Array): number {
  let sum = 0;
  for (const v of timeData) sum += v * v;
  const rms = Math.sqrt(sum / Math.max(timeData.length, 1));
  // Raíz cuadrada: la línea reacciona también a la voz suave, no solo a los gritos.
  return Math.min(1, Math.sqrt(rms / FULL_VOICE_RMS));
}

/** Medidor sobre un AnalyserNode de la Web Audio API. */
export class AnalyserMeter implements VoiceMeter {
  private readonly time: Float32Array<ArrayBuffer>;

  constructor(private readonly analyser: AnalyserNode) {
    this.time = new Float32Array(analyser.fftSize);
  }

  read(): VoiceReading {
    this.analyser.getFloatTimeDomainData(this.time);
    return { level: levelOf(this.time), waveform: this.time };
  }
}
