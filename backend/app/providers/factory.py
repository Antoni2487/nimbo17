"""Construye los proveedores activos según la configuración (.env).

Este es el ÚNICO lugar que conoce las clases concretas. Para agregar ElevenLabs:
crear providers/tts/elevenlabs.py con un método `synthesize`, sumar un `case` aquí
y un valor nuevo en `tts_provider` de config.py. Nada más cambia.
"""

import anthropic
import openai

from app.config import Settings
from app.providers.llm.anthropic_claude import AnthropicClaudeLLM
from app.providers.llm.base import LLMProvider
from app.providers.stt.base import STTProvider
from app.providers.stt.openai_whisper import OpenAIWhisperSTT
from app.providers.tts.base import TTSProvider
from app.providers.tts.openai_tts import OpenAITTS


def _openai_client(settings: Settings) -> openai.AsyncOpenAI:
    return openai.AsyncOpenAI(api_key=settings.openai_api_key.get_secret_value() or None)


def build_stt(settings: Settings) -> STTProvider:
    match settings.stt_provider:
        case "openai_whisper":
            return OpenAIWhisperSTT(_openai_client(settings), model=settings.stt_model)
    raise ValueError(f"Unknown STT provider: {settings.stt_provider}")


def build_llm(settings: Settings) -> LLMProvider:
    match settings.llm_provider:
        case "anthropic_claude":
            client = anthropic.AsyncAnthropic(
                api_key=settings.anthropic_api_key.get_secret_value() or None
            )
            return AnthropicClaudeLLM(
                client,
                model=settings.llm_model,
                effort=settings.llm_effort,
                max_tokens=settings.llm_max_tokens,
            )
    raise ValueError(f"Unknown LLM provider: {settings.llm_provider}")


def build_tts(settings: Settings) -> TTSProvider:
    match settings.tts_provider:
        case "openai_tts":
            return OpenAITTS(
                _openai_client(settings), model=settings.tts_model, voice=settings.tts_voice
            )
    raise ValueError(f"Unknown TTS provider: {settings.tts_provider}")
