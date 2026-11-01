import { encodeWav } from './wav';

describe('encodeWav', () => {
  it('writes a valid 16 kHz mono 16-bit header and clamps samples', async () => {
    const blob = encodeWav(new Float32Array([0, 1, -1, 2]), 16000);
    const view = new DataView(await blob.arrayBuffer());
    const ascii = (o: number) => String.fromCharCode(...new Uint8Array(view.buffer, o, 4));

    expect(blob.type).toBe('audio/wav');
    expect(ascii(0)).toBe('RIFF');
    expect(ascii(8)).toBe('WAVE');
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(8);
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([
      0, 32767, -32768, 32767,
    ]);
  });
});
