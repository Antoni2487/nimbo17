import logging
from collections.abc import Sequence

import openai

from app.providers.errors import ProviderError
from app.providers.stt.base import Transcription

log = logging.getLogger(__name__)

_EXTENSIONS = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
}


class OpenAIWhisperSTT:
    """Whisper vía cualquier API compatible con OpenAI.

    Groq expone la misma API que OpenAI (otra URL y otra key), así que esta misma
    clase sirve para los dos: el factory le pasa un cliente apuntando a cada servicio.
    `service_name` solo se usa para que los mensajes de error digan a quién culpar.
    """

    def __init__(
        self,
        client: openai.AsyncOpenAI,
        model: str = "whisper-1",
        service_name: str = "OpenAI",
    ) -> None:
        self._client = client
        self._model = model
        self._service = service_name

    async def transcribe(
        self, audio: bytes, mime_type: str, hint_words: Sequence[str] = ()
    ) -> Transcription:
        # "audio/webm;codecs=opus" -> "audio/webm"
        base_mime = mime_type.split(";")[0].strip().lower()
        filename = f"speech.{_EXTENSIONS.get(base_mime, 'webm')}"

        # Sin `language`: dejamos que detecte el idioma, porque el usuario
        # a veces habla en español ("¿cómo se dice confianza?").
        # `prompt` sesga a Whisper hacia palabras esperadas (vocabulario de la charla).
        prompt = ", ".join(hint_words) if hint_words else openai.omit
        # Los modelos whisper-* (OpenAI y Groq) devuelven idioma y duración con verbose_json;
        # los gpt-4o-*-transcribe no lo soportan.
        verbose = self._model.startswith("whisper")

        try:
            result = await self._client.audio.transcriptions.create(
                model=self._model,
                file=(filename, audio, base_mime),
                prompt=prompt,
                response_format="verbose_json" if verbose else "json",
            )
        except openai.AuthenticationError as e:
            raise ProviderError(
                "stt", f"La API key de {self._service} no es válida.", str(e)
            ) from e
        except openai.RateLimitError as e:
            raise ProviderError(
                "stt", f"Demasiadas solicitudes a {self._service}; espera un momento."
            ) from e
        except openai.APIError as e:
            log.exception("STT failed")
            raise ProviderError("stt", "No pude transcribir tu audio. Intenta otra vez.") from e

        return Transcription(
            text=result.text.strip(),
            language=getattr(result, "language", None),
            duration_s=getattr(result, "duration", None),
        )
