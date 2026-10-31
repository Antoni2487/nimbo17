"""Dependencias de FastAPI.

`Depends(get_tutor_service)` le dice a FastAPI: "antes de llamar al endpoint,
ejecuta esta función y pásame el resultado". En los tests se reemplaza con
`app.dependency_overrides[get_tutor_service] = ...` para usar proveedores falsos.
"""

from typing import Annotated

from fastapi import Depends, Request

from app.tutor.service import TutorService


def get_tutor_service(request: Request) -> TutorService:
    # Se crea una sola vez en el lifespan de la app (ver main.py) y vive en app.state.
    return request.app.state.tutor_service


TutorServiceDep = Annotated[TutorService, Depends(get_tutor_service)]
