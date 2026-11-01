// AudioWorklet del micrófono. Corre en el hilo de audio del navegador, que NO se
// congela cuando la pestaña está en segundo plano (los timers y requestAnimationFrame sí).
//
// Por cada bloque de ~20 ms envía al hilo principal:
//   - rms: el volumen del bloque (para el detector de voz)
//   - samples: el audio reducido a 16 kHz mono (lo que necesita Whisper)
const TARGET_RATE = 16000;
const BLOCK_SAMPLES = 320; // 20 ms a 16 kHz

class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE; // p. ej. 48000 / 16000 = 3
    this.acc = 0;
    this.count = 0;
    this.pos = 0;
    this.sumSquares = 0;
    this.seen = 0;
    this.out = new Float32Array(BLOCK_SAMPLES);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      const s = channel[i];
      this.sumSquares += s * s;
      this.seen++;
      // Reducción a 16 kHz promediando grupos de muestras (sirve aunque la
      // relación no sea entera, p. ej. 44100 / 16000).
      this.acc += s;
      this.count++;
      this.pos++;
      if (this.pos >= this.ratio) {
        this.out[this.filled++] = this.acc / this.count;
        this.acc = 0;
        this.count = 0;
        this.pos -= this.ratio;
        if (this.filled === BLOCK_SAMPLES) this.flush();
      }
    }
    return true; // seguir procesando
  }

  flush() {
    const rms = Math.sqrt(this.sumSquares / Math.max(this.seen, 1));
    const samples = this.out;
    // "transfer": se pasa el buffer sin copiarlo.
    this.port.postMessage({ rms, samples }, [samples.buffer]);
    this.out = new Float32Array(BLOCK_SAMPLES);
    this.filled = 0;
    this.sumSquares = 0;
    this.seen = 0;
  }
}

registerProcessor('mic-processor', MicProcessor);
