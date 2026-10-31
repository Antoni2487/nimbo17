"""TTS local y gratuito con Piper (corre en la CPU, sin API key).

Piper usa modelos ONNX pequeños (~60 MB por voz). La voz se descarga sola la
primera vez que arranca el backend y queda guardada en `PIPER_VOICES_DIR`.
Catálogo de voces: https://huggingface.co/rhasspy/piper-voices
"""

import asyncio
import io
import logging
import wave
from pathlib import Path
from typing import Protocol

from app.providers.errors import ProviderError
from app.providers.tts.base import SpeechAudio

log = logging.getLogger(__name__)


class _Voice(Protocol):
    """Lo único que usamos de `piper.PiperVoice` (así los tests usan una voz falsa)."""

    def synthesize_wav(
        self, text: str, wav_file: wave.Wave_write, syn_config: object
    ) -> object: ...


def load_piper_voice(voice_name: str, voices_dir: Path) -> _Voice:
    """Carga la voz desde disco, descargándola primero si no existe."""
    # Import aquí adentro: si usas OpenAI TTS, no hace falta cargar onnxruntime.
    from piper import PiperVoice
    from piper.download_voices import download_voice

    model_path = voices_dir / f"{voice_name}.onnx"
    if not model_path.exists():
        log.info(
            "Descargando la voz de Piper %r en %s (solo la primera vez)...", voice_name, voices_dir
        )
        voices_dir.mkdir(parents=True, exist_ok=True)
        try:
            download_voice(voice_name, voices_dir)
        except Exception as e:
            raise RuntimeError(
                f"No pude descargar la voz de Piper {voice_name!r}. Revisa tu conexión o el "
                f"nombre en PIPER_VOICE (catálogo: https://huggingface.co/rhasspy/piper-voices)."
            ) from e
    return PiperVoice.load(model_path)


class PiperTTS:
    def __init__(self, voice: _Voice) -> None:
        self._voice = voice

    async def synthesize(self, text: str, *, speed: float = 1.0) -> SpeechAudio:
        # Piper es código síncrono que usa la CPU. Si lo llamáramos directo dentro de
        # un endpoint async, bloquearía el event loop de FastAPI y el servidor no
        # atendería a nadie más mientras sintetiza. `asyncio.to_thread` lo corre en
        # otro hilo y el event loop sigue libre.
        try:
            data = await asyncio.to_thread(self._synthesize_sync, text, speed)
        except Exception as e:
            log.exception("Piper TTS failed")
            raise ProviderError("tts", "No pude generar la voz de Nimbo.", str(e)) from e
        return SpeechAudio(data=data, mime_type="audio/wav")

    def _synthesize_sync(self, text: str, speed: float) -> bytes:
        from piper import SynthesisConfig

        # En Piper la velocidad se controla con `length_scale` (duración de cada sonido):
        # 1.0 = normal, > 1.0 más lento. Es el inverso de `speed`.
        config = SynthesisConfig(length_scale=1.0 / max(speed, 0.5))
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav_file:
            self._voice.synthesize_wav(text, wav_file, syn_config=config)
        return buffer.getvalue()
