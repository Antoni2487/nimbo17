import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from app.providers.llm.base import LLMConversation
from app.tutor.types import Level, PracticeMode


@dataclass
class SessionUsage:
    """Uso acumulado de APIs por sesión, para controlar costos."""

    llm_input_tokens: int = 0
    llm_output_tokens: int = 0
    stt_seconds: float = 0.0
    tts_characters: int = 0


@dataclass
class TutorSession:
    mode: PracticeMode
    level: Level
    conversation: LLMConversation
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    turns: int = 0
    usage: SessionUsage = field(default_factory=SessionUsage)


class SessionNotFoundError(Exception):
    pass


class InMemorySessionStore:
    """Sesiones en memoria (Fase 1). En la Fase 4 se agrega persistencia en Postgres.

    Ojo: se pierden al reiniciar el servidor (incluido el --reload de uvicorn).
    """

    def __init__(self) -> None:
        self._sessions: dict[str, TutorSession] = {}

    def add(self, session: TutorSession) -> None:
        self._sessions[session.id] = session

    def get(self, session_id: str) -> TutorSession:
        try:
            return self._sessions[session_id]
        except KeyError:
            raise SessionNotFoundError(session_id) from None

    def remove(self, session_id: str) -> TutorSession:
        session = self.get(session_id)
        del self._sessions[session_id]
        return session
