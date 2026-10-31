"""Groq (STT) y Piper (TTS): sin red ni modelos reales."""

import io
import wave
from pathlib import Path

import pytest
from pydantic import SecretStr

from app.config import Settings
from app.providers.errors import ProviderError
from app.providers.factory import GROQ_BASE_URL, build_llm, build_stt
from app.providers.stt.openai_whisper import OpenAIWhisperSTT
from app.providers.tts.piper import PiperTTS


class FakeVoice:
    """Imita `piper.PiperVoice.synthesize_wav`: escribe 0.1 s de silencio."""

    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.calls: list[tuple[str, float]] = []

    def synthesize_wav(self, text: str, wav_file: wave.Wave_write, syn_config: object) -> None:
        if self.fail:
            raise RuntimeError("onnx exploded")
        self.calls.append((text, syn_config.length_scale))  # type: ignore[attr-defined]
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(22050)
        wav_file.writeframes(b"\x00\x00" * 2205)


async def test_piper_returns_valid_wav() -> None:
    voice = FakeVoice()
    audio = await PiperTTS(voice).synthesize("Hello there!")

    assert audio.mime_type == "audio/wav"
    with wave.open(io.BytesIO(audio.data)) as wav:
        assert wav.getframerate() == 22050
        assert wav.getnframes() == 2205
    assert voice.calls == [("Hello there!", 1.0)]


async def test_piper_slower_speed_means_longer_sounds() -> None:
    voice = FakeVoice()
    await PiperTTS(voice).synthesize("Slowly", speed=0.8)
    assert voice.calls[0][1] == pytest.approx(1.25)


async def test_piper_failure_is_a_provider_error() -> None:
    with pytest.raises(ProviderError) as exc:
        await PiperTTS(FakeVoice(fail=True)).synthesize("Hi")
    assert exc.value.provider == "tts"
    assert "voz" in exc.value.user_message


def _settings(**overrides: object) -> Settings:
    # _env_file=None: ignora tu .env real para que el test sea reproducible.
    return Settings(_env_file=None, **overrides)  # type: ignore[call-arg]


def test_groq_stt_uses_groq_url_and_key() -> None:
    stt = build_stt(_settings(stt_provider="groq_whisper", groq_api_key=SecretStr("gsk_test")))
    assert isinstance(stt, OpenAIWhisperSTT)
    assert str(stt._client.base_url).rstrip("/") == GROQ_BASE_URL
    assert stt._client.api_key == "gsk_test"
    assert stt._model == "whisper-large-v3-turbo"


def test_groq_stt_without_key_fails_with_clear_message() -> None:
    with pytest.raises(RuntimeError, match="GROQ_API_KEY"):
        build_stt(_settings(stt_provider="groq_whisper"))


def test_free_setup_does_not_need_openai_key() -> None:
    # Groq + Claude, sin OPENAI_API_KEY: no debe pedirla.
    settings = _settings(
        anthropic_api_key=SecretStr("sk-ant-test"), groq_api_key=SecretStr("gsk_test")
    )
    assert settings.openai_api_key.get_secret_value() == ""
    build_stt(settings)
    build_llm(settings)


def test_default_voices_dir_is_inside_backend() -> None:
    assert _settings().piper_voices_dir == Path(__file__).resolve().parents[1] / "voices"
