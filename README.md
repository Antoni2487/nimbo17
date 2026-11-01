# Nimbo 🌥️

Tutor de inglés por voz. Hablas en inglés, Nimbo te escucha, te responde por voz y te corrige sin cortar la conversación.

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
                               # la 1.ª vez descarga la voz de Kokoro (~115 MB) en backend/voices/

# 3. Frontend (otra terminal)
cd frontend
npm install
npm start                      # http://localhost:4200
```

Abre http://localhost:4200, elige nivel y tema, y **habla nomás**: es manos libres. Nimbo detecta cuándo empiezas y terminas de hablar (pausa de ~1,2 s), puedes interrumpirlo mientras habla y sigue funcionando con la pestaña en segundo plano. **Pausa** (o la barra espaciadora) deja de escucharte. Con audífonos funciona mejor: así el micrófono no capta la voz de Nimbo por los parlantes.

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
          (audio WAV 16 kHz, multipart)                ├── LLMProvider  (Claude + tool use)
        ◀── JSON: transcript, texto,                  └── TTSProvider  (Kokoro/Piper local u OpenAI TTS)
            correcciones, audio wav/mp3 base64
```

- **Proveedores intercambiables**: cada servicio externo está detrás de un `Protocol` (`app/providers/*/base.py`). El proveedor activo se elige en `.env`, y `app/providers/factory.py` es el único archivo que conoce las clases concretas.
- **Configuración gratuita por defecto**: Groq ofrece el mismo Whisper con una API compatible con la de OpenAI (por eso se reutiliza `OpenAIWhisperSTT` con otra URL), y Kokoro genera una voz natural en tu CPU (~1-2 s por frase, ~280 MB de RAM) sin API key. Piper queda como alternativa más liviana pero más robótica. Solo se pide la key de los proveedores activos.
- **Correcciones estructuradas**: Claude responde con texto (eso se habla) y además llama a la herramienta `record_corrections` con un JSON validado por un schema (eso se muestra y, en la Fase 4, se guarda en la BD).
- **Prompt del tutor**: `backend/app/tutor/prompts.py` (niveles A2–C1, modos y reglas como deletrear palabras dudosas).
- **Manos libres**: un AudioWorklet (`frontend/public/audio/mic-worklet.js`) mide el micrófono en el hilo de audio, que no se congela en segundo plano. `core/audio/vad.ts` decide cuándo empiezas y terminas de hablar (umbral sobre el ruido de fondo, más exigente mientras Nimbo habla), y la frase se envía como WAV con 500 ms previos para no cortar la primera sílaba.
- **Avatar de línea de voz**: una pantalla de vidrio flotante cuya línea es la forma de onda real de la voz de Nimbo (AnalyserNode). `shared/voice-avatar/wave.ts` calcula la línea por estado y el componente la dibuja a 60 fps escribiendo directo en el SVG.
- **Errores**: si falla un proveedor, el usuario ve un mensaje claro y la sesión sigue viva. Si falla solo el TTS, igual se muestra el texto de Nimbo.
