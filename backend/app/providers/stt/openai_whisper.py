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
    def __init__(self, client: openai.AsyncOpenAI, model: str = "whisper-1") -> None:
        self._client = client
        self._model = model

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
        verbose = self._model == "whisper-1"  # solo whisper-1 da idioma y duración

        try:
            result = await self._client.audio.transcriptions.create(
                model=self._model,
                file=(filename, audio, base_mime),
                prompt=prompt,
                response_format="verbose_json" if verbose else "json",
            )
        except openai.AuthenticationError as e:
            raise ProviderError("stt", "La API key de OpenAI no es válida.", str(e)) from e
        except openai.RateLimitError as e:
            raise ProviderError("stt", "Demasiadas solicitudes a OpenAI; espera un momento.") from e
        except openai.APIError as e:
            log.exception("STT failed")
            raise ProviderError("stt", "No pude transcribir tu audio. Intenta otra vez.") from e

        return Transcription(
            text=result.text.strip(),
            language=getattr(result, "language", None),
            duration_s=getattr(result, "duration", None),
        )
