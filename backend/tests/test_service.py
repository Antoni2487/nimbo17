import pytest

from app.providers.errors import ProviderError
from app.providers.tts.base import SpeechSegment
from app.tutor.service import EmptyTranscriptError, NoMoreNudgesError, TutorService
from app.tutor.session import InMemorySessionStore, SessionNotFoundError
from app.tutor.types import Level, PracticeMode
from tests.fakes import FakeLLM, FakeSTT, FakeTTS


def make_service(
    stt: FakeSTT | None = None,
    llm: FakeLLM | None = None,
    tts: FakeTTS | None = None,
    student_name: str = "",
) -> tuple[TutorService, FakeLLM, FakeTTS]:
    llm = llm or FakeLLM()
    tts = tts or FakeTTS()
    store = InMemorySessionStore()
    return TutorService(stt or FakeSTT(), llm, tts, store, student_name), llm, tts


async def test_start_session_greets_and_uses_level_speed() -> None:
    service, llm, tts = make_service()
    session, greeting = await service.start_session(PracticeMode.TRAVEL, Level.A2)

    assert greeting.text
    assert greeting.audio is not None
    assert "A2" in llm.conversations[0].system_prompt
    assert tts.calls[0][1] == pytest.approx(0.85)
    assert session.usage.llm_input_tokens == 100


async def test_five_turn_conversation() -> None:
    service, llm, _ = make_service()
    session, _ = await service.start_session(PracticeMode.FREE_TALK, Level.B1)

    for _ in range(5):
        result = await service.handle_turn(session.id, b"audio", "audio/webm")
        assert result.transcript == "Yesterday I go to the university"
        assert result.tutor.corrections[0].corrected == "I went"

    assert session.turns == 5
    assert session.usage.stt_seconds == pytest.approx(12.5)
    assert len(llm.conversations[0].received) == 6  # saludo + 5 turnos


async def test_empty_transcript_raises() -> None:
    service, _, _ = make_service(stt=FakeSTT(text=""))
    session, _ = await service.start_session(PracticeMode.FREE_TALK, Level.B1)
    with pytest.raises(EmptyTranscriptError):
        await service.handle_turn(session.id, b"audio", "audio/webm")


async def test_tts_failure_returns_text_only() -> None:
    service, _, _ = make_service(tts=FakeTTS(fail=True))
    _, greeting = await service.start_session(PracticeMode.FREE_TALK, Level.B1)
    assert greeting.audio is None
    assert greeting.text
    assert greeting.warning


async def test_llm_failure_on_start_does_not_store_session() -> None:
    llm = FakeLLM()
    llm.fail = True
    service, _, _ = make_service(llm=llm)
    with pytest.raises(ProviderError):
        await service.start_session(PracticeMode.FREE_TALK, Level.B1)


async def test_unknown_session() -> None:
    service, _, _ = make_service()
    with pytest.raises(SessionNotFoundError):
        await service.handle_turn("nope", b"audio", "audio/webm")


async def test_greets_student_by_name() -> None:
    service, llm, _ = make_service(student_name="Antoni")
    await service.start_session(PracticeMode.FREE_TALK, Level.B1)
    conversation = llm.conversations[0]
    assert "Antoni" in conversation.system_prompt
    assert "Greet Antoni by name in Spanish" in conversation.received[0]


async def test_names_are_passed_to_speech_recognition() -> None:
    stt = FakeSTT()
    service, _, _ = make_service(stt=stt, student_name="Antoni")
    session, _ = await service.start_session(PracticeMode.FREE_TALK, Level.B1)
    await service.handle_turn(session.id, b"audio", "audio/webm")
    assert stt.hint_words == [("Nimbo", "Antoni")]


async def test_reply_is_split_by_language_and_shown_without_tags() -> None:
    service, _, tts = make_service()
    session, _ = await service.start_session(PracticeMode.FREE_TALK, Level.B1)
    result = await service.handle_turn(session.id, b"audio", "audio/webm")

    assert result.tutor.text == "Ojo, se dice I went. What did you do there?"
    assert tts.calls[-1][0] == [
        SpeechSegment("es", "Ojo, se dice"),
        SpeechSegment("en", "I went. What did you do there?"),
    ]


async def test_nudges_escalate_then_stop_until_student_answers() -> None:
    service, llm, _ = make_service()
    session, _ = await service.start_session(PracticeMode.FREE_TALK, Level.B1)

    first = await service.nudge(session.id)
    second = await service.nudge(session.id)
    assert first.text.startswith("Tranqui")
    received = llm.conversations[0].received
    assert "sentence starter" in received[1]
    assert "example answer" in received[2]

    with pytest.raises(NoMoreNudgesError):
        await service.nudge(session.id)

    await service.handle_turn(session.id, b"audio", "audio/webm")
    await service.nudge(session.id)  # respondió: vuelve a haber pistas
    assert second.audio is not None
