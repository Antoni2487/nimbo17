from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class SpeechAudio:
    data: bytes
    mime_type: str  # p. ej. "audio/mpeg"


class TTSProvider(Protocol):
    """Texto → voz."""

    async def synthesize(self, text: str, *, speed: float = 1.0) -> SpeechAudio:
        """`speed`: 1.0 = normal, < 1.0 más lento (útil en niveles bajos)."""
        ...
