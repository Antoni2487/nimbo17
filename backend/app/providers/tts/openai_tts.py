import logging

import openai

from app.providers.errors import ProviderError
from app.providers.tts.base import SpeechAudio, SpeechSegment

log = logging.getLogger(__name__)

_BASE_STYLE = (
    "You are Nimbo, a warm and playful English tutor. Sound friendly and natural. "
    "Read Spanish parts with a neutral Latin American accent."
)


class OpenAITTS:
    def __init__(
        self, client: openai.AsyncOpenAI, model: str = "gpt-4o-mini-tts", voice: str = "nova"
    ) -> None:
        self._client = client
        self._model = model
        self._voice = voice

    async def synthesize(self, segments: list[SpeechSegment], *, speed: float = 1.0) -> SpeechAudio:
        # Los modelos de OpenAI son multilingües: les pasamos todo junto y ellos
        # cambian de idioma solos, sin cortes entre tramos.
        text = " ".join(s.text for s in segments)
        # Los modelos gpt-4o-*-tts no usan `speed`: aceptan instrucciones de estilo
        # en lenguaje natural. Los modelos tts-1 sí usan `speed` numérico.
        if self._model.startswith("gpt-4o"):
            style = _BASE_STYLE
            if speed < 0.95:
                style += " Speak slowly and clearly, with short pauses, for a language learner."
            extra = {"instructions": style}
        else:
            extra = {"speed": speed}

        try:
            response = await self._client.audio.speech.create(
                model=self._model,
                voice=self._voice,
                input=text,
                response_format="mp3",
                **extra,
            )
        except openai.AuthenticationError as e:
            raise ProviderError("tts", "La API key de OpenAI no es válida.", str(e)) from e
        except openai.APIError as e:
            log.exception("TTS failed")
            raise ProviderError("tts", "No pude generar la voz de Nimbo.") from e

        return SpeechAudio(data=response.content, mime_type="audio/mpeg")
