import { VoiceActivityDetector } from './vad';

const BLOCK_MS = 20;

function feed(vad: VoiceActivityDetector, rms: number, ms: number): string[] {
  const events: string[] = [];
  for (let t = 0; t < ms; t += BLOCK_MS) {
    const e = vad.push(rms, BLOCK_MS);
    if (e) events.push(e);
  }
  return events;
}

describe('VoiceActivityDetector', () => {
  let vad: VoiceActivityDetector;
  beforeEach(() => {
    vad = new VoiceActivityDetector();
    vad.mode = 'listening';
    feed(vad, 0.003, 1000); // un segundo de silencio para aprender el ruido
  });

  it('detects a phrase: start when you talk, end after a long pause', () => {
    expect(feed(vad, 0.08, 1500)).toEqual(['speech-start']);
    expect(feed(vad, 0.003, 1000)).toEqual([]); // una pausa para pensar NO corta
    expect(feed(vad, 0.003, 300)).toEqual(['speech-end']);
  });

  it('short pauses between words do not end the turn', () => {
    feed(vad, 0.08, 500);
    const events = [...feed(vad, 0.003, 600), ...feed(vad, 0.08, 500), ...feed(vad, 0.003, 600)];
    expect(events).toEqual([]);
    expect(vad.isSpeaking).toBe(true);
  });

  it('a click or a cough does not start a turn', () => {
    expect(feed(vad, 0.2, 60)).toEqual([]);
    expect(feed(vad, 0.003, 200)).toEqual([]);
  });

  it('adapts to background noise', () => {
    // Se prende un ventilador: al principio parece voz, pero en ~2 s lo aprende como ruido…
    expect(feed(vad, 0.02, 4000)).toEqual(['speech-start', 'speech-end']);
    // …y desde ahí lo ignora, pero te sigue escuchando por encima de él.
    expect(feed(vad, 0.02, 3000)).toEqual([]);
    expect(feed(vad, 0.15, 500)).toEqual(['speech-start']);
  });

  it('barge-in needs louder and longer speech (so Nimbo does not interrupt himself)', () => {
    vad.mode = 'barge-in';
    // Su voz por los parlantes: sílabas a volumen medio, con pausas entre ellas.
    const echo = [...Array(50)].flatMap((_, i) => feed(vad, i % 3 ? 0.035 : 0.004, BLOCK_MS));
    expect(echo).toEqual([]);
    expect(feed(vad, 0.12, 400)).toEqual(['speech-start']); // tú, hablando claro
  });

  it('off ignores everything', () => {
    vad.mode = 'off';
    expect(feed(vad, 0.2, 2000)).toEqual([]);
  });
});
