from dataclasses import dataclass
from typing import Literal, Protocol

Language = Literal["en", "es"]


@dataclass(frozen=True)
class SpeechAudio:
    data: bytes
    mime_type: str  # p. ej. "audio/mpeg"


@dataclass(frozen=True)
class SpeechSegment:
    """Un tramo de texto en un solo idioma (Nimbo mezcla inglés y español)."""

    lang: Language
    text: str


class TTSProvider(Protocol):
    """Texto → voz.

    Recibe la respuesta ya separada por idioma para que cada proveedor decida cómo
    pronunciarla: Kokoro cambia de acento en cada tramo; OpenAI TTS, que es
    multilingüe, recibe todo junto.
    """

    async def synthesize(self, segments: list[SpeechSegment], *, speed: float = 1.0) -> SpeechAudio:
        """`speed`: 1.0 = normal, < 1.0 más lento (útil en niveles bajos)."""
        ...
