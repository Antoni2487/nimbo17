import pytest

from app.tutor.prompts import LEVELS, MODES, build_system_prompt
from app.tutor.types import Level, PracticeMode


@pytest.mark.parametrize("level", list(Level))
@pytest.mark.parametrize("mode", list(PracticeMode))
def test_prompt_builds_for_every_level_and_mode(level: Level, mode: PracticeMode) -> None:
    prompt = build_system_prompt(mode, level)
    assert LEVELS[level].description in prompt
    assert MODES[mode] in prompt
    assert "{" not in prompt  # no quedaron placeholders sin reemplazar


def test_prompt_includes_spelling_rule() -> None:
    prompt = build_system_prompt(PracticeMode.FREE_TALK, Level.B1)
    assert "T, R, U, S, T" in prompt


def test_lower_levels_speak_slower() -> None:
    assert LEVELS[Level.A2].tts_speed < LEVELS[Level.C1].tts_speed


def test_prompt_uses_student_name_and_spanish_tags() -> None:
    prompt = build_system_prompt(PracticeMode.FREE_TALK, Level.B1, "Antoni")
    assert "The student, Antoni," in prompt
    assert "<es>" in prompt
    assert "Nimble" in prompt  # tolera que Whisper escuche mal su nombre


def test_prompt_without_name_still_reads_well() -> None:
    assert "The student is a Spanish speaker" in build_system_prompt(
        PracticeMode.FREE_TALK, Level.B1
    )
