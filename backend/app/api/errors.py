"""Traduce excepciones del dominio a respuestas HTTP con mensajes entendibles.

Así los endpoints quedan limpios (sin try/except) y el formato de error es
uniforme: siempre {"detail": "<mensaje para el usuario>"}.
"""

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

from app.providers.errors import ProviderError
from app.tutor.service import EmptyTranscriptError
from app.tutor.session import SessionNotFoundError


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ProviderError)
    async def provider_error(_: Request, exc: ProviderError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_502_BAD_GATEWAY,
            content={"detail": exc.user_message, "provider": exc.provider},
        )

    @app.exception_handler(SessionNotFoundError)
    async def session_not_found(_: Request, __: SessionNotFoundError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content={"detail": "La sesión no existe o expiró. Empieza una nueva."},
        )

    @app.exception_handler(EmptyTranscriptError)
    async def empty_transcript(_: Request, __: EmptyTranscriptError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "No te escuché bien. ¿Puedes repetirlo?"},
        )
