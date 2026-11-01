"""Proveedor LLM con Claude (SDK oficial de Anthropic).

Cómo separamos "lo que se habla" de "las correcciones":
Claude responde con texto normal (eso va al TTS) y además llama a la herramienta
`record_corrections` con las correcciones en JSON. Así el texto hablado queda
limpio y las correcciones llegan estructuradas, validadas por un schema.
"""

import logging
from typing import Any

import anthropic

from app.providers.errors import ProviderError
from app.providers.llm.base import Correction, LLMUsage, TutorReply
from app.tutor.prompts import CORRECTIONS_TOOL_DESCRIPTION, CORRECTIONS_TOOL_NAME

log = logging.getLogger(__name__)

CORRECTIONS_TOOL: dict[str, Any] = {
    "name": CORRECTIONS_TOOL_NAME,
    "description": CORRECTIONS_TOOL_DESCRIPTION,
    "strict": True,  # garantiza que el input cumpla exactamente el schema
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["corrections"],
        "properties": {
            "corrections": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["original", "corrected", "explanation", "kind"],
                    "properties": {
                        "original": {"type": "string"},
                        "corrected": {"type": "string"},
                        "explanation": {"type": "string"},
                        "kind": {
                            "type": "string",
                            "enum": ["grammar", "vocabulary", "pronunciation", "naturalness"],
                        },
                    },
                },
            }
        },
    },
}

# Si Claude llama la herramienta sin decir nada todavía, le devolvemos el
# tool_result y le pedimos que hable. Este límite evita un bucle infinito.
_MAX_ROUNDS = 3


class ClaudeConversation:
    def __init__(
        self,
        client: anthropic.AsyncAnthropic,
        *,
        model: str,
        effort: str,
        max_tokens: int,
        system_prompt: str,
    ) -> None:
        self._client = client
        self._model = model
        self._effort = effort
        self._max_tokens = max_tokens
        self._system = system_prompt
        # Historial en formato Anthropic. Solo se AGREGA (append-only): los bloques
        # de thinking y tool_use se devuelven tal cual llegaron, sin editarlos.
        self._messages: list[Any] = []
        # tool_use que quedaron sin responder; su tool_result va en el siguiente turno.
        self._pending_tool_ids: list[str] = []

    async def send(self, user_text: str) -> TutorReply:
        # Snapshot para deshacer si la llamada falla: la API nunca vio este turno,
        # así que la sesión queda como estaba y el usuario puede reintentar.
        checkpoint = (len(self._messages), list(self._pending_tool_ids))
        try:
            return await self._send(user_text)
        except Exception:
            del self._messages[checkpoint[0] :]
            self._pending_tool_ids = checkpoint[1]
            raise

    async def _send(self, user_text: str) -> TutorReply:
        content: list[dict[str, Any]] = [_tool_result(i) for i in self._pending_tool_ids]
        content.append({"type": "text", "text": user_text})
        self._messages.append({"role": "user", "content": content})
        self._pending_tool_ids = []

        texts: list[str] = []
        corrections: list[Correction] = []
        input_tokens = output_tokens = cached_tokens = 0

        for _ in range(_MAX_ROUNDS):
            response = await self._create()
            # Con prompt caching, `input_tokens` solo cuenta lo que NO estaba en caché;
            # lo cacheado viene aparte. Sumamos todo para registrar el uso real.
            u = response.usage
            cache_read = getattr(u, "cache_read_input_tokens", None) or 0
            cache_write = getattr(u, "cache_creation_input_tokens", None) or 0
            input_tokens += u.input_tokens + cache_read + cache_write
            cached_tokens += cache_read
            output_tokens += u.output_tokens

            if response.stop_reason == "refusal":
                raise ProviderError("llm", "Nimbo no pudo responder a eso. Prueba con otra frase.")

            self._messages.append({"role": "assistant", "content": response.content})

            tool_ids: list[str] = []
            for block in response.content:
                if block.type == "text":
                    texts.append(block.text)
                elif block.type == "tool_use" and block.name == CORRECTIONS_TOOL_NAME:
                    tool_ids.append(block.id)
                    corrections.extend(_parse_corrections(block.input))

            if response.stop_reason != "tool_use":
                break
            if "".join(texts).strip():
                # Ya habló: respondemos el tool_use al inicio del próximo turno.
                self._pending_tool_ids = tool_ids
                break
            # Llamó la herramienta pero aún no habló: devolvemos el resultado y seguimos.
            self._messages.append({"role": "user", "content": [_tool_result(i) for i in tool_ids]})

        text = " ".join(t.strip() for t in texts if t.strip())
        if not text:
            raise ProviderError("llm", "Nimbo se quedó sin palabras. Intenta otra vez.")
        return TutorReply(
            text=text,
            corrections=corrections,
            usage=LLMUsage(
                input_tokens=input_tokens, output_tokens=output_tokens, cached_tokens=cached_tokens
            ),
        )

    async def _create(self) -> Any:
        try:
            return await self._client.messages.create(
                model=self._model,
                max_tokens=self._max_tokens,
                system=self._system,
                messages=self._messages,
                tools=[CORRECTIONS_TOOL],
                tool_choice={"type": "auto"},
                output_config={"effort": self._effort},
                # Cachea el prefijo (system + historial): cada turno reenvía todo,
                # así que esto baja costo y latencia en conversaciones largas.
                cache_control={"type": "ephemeral"},
            )
        except anthropic.AuthenticationError as e:
            raise ProviderError("llm", "La API key de Anthropic no es válida.", str(e)) from e
        except anthropic.RateLimitError as e:
            raise ProviderError("llm", "Nimbo está saturado; espera unos segundos.") from e
        except anthropic.APIConnectionError as e:
            raise ProviderError("llm", "No hay conexión con el servidor de Claude.") from e
        except anthropic.APIStatusError as e:
            log.exception("LLM request failed (request_id=%s)", e.request_id)
            raise ProviderError("llm", "Nimbo tuvo un problema al pensar. Intenta otra vez.") from e


class AnthropicClaudeLLM:
    def __init__(
        self, client: anthropic.AsyncAnthropic, *, model: str, effort: str, max_tokens: int
    ) -> None:
        self._client = client
        self._model = model
        self._effort = effort
        self._max_tokens = max_tokens

    def start_conversation(self, system_prompt: str) -> ClaudeConversation:
        return ClaudeConversation(
            self._client,
            model=self._model,
            effort=self._effort,
            max_tokens=self._max_tokens,
            system_prompt=system_prompt,
        )


def _tool_result(tool_use_id: str) -> dict[str, Any]:
    return {"type": "tool_result", "tool_use_id": tool_use_id, "content": "saved"}


def _parse_corrections(raw: Any) -> list[Correction]:
    items = raw.get("corrections", []) if isinstance(raw, dict) else []
    result: list[Correction] = []
    for item in items:
        try:
            result.append(
                Correction(
                    original=str(item["original"]),
                    corrected=str(item["corrected"]),
                    explanation=str(item["explanation"]),
                    kind=item.get("kind", "grammar"),
                )
            )
        except (KeyError, TypeError):
            log.warning("Ignoring malformed correction: %r", item)
    return result
