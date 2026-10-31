from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Transcription:
    text: str
    language: str | None = None  # idioma detectado, p. ej. "english" o "spanish"
    duration_s: float | None = None  # para registrar costos


class STTProvider(Protocol):
    """Voz → texto. Cualquier clase con este método cumple el contrato (tipado estructural)."""

    async def transcribe(
        self, audio: bytes, mime_type: str, hint_words: Sequence[str] = ()
    ) -> Transcription: ...
