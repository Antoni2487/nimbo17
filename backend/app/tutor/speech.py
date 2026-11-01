"""Separa la respuesta de Nimbo en tramos por idioma.

Nimbo habla inglés y español en la misma respuesta. Claude marca el español con
<es>...</es>; lo que queda afuera es inglés. Así el TTS puede pronunciar cada
tramo con el acento correcto, y la UI muestra el texto sin las etiquetas.

    "<es>¡Hola Antoni!</es> How are you?"
    → [SpeechSegment("es", "¡Hola Antoni!"), SpeechSegment("en", "How are you?")]
"""

import re

from app.providers.tts.base import Language, SpeechSegment

# Tolerante a lo que un LLM puede escribir mal: mayúsculas, espacios o una
# etiqueta de cierre que nunca llega (el resto se toma como español).
_TAG = re.compile(r"<\s*(/?)\s*es\s*>", re.IGNORECASE)
_SPACES = re.compile(r"\s+")
_LEADING_PUNCT = re.compile(r"^[.,;:!?…]+")


def split_languages(text: str) -> list[SpeechSegment]:
    segments: list[SpeechSegment] = []
    lang: Language = "en"
    pos = 0
    for match in _TAG.finditer(text):
        _append(segments, lang, text[pos : match.start()])
        lang = "en" if match.group(1) else "es"
        pos = match.end()
    _append(segments, lang, text[pos:])
    return segments


def plain_text(text: str) -> str:
    """El texto sin etiquetas, para subtítulos y para contar caracteres de TTS."""
    return _SPACES.sub(" ", _TAG.sub("", text)).strip()


def _append(segments: list[SpeechSegment], lang: Language, chunk: str) -> None:
    chunk = _SPACES.sub(" ", chunk).strip()
    # La puntuación justo después de una etiqueta ("</es>. How...") cierra la frase
    # anterior: se pega a ese tramo para que la pausa caiga en el lugar correcto.
    if segments and (punct := _LEADING_PUNCT.match(chunk)):
        last = segments[-1]
        segments[-1] = SpeechSegment(last.lang, last.text + punct.group())
        chunk = chunk[punct.end() :].strip()
    if not any(c.isalnum() for c in chunk):
        return
    if segments and segments[-1].lang == lang:
        segments[-1] = SpeechSegment(lang, f"{segments[-1].text} {chunk}")
    else:
        segments.append(SpeechSegment(lang, chunk))
