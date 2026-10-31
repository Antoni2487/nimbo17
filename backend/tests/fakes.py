"""Proveedores falsos: cumplen los mismos Protocols sin llamar a ninguna API."""

from collections.abc import Sequence

from app.providers.errors import ProviderError
from app.providers.llm.base import Correction, LLMUsage, TutorReply
from app.providers.stt.base import Transcription
from app.providers.tts.base import SpeechAudio


class FakeSTT:
    def __init__(self, text: str = "Yesterday I go to the university") -> None:
        self.text = text

    async def transcribe(
        self, audio: bytes, mime_type: str, hint_words: Sequence[str] = ()
    ) -> Transcription:
        return Transcription(text=self.text, language="english", duration_s=2.5)


class FakeConversation:
    def __init__(self, system_prompt: str, fail: bool = False) -> None:
        self.system_prompt = system_prompt
        self.received: list[str] = []
        self.fail = fail

    async def send(self, user_text: str) -> TutorReply:
        if self.fail:
            raise ProviderError("llm", "Nimbo tuvo un problema al pensar.")
        self.received.append(user_text)
        corrections = []
        if "I go" in user_text:
            corrections.append(
                Correction("I go", "I went", "Use the past tense for yesterday.", "grammar")
            )
        return TutorReply(
            text="Small fix: I went. What did you do there?",
            corrections=corrections,
            usage=LLMUsage(input_tokens=100, output_tokens=20),
        )


class FakeLLM:
    def __init__(self) -> None:
        self.conversations: list[FakeConversation] = []
        self.fail = False

    def start_conversation(self, system_prompt: str) -> FakeConversation:
        conv = FakeConversation(system_prompt, fail=self.fail)
        self.conversations.append(conv)
        return conv


class FakeTTS:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.calls: list[tuple[str, float]] = []

    async def synthesize(self, text: str, *, speed: float = 1.0) -> SpeechAudio:
        if self.fail:
            raise ProviderError("tts", "No pude generar la voz de Nimbo.")
        self.calls.append((text, speed))
        return SpeechAudio(data=b"ID3fake-mp3", mime_type="audio/mpeg")
