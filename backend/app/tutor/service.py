"""Orquestador de un turno de conversación: audio → texto → respuesta → voz.

TutorService no sabe NADA de OpenAI ni de Anthropic: recibe los proveedores ya
construidos (inyección de dependencias). Eso permite probarlo con proveedores falsos.
"""

import logging
from dataclasses import dataclass, field

from app.providers.errors import ProviderError
from app.providers.llm.base import Correction, LLMProvider, TutorReply
from app.providers.stt.base import STTProvider
from app.providers.tts.base import SpeechAudio, TTSProvider
from app.tutor.prompts import LEVELS, SESSION_START_MESSAGE, build_system_prompt
from app.tutor.session import InMemorySessionStore, TutorSession
from app.tutor.types import Level, PracticeMode

log = logging.getLogger(__name__)


class EmptyTranscriptError(Exception):
    """El audio no tenía voz reconocible (silencio, ruido, clic accidental)."""


@dataclass(frozen=True)
class TutorMessage:
    text: str
    audio: SpeechAudio | None  # None si falló el TTS: al menos se muestra el texto
    corrections: list[Correction] = field(default_factory=list)
    warning: str | None = None


@dataclass(frozen=True)
class TurnResult:
    transcript: str
    tutor: TutorMessage


class TutorService:
    def __init__(
        self,
        stt: STTProvider,
        llm: LLMProvider,
        tts: TTSProvider,
        store: InMemorySessionStore,
    ) -> None:
        self._stt = stt
        self._llm = llm
        self._tts = tts
        self._store = store

    async def start_session(
        self, mode: PracticeMode, level: Level
    ) -> tuple[TutorSession, TutorMessage]:
        conversation = self._llm.start_conversation(build_system_prompt(mode, level))
        session = TutorSession(mode=mode, level=level, conversation=conversation)

        # Nimbo abre la conversación (saludo + primera pregunta).
        reply = await conversation.send(SESSION_START_MESSAGE)
        message = await self._speak(session, reply)

        # Solo guardamos la sesión si el saludo funcionó.
        self._store.add(session)
        log.info("Session %s started (mode=%s, level=%s)", session.id, mode, level)
        return session, message

    async def handle_turn(self, session_id: str, audio: bytes, mime_type: str) -> TurnResult:
        session = self._store.get(session_id)

        transcription = await self._stt.transcribe(audio, mime_type)
        session.usage.stt_seconds += transcription.duration_s or 0.0
        if not transcription.text:
            raise EmptyTranscriptError

        reply = await session.conversation.send(transcription.text)
        message = await self._speak(session, reply)
        session.turns += 1

        log.info(
            "Session %s turn %d: %d corrections | usage=%s",
            session.id,
            session.turns,
            len(reply.corrections),
            session.usage,
        )
        return TurnResult(transcript=transcription.text, tutor=message)

    def end_session(self, session_id: str) -> TutorSession:
        session = self._store.remove(session_id)
        log.info(
            "Session %s ended after %d turns | usage=%s", session.id, session.turns, session.usage
        )
        return session

    async def _speak(self, session: TutorSession, reply: TutorReply) -> TutorMessage:
        session.usage.llm_input_tokens += reply.usage.input_tokens
        session.usage.llm_output_tokens += reply.usage.output_tokens

        try:
            audio = await self._tts.synthesize(reply.text, speed=LEVELS[session.level].tts_speed)
        except ProviderError as e:
            # Degradación elegante: la conversación sigue aunque no haya voz.
            log.warning("TTS failed, returning text only: %s", e)
            return TutorMessage(
                text=reply.text,
                audio=None,
                corrections=reply.corrections,
                warning=e.user_message,
            )
        session.usage.tts_characters += len(reply.text)
        return TutorMessage(text=reply.text, audio=audio, corrections=reply.corrections)
