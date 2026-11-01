/**
 * Mide la voz en tiempo real para animar la boca de Nimbo.
 *
 * - `level` (0..1): qué tan fuerte suena → qué tanto abre la boca.
 * - `brightness` (0..1): cuánta energía hay en agudos vs. graves. Sonidos como
 *   "ee" o "s" son brillantes (boca ancha); "oo" o "u" son oscuros (boca redonda).
 *   No es lectura de labios real, pero le da variedad y se siente vivo.
 */
export interface VoiceReading {
  level: number;
  brightness: number;
}

export interface VoiceMeter {
  read(): VoiceReading;
}

export const SILENCE: VoiceReading = { level: 0, brightness: 0.5 };

/** Volumen típico de una voz normal (RMS) que debería abrir la boca casi del todo. */
const FULL_VOICE_RMS = 0.16;
const LOW_BAND_HZ: [number, number] = [250, 1000];
const HIGH_BAND_HZ: [number, number] = [2000, 5000];

/** Función pura (fácil de testear): convierte un frame de audio en una lectura. */
export function analyzeFrame(
  timeData: Float32Array,
  freqData: Uint8Array,
  sampleRate: number,
): VoiceReading {
  let sum = 0;
  for (const v of timeData) sum += v * v;
  const rms = Math.sqrt(sum / Math.max(timeData.length, 1));
  // Raíz cuadrada: la boca reacciona también a la voz suave, no solo a los gritos.
  const level = Math.min(1, Math.sqrt(rms / FULL_VOICE_RMS));

  const hzPerBin = sampleRate / 2 / freqData.length;
  const band = ([from, to]: [number, number]) => {
    let total = 0;
    const start = Math.floor(from / hzPerBin);
    const end = Math.min(freqData.length, Math.ceil(to / hzPerBin));
    for (let i = start; i < end; i++) total += freqData[i];
    return total / Math.max(end - start, 1);
  };
  const low = band(LOW_BAND_HZ);
  const high = band(HIGH_BAND_HZ);
  const brightness = low + high < 1 ? 0.5 : high / (low + high);
  return { level, brightness };
}

/** Medidor sobre un AnalyserNode de la Web Audio API. */
export class AnalyserMeter implements VoiceMeter {
  private readonly time: Float32Array<ArrayBuffer>;
  private readonly freq: Uint8Array<ArrayBuffer>;

  constructor(private readonly analyser: AnalyserNode) {
    this.time = new Float32Array(analyser.fftSize);
    this.freq = new Uint8Array(analyser.frequencyBinCount);
  }

  read(): VoiceReading {
    this.analyser.getFloatTimeDomainData(this.time);
    this.analyser.getByteFrequencyData(this.freq);
    return analyzeFrame(this.time, this.freq, this.analyser.context.sampleRate);
  }
}
