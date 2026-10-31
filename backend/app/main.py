"""Punto de entrada de FastAPI.

Correr en local:  uvicorn app.main:app --reload   (desde backend/)
Documentación interactiva: http://localhost:8000/docs
"""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health
from app.config import get_settings


def create_app() -> FastAPI:
    # "App factory": permite que los tests creen una app nueva con otras dependencias.
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)

    app = FastAPI(title="Nimbo API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    return app


app = create_app()
