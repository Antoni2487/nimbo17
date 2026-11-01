import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AudioEngine } from '../../core/audio/audio-engine';
import { VadMode } from '../../core/audio/vad';
import { AudioPlayer } from '../../core/services/audio-player';
import { HandsFreeListener, ListenerHandlers } from '../../core/services/hands-free-listener';
import { TutorApi } from '../../core/services/tutor-api';
import { NUDGE_DELAY_MS, PracticeSession } from './practice-session';

const tutor = (text: string) => ({
  text,
  corrections: [],
  audio_base64: 'AAAA',
  audio_mime_type: 'audio/wav',
  warning: null,
});

/** Micrófono falso: el test decide cuándo "hablas". */
class FakeListener {
  meter = signal(null);
  mode: VadMode = 'off';
  handlers: ListenerHandlers | null = null;
  start = vi.fn(async (h: ListenerHandlers) => {
    this.handlers = h;
  });
  stop = vi.fn();

  speak(): void {
    this.handlers?.onSpeechStart();
  }
  async finishSpeaking(): Promise<void> {
    this.handlers?.onUtterance(new Blob(['wav']), 1500);
    await vi.waitFor(() => expect(api.sendTurn).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r));
  }
}

const api = {
  startSession: vi.fn(async () => ({
    session_id: 's1',
    mode: 'travel',
    level: 'A2',
    tutor: tutor('Hola Antoni! Where are you flying today?'),
  })),
  sendTurn: vi.fn(async () => ({
    transcript: 'I go to Cusco',
    tutor: {
      ...tutor('Ojo, se dice I am going. Why Cusco?'),
      corrections: [
        { original: 'I go', corrected: "I'm going", explanation: 'Plan futuro', kind: 'grammar' },
      ],
    },
  })),
  nudge: vi.fn(async (): Promise<unknown> => tutor('Tranqui, puedes empezar con: I like to...')),
  endSession: vi.fn(async () => ({})),
};

describe('PracticeSession (manos libres)', () => {
  let session: PracticeSession;
  let listener: FakeListener;
  let finishPlayback: () => void;
  const player = {
    meter: signal(null),
    playBase64: vi.fn(() => new Promise<void>((resolve) => (finishPlayback = resolve))),
    stop: vi.fn(() => finishPlayback?.()),
  };

  /** Arranca y deja que Nimbo termine de saludar. */
  async function startAndGreet(): Promise<void> {
    const started = session.start('travel', 'A2');
    await vi.waitFor(() => expect(player.playBase64).toHaveBeenCalled());
    expect(listener.mode).toBe('barge-in'); // mientras habla, se le puede interrumpir
    finishPlayback();
    await started;
  }

  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    vi.clearAllMocks();
    listener = new FakeListener();
    TestBed.configureTestingModule({
      providers: [
        PracticeSession,
        { provide: TutorApi, useValue: api },
        { provide: HandsFreeListener, useValue: listener },
        { provide: AudioPlayer, useValue: player },
        { provide: AudioEngine, useValue: { unlock: vi.fn() } },
      ],
    });
    session = TestBed.inject(PracticeSession);
  });

  it('greets, then listens without any button', async () => {
    await startAndGreet();
    expect(session.messages().map((m) => m.text)).toEqual([
      'Hola Antoni! Where are you flying today?',
    ]);
    expect(session.status()).toBe('ready');
    expect(listener.mode).toBe('listening');
  });

  it('a spoken phrase becomes a turn, with corrections on the user message', async () => {
    await startAndGreet();
    listener.speak();
    expect(session.tutorState()).toBe('listening');

    await listener.finishSpeaking();
    expect(listener.mode).toBe('barge-in'); // Nimbo responde hablando
    finishPlayback();
    await vi.waitFor(() => expect(session.status()).toBe('ready'));

    const [, user, reply] = session.messages();
    expect(user.corrections[0].corrected).toBe("I'm going");
    expect(reply.text).toContain('Why Cusco?');
  });

  it('talking while Nimbo speaks interrupts him', async () => {
    const started = session.start('travel', 'A2');
    await vi.waitFor(() => expect(session.status()).toBe('speaking'));
    listener.speak();
    await started;
    expect(player.stop).toHaveBeenCalled();
    expect(session.status()).toBe('recording');
  });

  it('a cough or a knock goes back to listening', async () => {
    await startAndGreet();
    listener.speak();
    listener.handlers?.onDiscard();
    expect(session.status()).toBe('ready');
    expect(api.sendTurn).not.toHaveBeenCalled();
  });

  it('pause stops listening and hints; continue resumes', async () => {
    vi.useFakeTimers();
    await startAndGreet();
    session.togglePause();
    expect(listener.mode).toBe('off');
    listener.speak();
    expect(session.status()).toBe('ready'); // en pausa no te graba
    await vi.advanceTimersByTimeAsync(NUDGE_DELAY_MS * 2);
    expect(api.nudge).not.toHaveBeenCalled();

    session.togglePause();
    expect(listener.mode).toBe('listening');
  });

  it('gives a hint after a long silence, then waits quietly when hints run out', async () => {
    vi.useFakeTimers();
    await startAndGreet();

    await vi.advanceTimersByTimeAsync(NUDGE_DELAY_MS);
    expect(api.nudge).toHaveBeenCalledOnce();
    finishPlayback();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.messages().at(-1)?.text).toContain('Tranqui');

    api.nudge.mockRejectedValueOnce(new HttpErrorResponse({ status: 409 }));
    await vi.advanceTimersByTimeAsync(NUDGE_DELAY_MS);
    expect(api.nudge).toHaveBeenCalledTimes(2);
    expect(session.error()).toBeNull();
    expect(session.status()).toBe('ready');
  });

  it('does not give a hint if the student starts talking', async () => {
    vi.useFakeTimers();
    await startAndGreet();
    listener.speak();
    await vi.advanceTimersByTimeAsync(NUDGE_DELAY_MS * 2);
    expect(api.nudge).not.toHaveBeenCalled();
  });

  it('microphone permission denied shows a clear message', async () => {
    listener.start.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    await session.start('travel', 'A2');
    expect(session.error()).toContain('permiso');
    expect(session.status()).toBe('setup');
  });
});
