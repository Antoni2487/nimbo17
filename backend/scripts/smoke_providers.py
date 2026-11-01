"""Prueba los 3 proveedores reales de punta a punta (gasta unos centavos).

Uso (desde backend/, con el .env lleno):
    python -m scripts.smoke_providers ruta/a/tu_audio.wav

Hace: tu audio → STT → Claude → TTS, y guarda la voz de Nimbo en nimbo_reply.mp3/.wav
"""

import asyncio
import mimetypes
import sys
from pathlib import Path

from app.config import get_settings
from app.providers.factory import build_llm, build_stt, build_tts
from app.providers.tts.base import SpeechAudio
from app.tutor.prompts import build_system_prompt
from app.tutor.speech import split_languages
from app.tutor.types import Level, PracticeMode


async def run(audio_bytes: bytes, mime: str) -> SpeechAudio:
    settings = get_settings()
    stt, llm, tts = build_stt(settings), build_llm(settings), build_tts(settings)

    transcription = await stt.transcribe(audio_bytes, mime)
    print(f"[STT] ({transcription.language}, {transcription.duration_s}s) {transcription.text!r}")

    prompt = build_system_prompt(PracticeMode.FREE_TALK, Level.B1, settings.user_name)
    conversation = llm.start_conversation(prompt)
    reply = await conversation.send(transcription.text)
    print(f"[LLM] {reply.text}")
    for c in reply.corrections:
        print(f"      ✏️  {c.original!r} → {c.corrected!r} ({c.kind}): {c.explanation}")
    print(f"      tokens: in={reply.usage.input_tokens} out={reply.usage.output_tokens}")

    return await tts.synthesize(split_languages(reply.text))


def main(audio_path: Path) -> None:
    mime = mimetypes.guess_type(audio_path)[0] or "audio/wav"
    audio = asyncio.run(run(audio_path.read_bytes(), mime))
    ext = "wav" if audio.mime_type == "audio/wav" else "mp3"
    out = Path(f"nimbo_reply.{ext}")
    out.write_bytes(audio.data)
    print(f"[TTS] {len(audio.data)} bytes → {out.resolve()}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(Path(sys.argv[1]))
