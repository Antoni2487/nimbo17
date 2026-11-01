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
from app.tutor.prompts import (
    LEVELS,
    NUDGE_MESSAGES,
    build_system_prompt,
    session_start_message,
)
from app.tutor.session import InMemorySessionStore, TutorSession
from app.tutor.speech import plain_text, split_languages
from app.tutor.types import Level, PracticeMode

log = logging.getLogger(__name__)


class EmptyTranscriptError(Exception):
    """El audio no tenía voz reconocible (silencio, ruido, clic accidental)."""


class NoMoreNudgesError(Exception):
    """Ya se dieron todas las pistas para esta pregunta: Nimbo espera sin insistir."""


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
        student_name: str = "",
    ) -> None:
        self._stt = stt
        self._llm = llm
        self._tts = tts
        self._store = store
        self._student_name = student_name
        # Whisper no conoce "Nimbo" y lo transcribe como "Nimble" o "Limbo". Pasarle
        # los nombres propios como pista mejora mucho cómo los escribe.
        self._hint_words = tuple(w for w in ("Nimbo", student_name) if w)

    async def start_session(
        self, mode: PracticeMode, level: Level
    ) -> tuple[TutorSession, TutorMessage]:
        prompt = build_system_prompt(mode, level, self._student_name)
        conversation = self._llm.start_conversation(prompt)
        session = TutorSession(mode=mode, level=level, conversation=conversation)

        # Nimbo abre la conversación (saludo por tu nombre + primera pregunta).
        reply = await conversation.send(session_start_message(self._student_name))
        message = await self._speak(session, reply)

        # Solo guardamos la sesión si el saludo funcionó.
        self._store.add(session)
        log.info("Session %s started (mode=%s, level=%s)", session.id, mode, level)
        return session, message

    async def handle_turn(self, session_id: str, audio: bytes, mime_type: str) -> TurnResult:
        session = self._store.get(session_id)

        transcription = await self._stt.transcribe(audio, mime_type, self._hint_words)
        session.usage.stt_seconds += transcription.duration_s or 0.0
        if not transcription.text:
            raise EmptyTranscriptError

        reply = await session.conversation.send(transcription.text)
        message = await self._speak(session, reply)
        session.turns += 1
        session.nudges = 0  # respondió: la próxima pregunta vuelve a tener sus pistas

        log.info(
            "Session %s turn %d: %d corrections | usage=%s",
            session.id,
            session.turns,
            len(reply.corrections),
            session.usage,
        )
        return TurnResult(transcript=transcription.text, tutor=message)

    async def nudge(self, session_id: str) -> TutorMessage:
        """El estudiante se quedó callado: Nimbo le da una pista (cada vez más directa)."""
        session = self._store.get(session_id)
        if session.nudges >= len(NUDGE_MESSAGES):
            raise NoMoreNudgesError
        reply = await session.conversation.send(NUDGE_MESSAGES[session.nudges])
        session.nudges += 1
        log.info("Session %s: nudge %d", session.id, session.nudges)
        return await self._speak(session, reply)

    def end_session(self, session_id: str) -> TutorSession:
        session = self._store.remove(session_id)
        log.info(
            "Session %s ended after %d turns | usage=%s", session.id, session.turns, session.usage
        )
        return session

    async def _speak(self, session: TutorSession, reply: TutorReply) -> TutorMessage:
        session.usage.llm_input_tokens += reply.usage.input_tokens
        session.usage.llm_output_tokens += reply.usage.output_tokens
        # Claude marca el español con <es>…</es>: el TTS recibe los tramos por idioma
        # y la UI el texto limpio.
        text = plain_text(reply.text)
        segments = split_languages(reply.text)

        try:
            audio = await self._tts.synthesize(segments, speed=LEVELS[session.level].tts_speed)
        except ProviderError as e:
            # Degradación elegante: la conversación sigue aunque no haya voz.
            log.warning("TTS failed, returning text only: %s", e)
            return TutorMessage(
                text=text,
                audio=None,
                corrections=reply.corrections,
                warning=e.user_message,
            )
        session.usage.tts_characters += len(text)
        return TutorMessage(text=text, audio=audio, corrections=reply.corrections)
