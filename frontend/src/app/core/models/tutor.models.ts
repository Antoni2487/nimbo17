// Espejo de los schemas Pydantic del backend (backend/app/schemas/session.py).

export type Level = 'A2' | 'B1' | 'B2' | 'C1';

export type PracticeMode =
  | 'free_talk'
  | 'job_interview'
  | 'travel'
  | 'university_life'
  | 'tech_talk';

export type CorrectionKind = 'grammar' | 'vocabulary' | 'pronunciation' | 'naturalness';

export interface Correction {
  original: string;
  corrected: string;
  explanation: string;
  kind: CorrectionKind;
}

export interface TutorMessage {
  text: string;
  corrections: Correction[];
  audio_base64: string | null;
  audio_mime_type: string | null;
  warning: string | null;
}

export interface StartSessionResponse {
  session_id: string;
  mode: PracticeMode;
  level: Level;
  tutor: TutorMessage;
}

export interface TurnResponse {
  transcript: string;
  tutor: TutorMessage;
}

/** Estado de la nube; en la Fase 2 lo enviará el servidor por WebSocket. */
export type TutorState = 'idle' | 'listening' | 'thinking' | 'speaking';
