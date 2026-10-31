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
