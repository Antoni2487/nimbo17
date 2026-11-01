from dataclasses import dataclass, field
from typing import Literal, Protocol

CorrectionKind = Literal["grammar", "vocabulary", "pronunciation", "naturalness"]


@dataclass(frozen=True)
class Correction:
    original: str
    corrected: str
    explanation: str
    kind: CorrectionKind = "grammar"


@dataclass(frozen=True)
class LLMUsage:
    # input_tokens = TODOS los tokens de entrada, incluidos los que salieron de la caché.
    # cached_tokens = cuántos de esos se leyeron de la caché (cuestan ~10 % del precio).
    input_tokens: int = 0
    output_tokens: int = 0
    cached_tokens: int = 0


@dataclass(frozen=True)
class TutorReply:
    text: str  # lo que Nimbo dice en voz alta
    corrections: list[Correction] = field(default_factory=list)  # va aparte, a la BD/UI
    usage: LLMUsage = field(default_factory=LLMUsage)


class LLMConversation(Protocol):
    """Una conversación en curso.

    Cada proveedor guarda el historial en SU formato (Claude tiene bloques de
    thinking y tool_use que hay que devolver intactos). Por eso el historial
    vive dentro de este objeto y no en el resto de la app.
    """

    async def send(self, user_text: str) -> TutorReply: ...


class LLMProvider(Protocol):
    def start_conversation(self, system_prompt: str) -> LLMConversation: ...
