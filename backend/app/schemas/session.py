"""Modelos Pydantic del contrato HTTP (lo que entra y sale de la API).

Se separan de las dataclasses internas (TutorMessage, Correction...) a propósito:
así puedes cambiar la lógica interna sin romper el contrato con el frontend.
FastAPI usa estos modelos para validar la entrada y generar /docs automáticamente.
"""

import base64

from pydantic import BaseModel, Field

from app.providers.llm.base import CorrectionKind
from app.tutor.service import TutorMessage
from app.tutor.types import Level, PracticeMode


class StartSessionRequest(BaseModel):
    mode: PracticeMode = PracticeMode.FREE_TALK
    level: Level = Level.B1


class CorrectionOut(BaseModel):
    original: str
    corrected: str
    explanation: str
    kind: CorrectionKind


class TutorMessageOut(BaseModel):
    text: str
    corrections: list[CorrectionOut] = Field(default_factory=list)
    # Fase 1: audio en base64 dentro del JSON (simple, una sola petición).
    # En la Fase 2 (WebSocket) pasará a frames binarios para no inflar ~33 %.
    audio_base64: str | None = None
    audio_mime_type: str | None = None
    warning: str | None = None

    @classmethod
    def from_domain(cls, message: TutorMessage) -> "TutorMessageOut":
        return cls(
            text=message.text,
            corrections=[
                CorrectionOut(
                    original=c.original,
                    corrected=c.corrected,
                    explanation=c.explanation,
                    kind=c.kind,
                )
                for c in message.corrections
            ],
            audio_base64=base64.b64encode(message.audio.data).decode() if message.audio else None,
            audio_mime_type=message.audio.mime_type if message.audio else None,
            warning=message.warning,
        )


class StartSessionResponse(BaseModel):
    session_id: str
    mode: PracticeMode
    level: Level
    tutor: TutorMessageOut


class TurnResponse(BaseModel):
    transcript: str
    tutor: TutorMessageOut


class EndSessionResponse(BaseModel):
    session_id: str
    turns: int
