# Nimbo 🌥️

Tutor de inglés por voz. Hablas en inglés, Nimbo (una nube) te escucha, te responde por voz y te corrige sin cortar la conversación.

> Estado: **Fase 1** (pipeline base con REST). Ver el plan completo en [CLAUDE.md](CLAUDE.md).

## Requisitos

- Python 3.12+
- Node 22.12+ (para Angular 22 se necesita Node ≥ 22.22 o 24 LTS)
- Docker Desktop (solo para Postgres, que entra en la Fase 4)
- API key de **Anthropic** (Claude, de pago) y de **Groq** (gratis, en https://console.groq.com/keys)
- OpenAI es opcional: solo si cambias a `openai_whisper` / `openai_tts` en el `.env`

## Puesta en marcha

```bash
# 1. Variables de entorno
cp .env.example .env          # y pon ANTHROPIC_API_KEY y GROQ_API_KEY

# 2. Backend
cd backend
python -m venv .venv
.venv\Scripts\activate         # Windows  (Linux/Mac: source .venv/bin/activate)
pip install -e ".[dev]"
uvicorn app.main:app --reload  # http://localhost:8000/docs
                               # la 1.ª vez descarga la voz de Piper (~60 MB) en backend/voices/

# 3. Frontend (otra terminal)
cd frontend
npm install
npm start                      # http://localhost:4200
```

Abre http://localhost:4200, elige nivel y tema, y **mantén presionado** el botón del micrófono (o la barra espaciadora) mientras hablas.

## Cómo probar cada pieza

| Qué | Comando |
|---|---|
| Tests del backend (sin APIs reales) | `cd backend && pytest` |
| Lint y formato | `cd backend && ruff check . && ruff format .` |
| Proveedores reales de punta a punta | `cd backend && python -m scripts.smoke_providers mi_audio.wav` |
| Tests del frontend | `cd frontend && npx ng test --watch=false` |
| API a mano | http://localhost:8000/docs (Swagger) |

## Arquitectura (Fase 1)

```
Angular ──POST /api/sessions──────────────▶ FastAPI ── TutorService
        ──POST /api/sessions/{id}/turns──▶            ├── STTProvider  (Whisper en Groq u OpenAI)
          (audio webm/opus, multipart)                ├── LLMProvider  (Claude + tool use)
        ◀── JSON: transcript, texto,                  └── TTSProvider  (Piper local u OpenAI TTS)
            correcciones, audio wav/mp3 base64
```

- **Proveedores intercambiables**: cada servicio externo está detrás de un `Protocol` (`app/providers/*/base.py`). El proveedor activo se elige en `.env`, y `app/providers/factory.py` es el único archivo que conoce las clases concretas.
- **Configuración gratuita por defecto**: Groq ofrece el mismo Whisper con una API compatible con la de OpenAI (por eso se reutiliza `OpenAIWhisperSTT` con otra URL), y Piper genera la voz en tu CPU (~0,4 s por frase) sin API key. Solo se pide la key de los proveedores activos.
- **Correcciones estructuradas**: Claude responde con texto (eso se habla) y además llama a la herramienta `record_corrections` con un JSON validado por un schema (eso se muestra y, en la Fase 4, se guarda en la BD).
- **Prompt del tutor**: `backend/app/tutor/prompts.py` (niveles A2–C1, modos y reglas como deletrear palabras dudosas).
- **Errores**: si falla un proveedor, el usuario ve un mensaje claro y la sesión sigue viva. Si falla solo el TTS, igual se muestra el texto de Nimbo.
