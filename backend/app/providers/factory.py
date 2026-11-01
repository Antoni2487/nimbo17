"""Construye los proveedores activos según la configuración (.env).

Solo se pide la key del proveedor que está activo: con Groq + Piper no hace
falta OPENAI_API_KEY.

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
from app.providers.tts.kokoro import KokoroTTS, load_kokoro_model
from app.providers.tts.openai_tts import OpenAITTS
from app.providers.tts.piper import PiperTTS, load_piper_voice

GROQ_BASE_URL = "https://api.groq.com/openai/v1"


def _require(value: str, env_name: str) -> str:
    # Falla al arrancar con un mensaje claro, en vez de un error críptico del SDK.
    if not value:
        raise RuntimeError(f"Falta {env_name} en el archivo .env (copia .env.example a .env).")
    return value


def _openai_client(settings: Settings) -> openai.AsyncOpenAI:
    key = _require(settings.openai_api_key.get_secret_value(), "OPENAI_API_KEY")
    return openai.AsyncOpenAI(api_key=key)


def _groq_client(settings: Settings) -> openai.AsyncOpenAI:
    # Groq imita la API de OpenAI: usamos el mismo SDK apuntando a otra URL.
    key = _require(settings.groq_api_key.get_secret_value(), "GROQ_API_KEY")
    return openai.AsyncOpenAI(api_key=key, base_url=GROQ_BASE_URL)


def build_stt(settings: Settings) -> STTProvider:
    match settings.stt_provider:
        case "groq_whisper":
            return OpenAIWhisperSTT(
                _groq_client(settings), model=settings.groq_stt_model, service_name="Groq"
            )
        case "openai_whisper":
            return OpenAIWhisperSTT(_openai_client(settings), model=settings.stt_model)
    raise ValueError(f"Unknown STT provider: {settings.stt_provider}")


def build_llm(settings: Settings) -> LLMProvider:
    match settings.llm_provider:
        case "anthropic_claude":
            key = _require(settings.anthropic_api_key.get_secret_value(), "ANTHROPIC_API_KEY")
            client = anthropic.AsyncAnthropic(api_key=key)
            return AnthropicClaudeLLM(
                client,
                model=settings.llm_model,
                effort=settings.llm_effort,
                max_tokens=settings.llm_max_tokens,
            )
    raise ValueError(f"Unknown LLM provider: {settings.llm_provider}")


def build_tts(settings: Settings) -> TTSProvider:
    match settings.tts_provider:
        case "kokoro":
            model = load_kokoro_model(settings.kokoro_model_file, settings.tts_models_dir)
            return KokoroTTS(
                model,
                voice=settings.kokoro_voice,
                spanish_voice=settings.kokoro_voice_es or None,
            )
        case "piper":
            return PiperTTS(load_piper_voice(settings.piper_voice, settings.tts_models_dir))
        case "openai_tts":
            return OpenAITTS(
                _openai_client(settings), model=settings.tts_model, voice=settings.tts_voice
            )
    raise ValueError(f"Unknown TTS provider: {settings.tts_provider}")
