# Nimbo — Tutor de inglés por voz

> Nombre de trabajo. Puede cambiar.

## Contexto del proyecto

Aplicación para **practicar inglés hablado** con un tutor de IA por voz. El tutor conversa con el usuario, le hace preguntas, escucha sus respuestas en inglés y **corrige errores de gramática, vocabulario y pronunciación** de forma breve, sin cortar el flujo de la conversación. **Practica en inglés y explica en español** (saludo, correcciones, pistas).

Se usa **manos libres, mientras haces otra cosa**: sin botones que obliguen a mirar la pantalla, y funcionando con la pestaña en segundo plano.

El avatar del tutor es **una nube animada con diseño original** con **una boquita flotante que se mueve cuando habla** (sincronizada con el volumen de su voz). Es una pieza crucial de la experiencia. Tiene estados distintos cuando escucha y cuando "piensa". Inspiración: la idea de una boca flotante expresiva, pero el diseño debe ser propio (no copiar personajes existentes).

**Usuario objetivo inicial:** hispanohablante (Perú) con buena comprensión de inglés pero poca práctica oral.

**Desarrollador:** estudiante de Ciencias de la Computación, con experiencia en Django, React y PostgreSQL. Está aprendiendo **Angular** y **FastAPI** con este proyecto, así que explica brevemente las decisiones no obvias de esos dos frameworks cuando las tomes.

## Objetivos de calidad

- **Fluidez:** latencia total (fin de mi frase → inicio de la voz del tutor) idealmente ≤ 2 s.
- **Voz natural**, no robótica.
- **Correcciones útiles:** cortas, claras, con el ejemplo correcto, y que la conversación continúe.
- **UI pulida:** la nube animada es parte central de la experiencia, no un adorno.

## Restricciones

- Hardware de desarrollo: laptop Intel Core i5, **12 GB de RAM, gráfica integrada**. **No** correr LLMs ni modelos grandes de STT en local. Todo lo pesado va por APIs.
- Desarrollo **en local** primero. Deploy a la nube y app móvil son fases posteriores.
- Las **API keys nunca van en el frontend**. Solo en el backend, vía `.env`.
- El diseño de la nube debe ser **original** (no copiar personajes existentes).

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | Angular (última versión estable), standalone components, signals, TypeScript estricto |
| Animación | Web Audio API (`AnalyserNode`) + SVG o Canvas; Three.js opcional más adelante |
| Backend | Python 3.12+, **FastAPI**, asíncrono |
| Tiempo real | WebSockets (nativos de FastAPI) |
| Base de datos | PostgreSQL + SQLAlchemy 2.x (async) + Alembic |
| STT (voz → texto) | Whisper vía API: **Groq** (gratis, por defecto) u OpenAI |
| LLM (tutor) | Claude vía API de Anthropic (modelo configurable por `.env`) |
| TTS (texto → voz) | **Kokoro** local (gratis, natural, por defecto, voz `af_heart`), Piper local u OpenAI TTS. Azure (voces peruanas) o ElevenLabs como opciones futuras |
| Infra local | Docker Compose (backend + Postgres); frontend con `ng serve` |

## Arquitectura

```
Angular (UI + nube animada + captura de micrófono)
        │  WebSocket: audio del usuario ↑  /  eventos + audio del tutor ↓
        ▼
FastAPI (orquestador de la conversación)
   ├── STTProvider   → transcribe el audio del usuario
   ├── LLMProvider   → genera respuesta + correcciones (streaming)
   ├── TTSProvider   → sintetiza la voz del tutor (streaming por frases)
   └── PostgreSQL    → sesiones, mensajes, errores detectados, progreso
```

### Principio clave: proveedores intercambiables

STT, LLM y TTS se definen como **interfaces abstractas** (Protocol o ABC) con una implementación por proveedor. El proveedor activo se elige por variable de entorno. Cambiar de proveedor no debe requerir tocar el resto del código.

### Principio clave: streaming

Para lograr baja latencia:
1. El LLM responde en streaming.
2. El backend corta el texto en **frases completas** y envía cada frase al TTS en cuanto está lista.
3. El frontend reproduce los fragmentos de audio en cola, sin esperar la respuesta completa.

### Detección de fin de turno

El usuario habla con el micrófono abierto, **sin botón** (manos libres); hay que detectar cuándo terminó de hablar (VAD por silencio). Empezar con un umbral de silencio simple en el frontend, dentro de un **AudioWorklet** (los timers de una pestaña en segundo plano se congelan; el hilo de audio no). Dejar la lógica aislada para poder mejorarla después. Solo un control discreto para pausar/silenciar.

## Protocolo WebSocket (propuesta inicial)

Mensajes JSON con campo `type`. El audio puede ir en frames binarios o en base64 (decide y documenta).

**Cliente → servidor:** `session.start` (modo y nivel), `audio.chunk`, `audio.end`, `session.end`

**Servidor → cliente:**
- `state` → `listening | thinking | speaking` (controla la animación de la nube)
- `transcript.user` → lo que entendió del usuario
- `tutor.text` → texto de la respuesta (para mostrar subtítulos)
- `tutor.correction` → `{ original, corrected, explanation }`
- `tutor.audio` → fragmento de audio
- `error`

## Comportamiento del tutor (system prompt base)

- **Bilingüe:** la práctica (preguntas, reacciones, role-play) es en **inglés**; el saludo, las explicaciones de las correcciones, las pistas y el ánimo van en **español latino**, breves. El español va marcado con `<es>…</es>` para que el TTS lo pronuncie con acento latino (`es-419`).
- **Saluda al usuario por su nombre** (`USER_NAME`) y le dice qué practicarán hoy.
- **Personalidad:** cálido, curioso y con humor, como un amigo; reacciona a lo que el usuario cuenta. Algún peruanismo suave de vez en cuando (chévere, bacán, causa), sin abusar. Nada de sonar a libro de texto.
- Frases cortas y naturales, adaptadas al nivel del usuario. Hace **una pregunta a la vez** y mantiene la conversación viva.
- Si el usuario comete un error relevante: lo corrige en **una frase breve en español** ("Ojo, se dice *I went*, no *I go*, porque es pasado") y sigue conversando en inglés. No corrige cada detalle mínimo.
- **Errores de reconocimiento de voz:** no los corrige como si fueran errores del usuario (p. ej. su nombre transcrito como "Nimble"). A Whisper se le pasan "Nimbo" y el nombre del usuario como pistas.
- **Pistas por silencio:** si el usuario no responde en ~10 s, da una pista en español con un inicio de frase en inglés; si sigue callado, un ejemplo completo. Máximo 2 pistas seguidas; luego espera sin insistir.
- Si el usuario se traba o habla en español, lo ayuda con la palabra en inglés y lo anima a seguir.
- Devuelve las correcciones también en formato **estructurado** (JSON o tool use) para guardarlas en la base de datos, separado del texto que se habla.
- Modos de práctica: `free_talk`, `job_interview`, `travel`, `university_life`, `tech_talk`.

Guardar el prompt en un archivo propio (`backend/app/tutor/prompts.py` o similar), no incrustado en la lógica.

## Estructura de carpetas sugerida

```
nimbo/
├── CLAUDE.md
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py            # settings con pydantic-settings
│   │   ├── api/                 # routers REST + websocket
│   │   ├── providers/
│   │   │   ├── stt/             # base.py, openai_whisper.py
│   │   │   ├── llm/             # base.py, anthropic_claude.py
│   │   │   └── tts/             # base.py, elevenlabs.py, openai_tts.py, piper.py
│   │   ├── tutor/               # orquestación, prompts, parseo de correcciones
│   │   ├── db/                  # modelos, sesión, repositorios
│   │   └── schemas/             # modelos Pydantic de mensajes
│   ├── alembic/
│   ├── tests/
│   └── pyproject.toml
└── frontend/
    └── src/app/
        ├── core/                # servicios: websocket, audio-capture, audio-player
        ├── features/
        │   ├── practice/        # pantalla principal de conversación
        │   └── history/         # sesiones pasadas y errores frecuentes
        └── shared/
            └── cloud-avatar/    # componente de la nube animada
```

## Fases y criterios de aceptación

### Fase 1 — Pipeline base (sin tiempo real)
- Grabo audio en el navegador, lo envío, recibo la transcripción, la respuesta del tutor en texto y su audio, y se reproduce.
- Proveedores implementados detrás de sus interfaces.
- **Hecho cuando:** puedo tener una conversación de 5 turnos de punta a punta en local.

### Fase 2 — Tiempo real
- WebSocket, streaming LLM → TTS por frases, cola de reproducción en el front, detección de fin de turno.
- **Hecho cuando:** la latencia percibida es ≤ 2 s en la mayoría de turnos.

### Fase 3 — La nube
- Componente `cloud-avatar` con estados `idle | listening | thinking | speaking`, reactivo al volumen del audio (del tutor al hablar, del usuario al escuchar).
- **Hecho cuando:** la animación es fluida (60 fps) y los cambios de estado se sienten naturales.

### Fase 4 — Tutor inteligente
- Correcciones estructuradas guardadas en BD, modos de práctica, resumen al final de cada sesión (errores frecuentes y qué practicar).
- Pantalla de historial.

### Fase 5 — Pulido y deploy
- Dockerización completa, deploy del backend con HTTPS, PWA instalable.
- (Opcional) Ionic + Capacitor para app nativa; autenticación y límites de uso por usuario si se abre a más gente.

## Convenciones

- **Python:** type hints en todo, `ruff` para lint y formato, `pytest` + `pytest-asyncio` para tests. Mockear los proveedores externos en los tests.
- **Angular:** standalone components, signals para el estado, servicios para la lógica de audio y WebSocket, nada de lógica pesada en los componentes.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `refactor:`…).
- **Configuración:** todo por `.env`; mantener `.env.example` actualizado sin valores reales.
- Manejo de errores claro: si un proveedor falla, el usuario ve un mensaje entendible y la sesión no se rompe.
- Controlar costos: registrar uso de cada API por sesión (tokens, segundos de audio, caracteres de TTS).

## Cómo trabajar conmigo

- Empieza por la **Fase 1**. Antes de escribir código, propón el plan de la fase y espera mi visto bueno.
- Avanza en pasos pequeños y verificables; dime cómo probar cada paso.
- Si una decisión de arquitectura tiene alternativas importantes, preséntalas brevemente con su trade-off y recomienda una.
- Responde y comenta en **español**; el código, nombres y commits en inglés.
