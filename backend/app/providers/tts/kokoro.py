"""TTS local y gratuito con Kokoro (modelo abierto, mucho más natural que Piper).

Corre en la CPU con onnxruntime, sin API key. Los archivos del modelo se descargan
solos la primera vez en `TTS_MODELS_DIR` (por defecto backend/voices/):
  - kokoro-v1.0.int8.onnx  (~88 MB, ~280 MB de RAM)  ← por defecto
  - kokoro-v1.0.onnx       (~310 MB, ~520 MB de RAM, apenas más rápido)
  - voices-v1.0.bin        (~27 MB, todas las voces)

Voces en inglés: af_* / am_* (EE. UU., mujer / hombre), bf_* / bm_* (Reino Unido).
Voces en español: ef_dora, em_alex. Cualquier voz puede leer español; con una voz
inglesa suena con acento gringo, pero Nimbo mantiene una sola "persona".
El español se pronuncia como latino (es-419: "gracias" con s, no con la z de España).
Lista completa: https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md
"""

import asyncio
import io
import logging
import urllib.request
import wave
from pathlib import Path
from typing import Any, Protocol

import numpy as np

from app.providers.errors import ProviderError
from app.providers.tts.base import Language, SpeechAudio, SpeechSegment

log = logging.getLogger(__name__)
# phonemizer (usado por Kokoro) avisa "words count mismatch" en casi cada frase.
# Es inofensivo: solo ensucia la consola.
logging.getLogger("phonemizer").setLevel(logging.ERROR)

_RELEASE_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
VOICES_FILE = "voices-v1.0.bin"
SPANISH_LANG = "es-419"  # español latinoamericano en espeak
_PAUSE_BETWEEN_LANGUAGES_S = 0.12


class _KokoroModel(Protocol):
    """Lo único que usamos de `kokoro_onnx.Kokoro` (así los tests usan un modelo falso)."""

    def create(self, text: str, voice: str, speed: float, lang: str) -> tuple[Any, int]: ...


def _download(filename: str, models_dir: Path) -> None:
    target = models_dir / filename
    partial = target.with_suffix(target.suffix + ".part")
    log.info("Descargando %s en %s (solo la primera vez)...", filename, models_dir)
    try:
        urllib.request.urlretrieve(f"{_RELEASE_URL}/{filename}", partial)
    except Exception as e:
        partial.unlink(missing_ok=True)
        raise RuntimeError(
            f"No pude descargar {filename} de Kokoro. Revisa tu conexión a internet."
        ) from e
    # Se escribe en .part y se renombra al final: si la descarga se corta, no queda
    # un archivo a medias que el próximo arranque confunda con uno válido.
    partial.replace(target)


def load_kokoro_model(model_file: str, models_dir: Path) -> _KokoroModel:
    """Carga Kokoro desde disco, descargando primero los archivos que falten."""
    # Import aquí adentro: si usas otro TTS, no se carga onnxruntime ni espeak.
    from kokoro_onnx import Kokoro

    models_dir.mkdir(parents=True, exist_ok=True)
    for filename in (model_file, VOICES_FILE):
        if not (models_dir / filename).exists():
            _download(filename, models_dir)
    return Kokoro(str(models_dir / model_file), str(models_dir / VOICES_FILE))


def _english_for(voice: str) -> str:
    # El prefijo de la voz indica el acento: "b" = británico, "a" = americano.
    return "en-gb" if voice.startswith("b") else "en-us"


def _to_wav(samples: Any, sample_rate: int) -> bytes:
    # Kokoro devuelve float32 en [-1, 1]; WAV estándar usa enteros de 16 bits.
    pcm = (np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0) * 32767).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm.tobytes())
    return buffer.getvalue()


class KokoroTTS:
    def __init__(
        self, model: _KokoroModel, voice: str = "af_heart", spanish_voice: str | None = None
    ) -> None:
        self._model = model
        # Para cada idioma: (voz, código de pronunciación de espeak)
        self._voices: dict[Language, tuple[str, str]] = {
            "en": (voice, _english_for(voice)),
            "es": (spanish_voice or voice, SPANISH_LANG),
        }

    async def synthesize(self, segments: list[SpeechSegment], *, speed: float = 1.0) -> SpeechAudio:
        # Igual que con Piper: es trabajo de CPU síncrono, así que va en otro hilo
        # para no congelar el event loop de FastAPI.
        try:
            data = await asyncio.to_thread(self._synthesize_sync, segments, speed)
        except Exception as e:
            log.exception("Kokoro TTS failed")
            raise ProviderError("tts", "No pude generar la voz de Nimbo.", str(e)) from e
        return SpeechAudio(data=data, mime_type="audio/wav")

    def _synthesize_sync(self, segments: list[SpeechSegment], speed: float) -> bytes:
        parts: list[Any] = []
        sample_rate = 24000
        for segment in segments:
            voice, lang = self._voices[segment.lang]
            samples, sample_rate = self._model.create(
                segment.text, voice=voice, speed=speed, lang=lang
            )
            if parts:
                parts.append(np.zeros(int(sample_rate * _PAUSE_BETWEEN_LANGUAGES_S), np.float32))
            parts.append(np.asarray(samples, dtype=np.float32))
        if not parts:
            raise ValueError("No hay texto para sintetizar.")
        return _to_wav(np.concatenate(parts), sample_rate)
