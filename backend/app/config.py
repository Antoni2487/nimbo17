"""Configuración de la app, leída de variables de entorno / .env.

pydantic-settings lee cada campo desde la variable de entorno con el mismo
nombre (sin importar mayúsculas) y valida su tipo. Si algo está mal
(p. ej. LLM_EFFORT=banana) la app falla al arrancar, no a mitad de una conversación.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

# El .env vive en la raíz del repo (un nivel arriba de backend/)
_ROOT_ENV = Path(__file__).resolve().parents[2] / ".env"
# Modelos de voz locales (Kokoro, Piper) descargados: backend/voices/ (ignorada por git)
_DEFAULT_TTS_MODELS_DIR = Path(__file__).resolve().parents[1] / "voices"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ROOT_ENV, extra="ignore")

    # SecretStr evita que las keys aparezcan en logs o en repr()
    anthropic_api_key: SecretStr = SecretStr("")
    openai_api_key: SecretStr = SecretStr("")
    groq_api_key: SecretStr = SecretStr("")

    # Por defecto, la opción gratuita: Groq para escuchar y Kokoro (local) para hablar.
    stt_provider: Literal["groq_whisper", "openai_whisper"] = "groq_whisper"
    llm_provider: Literal["anthropic_claude"] = "anthropic_claude"
    tts_provider: Literal["kokoro", "piper", "openai_tts"] = "kokoro"

    stt_model: str = "whisper-1"  # solo para openai_whisper
    # large-v3 es un poco más lento que large-v3-turbo, pero entiende mejor el inglés
    # con acento, que es justo el caso de un estudiante.
    groq_stt_model: str = "whisper-large-v3"

    llm_model: str = "claude-haiku-5-5"
    llm_effort: Literal["low", "medium", "high"] = "low"
    llm_max_tokens: int = 2048

    tts_model: str = "gpt-4o-mini-tts"
    tts_voice: str = "nova"

    tts_models_dir: Path = _DEFAULT_TTS_MODELS_DIR
    kokoro_voice: str = "af_heart"
    # Voz para las partes en español. Vacío = la misma voz (una sola "persona").
    kokoro_voice_es: str = ""
    kokoro_model_file: Literal["kokoro-v1.0.int8.onnx", "kokoro-v1.0.onnx"] = (
        "kokoro-v1.0.int8.onnx"
    )
    piper_voice: str = "en_US-lessac-medium"

    # Nimbo te saluda por tu nombre (y Whisper lo transcribe mejor si lo conoce).
    user_name: str = ""

    cors_origins: list[str] = ["http://localhost:4200"]
    log_level: str = "INFO"

    database_url: str = "postgresql+asyncpg://nimbo:nimbo@localhost:5432/nimbo"


@lru_cache
def get_settings() -> Settings:
    """Singleton: la configuración se lee una vez y se reutiliza."""
    return Settings()
