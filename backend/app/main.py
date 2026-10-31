"""Punto de entrada de FastAPI.

Correr en local:  uvicorn app.main:app --reload   (desde backend/)
Documentación interactiva: http://localhost:8000/docs
"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health, sessions
from app.api.errors import register_error_handlers
from app.config import get_settings
from app.providers.factory import build_llm, build_stt, build_tts
from app.tutor.service import TutorService
from app.tutor.session import InMemorySessionStore


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # "lifespan": código que corre una vez al arrancar (antes del yield) y al apagar
    # (después). Aquí se crean los clientes HTTP de los proveedores, que se reutilizan.
    settings = get_settings()
    app.state.tutor_service = TutorService(
        stt=build_stt(settings),
        llm=build_llm(settings),
        tts=build_tts(settings),
        store=InMemorySessionStore(),
    )
    yield


def create_app() -> FastAPI:
    # "App factory": permite que los tests creen una app nueva con otras dependencias.
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)

    app = FastAPI(title="Nimbo API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_error_handlers(app)
    app.include_router(health.router)
    app.include_router(sessions.router)
    return app


app = create_app()
