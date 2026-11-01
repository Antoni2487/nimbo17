import { analyzeFrame } from './voice-meter';

const SAMPLE_RATE = 48000;
const BINS = 512; // fftSize 1024 → 512 bins de ~47 Hz

function freqWithEnergyAt(hz: number): Uint8Array {
  const data = new Uint8Array(BINS);
  data[Math.round(hz / (SAMPLE_RATE / 2 / BINS))] = 255;
  return data;
}

describe('analyzeFrame', () => {
  it('silence keeps the mouth closed', () => {
    const r = analyzeFrame(new Float32Array(1024), new Uint8Array(BINS), SAMPLE_RATE);
    expect(r.level).toBe(0);
    expect(r.brightness).toBe(0.5);
  });

  it('louder voice opens the mouth more, capped at 1', () => {
    const quiet = analyzeFrame(
      new Float32Array(1024).fill(0.02),
      new Uint8Array(BINS),
      SAMPLE_RATE,
    );
    const loud = analyzeFrame(new Float32Array(1024).fill(0.1), new Uint8Array(BINS), SAMPLE_RATE);
    const shout = analyzeFrame(new Float32Array(1024).fill(0.9), new Uint8Array(BINS), SAMPLE_RATE);
    expect(quiet.level).toBeGreaterThan(0);
    expect(loud.level).toBeGreaterThan(quiet.level);
    expect(shout.level).toBe(1);
  });

  it('high frequencies are bright, low frequencies are dark', () => {
    const time = new Float32Array(1024).fill(0.1);
    expect(analyzeFrame(time, freqWithEnergyAt(3000), SAMPLE_RATE).brightness).toBe(1);
    expect(analyzeFrame(time, freqWithEnergyAt(500), SAMPLE_RATE).brightness).toBe(0);
  });
});
