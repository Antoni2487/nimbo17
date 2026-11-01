/**
 * Detector de voz (VAD, "voice activity detection") por umbral de volumen.
 *
 * Recibe el volumen (RMS) de bloques de ~20 ms y decide cuándo empezaste a hablar
 * y cuándo terminaste. Es una máquina de estados pura, sin Web Audio, para poder
 * testearla y mejorarla (o reemplazarla por un modelo) sin tocar el resto.
 */
export type VadMode = 'off' | 'listening' | 'barge-in';
export type VadEvent = 'speech-start' | 'speech-end' | null;

export interface VadOptions {
  /** Silencio seguido que cierra tu turno. Largo a propósito: quien aprende hace pausas para pensar. */
  silenceToEndMs: number;
  /** Ventana y mínimo de bloques con voz para decidir que empezaste a hablar. */
  startWindow: number;
  startMinVoiced: number;
  /** Más exigente mientras Nimbo habla, para que su propia voz (por los parlantes) no lo interrumpa. */
  bargeInWindow: number;
  bargeInMinVoiced: number;
  /** Umbral mínimo absoluto y cuántas veces por encima del ruido de fondo tiene que estar la voz. */
  minThreshold: number;
  noiseFactor: number;
  bargeInMinThreshold: number;
  bargeInNoiseFactor: number;
}

export const DEFAULT_VAD: VadOptions = {
  silenceToEndMs: 1200,
  startWindow: 8,
  startMinVoiced: 5,
  bargeInWindow: 16,
  bargeInMinVoiced: 12,
  minThreshold: 0.012,
  noiseFactor: 3.5,
  bargeInMinThreshold: 0.045,
  bargeInNoiseFactor: 7,
};

export class VoiceActivityDetector {
  mode: VadMode = 'off';
  private speaking = false;
  private recent: boolean[] = [];
  private silentMs = 0;
  /**
   * Ruido de fondo (ventilador, tráfico…) = el volumen MÍNIMO de los últimos ~2 s.
   * Aunque alguien hable, entre sílaba y sílaba siempre se cuela el ruido de fondo,
   * así que el mínimo lo estima bien sin confundirse con la voz.
   */
  private history: number[] = [];
  private static readonly HISTORY_BLOCKS = 100;

  constructor(private readonly options: VadOptions = DEFAULT_VAD) {}

  get isSpeaking(): boolean {
    return this.speaking;
  }

  /** Procesa un bloque de `durationMs` con volumen `rms`. */
  push(rms: number, durationMs: number): VadEvent {
    const o = this.options;
    this.history.push(rms);
    if (this.history.length > VoiceActivityDetector.HISTORY_BLOCKS) this.history.shift();
    const noiseFloor = Math.max(0.002, Math.min(...this.history));
    const bargeIn = this.mode === 'barge-in';
    const threshold = bargeIn
      ? Math.max(o.bargeInMinThreshold, noiseFloor * o.bargeInNoiseFactor)
      : Math.max(o.minThreshold, noiseFloor * o.noiseFactor);
    const voiced = rms > threshold;

    if (this.mode === 'off') {
      this.reset();
      return null;
    }

    if (!this.speaking) {
      const window = bargeIn ? o.bargeInWindow : o.startWindow;
      const needed = bargeIn ? o.bargeInMinVoiced : o.startMinVoiced;
      this.recent.push(voiced);
      if (this.recent.length > window) this.recent.shift();
      if (this.recent.filter(Boolean).length >= needed) {
        this.speaking = true;
        this.silentMs = 0;
        this.recent = [];
        return 'speech-start';
      }
      return null;
    }

    this.silentMs = voiced ? 0 : this.silentMs + durationMs;
    if (this.silentMs >= o.silenceToEndMs) {
      this.reset();
      return 'speech-end';
    }
    return null;
  }

  reset(): void {
    this.speaking = false;
    this.recent = [];
    this.silentMs = 0;
  }
}
