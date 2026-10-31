from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from app.api.deps import TutorServiceDep
from app.schemas.session import (
    EndSessionResponse,
    StartSessionRequest,
    StartSessionResponse,
    TurnResponse,
    TutorMessageOut,
)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

MAX_AUDIO_BYTES = 10 * 1024 * 1024  # 10 MB ≈ varios minutos de opus


@router.post("", response_model=StartSessionResponse, status_code=status.HTTP_201_CREATED)
async def start_session(
    body: StartSessionRequest, service: TutorServiceDep
) -> StartSessionResponse:
    session, greeting = await service.start_session(body.mode, body.level)
    return StartSessionResponse(
        session_id=session.id,
        mode=session.mode,
        level=session.level,
        tutor=TutorMessageOut.from_domain(greeting),
    )


@router.post("/{session_id}/turns", response_model=TurnResponse)
async def send_turn(
    session_id: str,
    service: TutorServiceDep,
    audio: Annotated[
        UploadFile, File(description="Grabación del usuario (webm/opus, wav, mp3...)")
    ],
) -> TurnResponse:
    data = await audio.read()
    if not data:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "El audio llegó vacío.")
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "El audio es demasiado largo.")

    result = await service.handle_turn(session_id, data, audio.content_type or "audio/webm")
    return TurnResponse(
        transcript=result.transcript, tutor=TutorMessageOut.from_domain(result.tutor)
    )


@router.delete("/{session_id}", response_model=EndSessionResponse)
async def end_session(session_id: str, service: TutorServiceDep) -> EndSessionResponse:
    session = service.end_session(session_id)
    return EndSessionResponse(session_id=session.id, turns=session.turns)
