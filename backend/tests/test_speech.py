from app.providers.tts.base import SpeechSegment as S
from app.tutor.speech import plain_text, split_languages


def test_english_only() -> None:
    assert split_languages("How are you?") == [S("en", "How are you?")]


def test_correction_mixes_languages_with_english_words_outside_tags() -> None:
    text = "<es>Ojo, se dice</es> I went, <es>no</es> I go. So, what did you do?"
    assert split_languages(text) == [
        S("es", "Ojo, se dice"),
        S("en", "I went,"),
        S("es", "no"),
        S("en", "I go. So, what did you do?"),
    ]


def test_punctuation_between_tags_sticks_to_previous_segment() -> None:
    assert split_languages("<es>¡Hola Antoni!</es>. How are you?") == [
        S("es", "¡Hola Antoni!."),
        S("en", "How are you?"),
    ]


def test_tolerates_sloppy_tags_and_missing_close() -> None:
    assert split_languages("Nice! < ES >Muy bien, causa") == [
        S("en", "Nice!"),
        S("es", "Muy bien, causa"),
    ]


def test_adjacent_segments_of_same_language_are_merged() -> None:
    assert split_languages("<es>Hola</es><es>Antoni</es>") == [S("es", "Hola Antoni")]


def test_plain_text_removes_tags_and_extra_spaces() -> None:
    assert plain_text("<es>Ojo, se dice</es>  I went.") == "Ojo, se dice I went."


def test_empty_text() -> None:
    assert split_languages("   ") == []
