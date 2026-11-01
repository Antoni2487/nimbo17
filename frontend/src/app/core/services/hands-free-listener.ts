import { Injectable, inject, signal } from '@angular/core';

import { AudioEngine } from '../audio/audio-engine';
import { DEFAULT_VAD, VadMode, VoiceActivityDetector } from '../audio/vad';
import { VoiceMeter } from '../audio/voice-meter';
import { encodeWav } from '../audio/wav';

const SAMPLE_RATE = 16000;
const BLOCK_MS = 20;
/**
 * Audio que se guarda ANTES de detectar tu voz, para no cortar la primera sílaba.
 * Cubre el peor caso: al interrumpir a Nimbo el detector pide hasta 320 ms de voz.
 */
const PRE_ROLL_BLOCKS = 25; // 500 ms
/**
 * Silencio final que se conserva. El resto se recorta: Whisper a veces "inventa"
 * frases ("Thank you.") cuando recibe mucho silencio, y así el archivo pesa menos.
 */
const KEEP_TRAILING_SILENCE_BLOCKS = 15; // 300 ms
/** Si hablas más que esto sin pausa, se envía igual (Nimbo no espera para siempre). */
const MAX_UTTERANCE_MS = 30_000;
/** Menos voz que esto (sin contar el silencio final) = ruido o tos: se descarta. */
const MIN_SPEECH_MS = 350;

export interface ListenerHandlers {
  onSpeechStart(): void;
  onUtterance(audio: Blob, durationMs: number): void;
  /** Se detectó "voz", pero era demasiado corta (un golpe, una tos). */
  onDiscard(): void;
}

/**
 * Micrófono manos libres: siempre abierto, detecta solo cuándo empiezas y
 * terminas de hablar, y entrega cada frase como WAV de 16 kHz.
 */
@Injectable({ providedIn: 'root' })
export class HandsFreeListener {
  private readonly engine = inject(AudioEngine);

  /** Medidor del micrófono (para que la boca de Nimbo reaccione mientras hablas). */
  readonly meter = signal<VoiceMeter | null>(null);

  private readonly vad = new VoiceActivityDetector();
  private stream: MediaStream | null = null;
  private nodes: AudioNode[] = [];
  private handlers: ListenerHandlers | null = null;
  private preRoll: Float32Array[] = [];
  private utterance: Float32Array[] | null = null;
  private static workletLoaded = new WeakSet<BaseAudioContext>();

  /**
   * - `off`: escucha pero ignora (Nimbo está pensando, o estás en pausa).
   * - `listening`: tu turno.
   * - `barge-in`: Nimbo habla; solo una voz clara y sostenida lo interrumpe.
   */
  set mode(mode: VadMode) {
    this.vad.mode = mode;
    if (mode === 'off') this.utterance = null;
  }

  get mode(): VadMode {
    return this.vad.mode;
  }

  /** Pide el micrófono y empieza a escuchar (en modo `off` hasta que lo cambies). */
  async start(handlers: ListenerHandlers): Promise<void> {
    if (this.stream?.active) {
      this.handlers = handlers;
      return;
    }
    this.engine.unlock();
    const ctx = this.engine.running;
    if (!ctx) throw new Error('El audio del navegador no está activo.');

    this.stream = await navigator.mediaDevices.getUserMedia({
      // Cancelación de eco: reduce que el micrófono escuche a Nimbo por los parlantes.
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (!HandsFreeListener.workletLoaded.has(ctx)) {
      await ctx.audioWorklet.addModule('/audio/mic-worklet.js');
      HandsFreeListener.workletLoaded.add(ctx);
    }

    const source = ctx.createMediaStreamSource(this.stream);
    const worklet = new AudioWorkletNode(ctx, 'mic-processor');
    // El navegador solo procesa nodos conectados a la salida. Ganancia 0 = no te
    // escuchas por los parlantes, pero el worklet sigue funcionando.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(worklet).connect(mute).connect(ctx.destination);
    worklet.port.onmessage = (e: MessageEvent<{ rms: number; samples: Float32Array }>) =>
      this.onBlock(e.data.rms, e.data.samples);

    this.nodes = [source, worklet, mute];
    this.meter.set(this.engine.meter(ctx, source));
    this.handlers = handlers;
    this.vad.mode = 'off';
  }

  stop(): void {
    this.nodes.forEach((n) => n.disconnect());
    this.nodes = [];
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.meter.set(null);
    this.handlers = null;
    this.utterance = null;
    this.vad.mode = 'off';
  }

  private onBlock(rms: number, samples: Float32Array): void {
    this.preRoll.push(samples);
    if (this.preRoll.length > PRE_ROLL_BLOCKS) this.preRoll.shift();

    const event = this.vad.push(rms, BLOCK_MS);
    if (event === 'speech-start') {
      this.utterance = [...this.preRoll];
      this.handlers?.onSpeechStart();
      return;
    }
    if (!this.utterance) return;
    this.utterance.push(samples);

    const durationMs = this.utterance.length * BLOCK_MS;
    if (event === 'speech-end' || durationMs >= MAX_UTTERANCE_MS) {
      const blocks = this.utterance;
      this.utterance = null;
      this.vad.reset();
      const speechMs = durationMs - PRE_ROLL_BLOCKS * BLOCK_MS - DEFAULT_VAD.silenceToEndMs;
      if (event === 'speech-end' && speechMs < MIN_SPEECH_MS) {
        this.handlers?.onDiscard();
        return;
      }
      if (event === 'speech-end') {
        const trailing = DEFAULT_VAD.silenceToEndMs / BLOCK_MS;
        blocks.splice(blocks.length - trailing + KEEP_TRAILING_SILENCE_BLOCKS);
      }
      this.handlers?.onUtterance(encodeWav(concat(blocks), SAMPLE_RATE), blocks.length * BLOCK_MS);
    }
  }
}

function concat(blocks: Float32Array[]): Float32Array {
  const out = new Float32Array(blocks.reduce((n, b) => n + b.length, 0));
  let offset = 0;
  for (const b of blocks) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
}
