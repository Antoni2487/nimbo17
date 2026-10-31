import base64

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_tutor_service
from app.main import create_app
from app.tutor.service import TutorService
from app.tutor.session import InMemorySessionStore
from tests.fakes import FakeLLM, FakeSTT, FakeTTS


@pytest.fixture
def client() -> TestClient:
    app = create_app()
    service = TutorService(FakeSTT(), FakeLLM(), FakeTTS(), InMemorySessionStore())
    app.dependency_overrides[get_tutor_service] = lambda: service
    # Sin `with`: no corre el lifespan, así que no se crean clientes reales de OpenAI/Anthropic.
    return TestClient(app)


def test_full_flow(client: TestClient) -> None:
    res = client.post("/api/sessions", json={"mode": "travel", "level": "A2"})
    assert res.status_code == 201
    body = res.json()
    session_id = body["session_id"]
    assert base64.b64decode(body["tutor"]["audio_base64"]) == b"ID3fake-mp3"

    res = client.post(
        f"/api/sessions/{session_id}/turns",
        files={"audio": ("speech.webm", b"fake-audio", "audio/webm")},
    )
    assert res.status_code == 200
    turn = res.json()
    assert turn["transcript"] == "Yesterday I go to the university"
    assert turn["tutor"]["corrections"][0] == {
        "original": "I go",
        "corrected": "I went",
        "explanation": "Use the past tense for yesterday.",
        "kind": "grammar",
    }

    res = client.delete(f"/api/sessions/{session_id}")
    assert res.json() == {"session_id": session_id, "turns": 1}


def test_invalid_level_is_rejected(client: TestClient) -> None:
    res = client.post("/api/sessions", json={"mode": "free_talk", "level": "Z9"})
    assert res.status_code == 422


def test_unknown_session_returns_404(client: TestClient) -> None:
    res = client.post(
        "/api/sessions/does-not-exist/turns",
        files={"audio": ("speech.webm", b"fake-audio", "audio/webm")},
    )
    assert res.status_code == 404
    assert "sesión" in res.json()["detail"]


def test_empty_audio_returns_422(client: TestClient) -> None:
    session_id = client.post("/api/sessions", json={}).json()["session_id"]
    res = client.post(
        f"/api/sessions/{session_id}/turns",
        files={"audio": ("speech.webm", b"", "audio/webm")},
    )
    assert res.status_code == 422
