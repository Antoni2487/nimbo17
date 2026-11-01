import { levelOf } from './voice-meter';

describe('levelOf', () => {
  it('silence is 0', () => {
    expect(levelOf(new Float32Array(1024))).toBe(0);
  });

  it('louder voice gives a higher level, capped at 1', () => {
    const quiet = levelOf(new Float32Array(1024).fill(0.02));
    const loud = levelOf(new Float32Array(1024).fill(0.1));
    expect(quiet).toBeGreaterThan(0);
    expect(loud).toBeGreaterThan(quiet);
    expect(levelOf(new Float32Array(1024).fill(0.9))).toBe(1);
  });
});
