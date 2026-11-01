import { TestBed } from '@angular/core/testing';

import { signal } from '@angular/core';

import { AudioEngine } from '../../core/audio/audio-engine';
import { AudioPlayer } from '../../core/services/audio-player';
import { AudioRecorder } from '../../core/services/audio-recorder';
import { TutorApi } from '../../core/services/tutor-api';
import { HttpErrorResponse } from '@angular/common/http';

import { NUDGE_DELAY_MS, PracticeSession } from './practice-session';

const tutor = (text: string) => ({
  text,
  corrections: [],
  audio_base64: 'AAAA',
  audio_mime_type: 'audio/mpeg',
  warning: null,
});

describe('PracticeSession', () => {
  let session: PracticeSession;
  let recordDuration = 1500;

  const api = {
    startSession: vi.fn(async () => ({
      session_id: 's1',
      mode: 'travel',
      level: 'A2',
      tutor: tutor('Hi! Where are you flying today?'),
    })),
    sendTurn: vi.fn(async () => ({
      transcript: 'I go to Cusco',
      tutor: {
        ...tutor('Small fix: I am going. Why Cusco?'),
        corrections: [
          { original: 'I go', corrected: "I'm going", explanation: 'Future plan', kind: 'grammar' },
        ],
      },
    })),
    nudge: vi.fn(async (): Promise<unknown> => tutor('Tranqui, you can start with: I like to...')),
    endSession: vi.fn(async () => ({})),
  };
  const recorder = {
    meter: signal(null),
    isRecording: () => false,
    ensureMicrophone: vi.fn(async () => ({})),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => ({ blob: new Blob(['x']), durationMs: recordDuration })),
    release: vi.fn(),
  };
  const player = { meter: signal(null), playBase64: vi.fn(async () => undefined), stop: vi.fn() };

  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    recordDuration = 1500;
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        PracticeSession,
        { provide: TutorApi, useValue: api },
        { provide: AudioRecorder, useValue: recorder },
        { provide: AudioPlayer, useValue: player },
        { provide: AudioEngine, useValue: { unlock: vi.fn() } },
      ],
    });
    session = TestBed.inject(PracticeSession);
  });

  it('starts with a greeting and becomes ready', async () => {
    await session.start('travel', 'A2');
    expect(session.messages().map((m) => m.text)).toEqual(['Hi! Where are you flying today?']);
    expect(player.playBase64).toHaveBeenCalledOnce();
    expect(session.status()).toBe('ready');
  });

  it('records a turn and attaches corrections to the user message', async () => {
    await session.start('travel', 'A2');
    await session.beginRecording();
    expect(session.tutorState()).toBe('listening');

    await session.finishRecording();
    const [, user, reply] = session.messages();
    expect(user.role).toBe('user');
    expect(user.corrections[0].corrected).toBe("I'm going");
    expect(reply.text).toContain('Why Cusco?');
    expect(session.status()).toBe('ready');
  });

  it('ignores accidental short taps', async () => {
    await session.start('travel', 'A2');
    recordDuration = 100;
    await session.beginRecording();
    await session.finishRecording();
    expect(api.sendTurn).not.toHaveBeenCalled();
    expect(session.error()).toContain('Mantén presionado');
  });

  it('gives a hint after a long silence, then waits quietly when hints run out', async () => {
    vi.useFakeTimers();
    await session.start('travel', 'A2');

    await vi.advanceTimersByTimeAsync(NUDGE_DELAY_MS);
    expect(api.nudge).toHaveBeenCalledOnce();
    expect(session.messages().at(-1)?.text).toContain('Tranqui');

    api.nudge.mockRejectedValueOnce(new HttpErrorResponse({ status: 409 }));
    await vi.advanceTimersByTimeAsync(NUDGE_DELAY_MS);
    expect(api.nudge).toHaveBeenCalledTimes(2);
    expect(session.error()).toBeNull();
    expect(session.status()).toBe('ready');
  });

  it('does not give a hint if the student starts talking', async () => {
    vi.useFakeTimers();
    await session.start('travel', 'A2');
    await session.beginRecording();
    await vi.advanceTimersByTimeAsync(NUDGE_DELAY_MS * 2);
    expect(api.nudge).not.toHaveBeenCalled();
  });
});
