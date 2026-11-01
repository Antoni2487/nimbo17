import { POINTS, smoothWave, targetWave, wavePath } from './wave';

const peak = (wave: number[]) => Math.max(...wave.map(Math.abs));

function voice(level: number) {
  const waveform = new Float32Array(1024).map((_, i) => Math.sin(i / 8) * 0.3);
  return { level, waveform };
}

describe('wave', () => {
  it('always has POINTS values and starts and ends flat', () => {
    for (const state of ['idle', 'listening', 'thinking', 'speaking'] as const) {
      const wave = targetWave(state, null, 1.3);
      expect(wave.length).toBe(POINTS);
      expect(Math.abs(wave[0])).toBeLessThan(1e-6);
      expect(Math.abs(wave[POINTS - 1])).toBeLessThan(1e-3);
    }
  });

  it('idle is a calm, small wave', () => {
    expect(peak(targetWave('idle', null, 0.5))).toBeLessThan(0.1);
  });

  it('speaking follows the real waveform, taller when louder', () => {
    const soft = targetWave('speaking', voice(0.2), 0);
    const loud = targetWave('speaking', voice(0.9), 0);
    expect(peak(loud)).toBeGreaterThan(peak(soft));
    expect(peak(loud)).toBeLessThanOrEqual(1);
  });

  it('your voice is drawn smaller than Nimbo’s', () => {
    expect(peak(targetWave('listening', voice(0.8), 0))).toBeLessThan(
      peak(targetWave('speaking', voice(0.8), 0)),
    );
  });

  it('thinking pulse travels across the line', () => {
    const where = (t: number) => {
      const wave = targetWave('thinking', null, t).map(Math.abs);
      return wave.indexOf(Math.max(...wave));
    };
    expect(where(0.8)).toBeGreaterThan(where(0.4));
  });

  it('rises fast and falls slowly', () => {
    const flat = new Array(POINTS).fill(0);
    const tall = new Array(POINTS).fill(1);
    expect(smoothWave(flat, tall)[10]).toBeGreaterThan(1 - smoothWave(tall, flat)[10]);
  });

  it('builds a smooth SVG path across the screen', () => {
    const d = wavePath(new Array(POINTS).fill(0), 20, 200, 80, 40);
    expect(d.startsWith('M 20.0 80.0')).toBe(true);
    expect(d.endsWith('220.0 80.0')).toBe(true);
    expect(d.match(/C /g)?.length).toBe(POINTS - 1);
  });
});
