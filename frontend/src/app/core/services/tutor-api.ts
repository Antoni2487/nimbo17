import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  Level,
  PracticeMode,
  StartSessionResponse,
  TurnResponse,
  TutorMessage,
} from '../models/tutor.models';

/** Cliente HTTP del backend. Las rutas /api las redirige el proxy de `ng serve` a :8000. */
@Injectable({ providedIn: 'root' })
export class TutorApi {
  private readonly http = inject(HttpClient);

  // HttpClient devuelve Observables; para una sola respuesta, firstValueFrom
  // la convierte en Promise y así el flujo se lee con async/await.
  startSession(mode: PracticeMode, level: Level): Promise<StartSessionResponse> {
    return firstValueFrom(
      this.http.post<StartSessionResponse>('/api/sessions', { mode, level }),
    );
  }

  sendTurn(sessionId: string, audio: Blob): Promise<TurnResponse> {
    const form = new FormData();
    const ext = audio.type.includes('mp4') ? 'mp4' : audio.type.includes('ogg') ? 'ogg' : 'webm';
    form.append('audio', audio, `speech.${ext}`);
    return firstValueFrom(this.http.post<TurnResponse>(`/api/sessions/${sessionId}/turns`, form));
  }

  /** Pide una pista porque el estudiante se quedó callado. 409 = ya no hay más pistas. */
  nudge(sessionId: string): Promise<TutorMessage> {
    return firstValueFrom(this.http.post<TutorMessage>(`/api/sessions/${sessionId}/nudge`, {}));
  }

  endSession(sessionId: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`/api/sessions/${sessionId}`));
  }
}

/** Extrae el mensaje legible que manda el backend en {"detail": "..."}. */
/** El backend responde 409 cuando ya dio todas las pistas: no es un error para el usuario. */
export function isNoMoreNudges(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 409;
}

export function apiErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'No hay conexión con el servidor. ¿Está corriendo el backend?';
    const detail = error.error?.detail;
    if (typeof detail === 'string') return detail;
  }
  return 'Algo salió mal. Intenta otra vez.';
}
