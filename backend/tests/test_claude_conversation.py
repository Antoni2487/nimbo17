"""Prueba la lógica de historial + tool use de ClaudeConversation con un cliente falso."""

from types import SimpleNamespace
from typing import Any

import pytest

from app.providers.errors import ProviderError
from app.providers.llm.anthropic_claude import ClaudeConversation


def text(t: str) -> SimpleNamespace:
    return SimpleNamespace(type="text", text=t)


def tool_use(id_: str, corrections: list[dict[str, str]]) -> SimpleNamespace:
    return SimpleNamespace(
        type="tool_use", id=id_, name="record_corrections", input={"corrections": corrections}
    )


def response(content: list[Any], stop_reason: str) -> SimpleNamespace:
    usage = SimpleNamespace(input_tokens=10, output_tokens=5)
    return SimpleNamespace(content=content, stop_reason=stop_reason, usage=usage)


class FakeMessages:
    def __init__(self, responses: list[Any]) -> None:
        self.responses = responses
        self.calls: list[list[Any]] = []

    async def create(self, **kwargs: Any) -> Any:
        self.calls.append([dict(m) for m in kwargs["messages"]])  # copia del historial
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def make_conversation(responses: list[Any]) -> tuple[ClaudeConversation, FakeMessages]:
    messages = FakeMessages(responses)
    client = SimpleNamespace(messages=messages)
    conv = ClaudeConversation(
        client,  # type: ignore[arg-type]
        model="test-model",
        effort="low",
        max_tokens=100,
        system_prompt="sys",
    )
    return conv, messages


FIX = {"original": "I go", "corrected": "I went", "explanation": "past", "kind": "grammar"}


async def test_text_plus_tool_call_defers_tool_result_to_next_turn() -> None:
    conv, messages = make_conversation(
        [
            response([text("Small fix: I went."), tool_use("t1", [FIX])], "tool_use"),
            response([text("Nice!")], "end_turn"),
        ]
    )
    reply = await conv.send("Yesterday I go")
    assert reply.text == "Small fix: I went."
    assert reply.corrections[0].corrected == "I went"

    await conv.send("I went to the park")
    last_user = messages.calls[1][-1]
    # El tool_result pendiente va primero, luego el texto nuevo del usuario.
    assert last_user["content"][0] == {
        "type": "tool_result",
        "tool_use_id": "t1",
        "content": "saved",
    }
    assert last_user["content"][1]["text"] == "I went to the park"


async def test_tool_call_without_text_triggers_second_round() -> None:
    conv, messages = make_conversation(
        [
            response([tool_use("t1", [FIX])], "tool_use"),
            response([text("Small fix: I went. And then?")], "end_turn"),
        ]
    )
    reply = await conv.send("Yesterday I go")
    assert reply.text == "Small fix: I went. And then?"
    assert len(reply.corrections) == 1
    assert reply.usage.input_tokens == 20
    assert len(messages.calls) == 2


async def test_failure_rolls_back_history() -> None:
    conv, messages = make_conversation(
        [
            response([text("Hi! How are you?")], "end_turn"),
            ProviderError("llm", "boom"),
            response([text("Great!")], "end_turn"),
        ]
    )
    await conv.send("start")
    with pytest.raises(ProviderError):
        await conv.send("I am fine")
    await conv.send("I am fine")
    # El turno fallido no quedó en el historial: user, assistant, user.
    assert [m["role"] for m in messages.calls[2]] == ["user", "assistant", "user"]


async def test_refusal_raises_provider_error() -> None:
    conv, _ = make_conversation([response([], "refusal")])
    with pytest.raises(ProviderError):
        await conv.send("hello")
