"""Prueba los 3 proveedores reales de punta a punta (gasta unos centavos).

Uso (desde backend/, con el .env lleno):
    python -m scripts.smoke_providers ruta/a/tu_audio.wav

Hace: tu audio → STT → Claude → TTS, y guarda la voz de Nimbo en nimbo_reply.mp3
"""

import asyncio
import mimetypes
import sys
from pathlib import Path

from app.config import get_settings
from app.providers.factory import build_llm, build_stt, build_tts
from app.tutor.prompts import build_system_prompt
from app.tutor.types import Level, PracticeMode


async def run(audio_bytes: bytes, mime: str) -> bytes:
    settings = get_settings()
    stt, llm, tts = build_stt(settings), build_llm(settings), build_tts(settings)

    transcription = await stt.transcribe(audio_bytes, mime)
    print(f"[STT] ({transcription.language}, {transcription.duration_s}s) {transcription.text!r}")

    conversation = llm.start_conversation(build_system_prompt(PracticeMode.FREE_TALK, Level.B1))
    reply = await conversation.send(transcription.text)
    print(f"[LLM] {reply.text}")
    for c in reply.corrections:
        print(f"      ✏️  {c.original!r} → {c.corrected!r} ({c.kind}): {c.explanation}")
    print(f"      tokens: in={reply.usage.input_tokens} out={reply.usage.output_tokens}")

    audio = await tts.synthesize(reply.text)
    return audio.data


def main(audio_path: Path) -> None:
    mime = mimetypes.guess_type(audio_path)[0] or "audio/wav"
    mp3 = asyncio.run(run(audio_path.read_bytes(), mime))
    out = Path("nimbo_reply.mp3")
    out.write_bytes(mp3)
    print(f"[TTS] {len(mp3)} bytes → {out.resolve()}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(Path(sys.argv[1]))
