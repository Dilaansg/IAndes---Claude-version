# IAndes v5.0

> Extension de Chrome (Manifest V3) para optimizar prompts via servidor Python local y mostrar estimaciones de impacto ambiental (tokens, agua, CO₂).

**Procesamiento server-side.** La extensión envía el prompt a un servidor Python local (FastAPI) que procesa a través de un pipeline D1-D6 (verifier, segmenter, budget, pruner, validator, rebuilder).

---

## Características

- **Pipeline D1-D6:** Verifier → Semantic Segmenter → Budget Controller → Token Pruner → Coherence Validator → Rebuilder
- **Modo Comprimir:** Elimina cortesía, muletillas y redundancias preservando semántica
- **Modo Mejorar:** Añade estructura (rol, contexto, restricciones)
- **Impacto ambiental:** Estima agua y CO₂ por prompt (fórmulas Patterson/Li)

---

## Instalación Rápida

1. Clonar o descargar el proyecto
2. Abrir `chrome://extensions`
3. Activar **Modo desarrollador**
4. Clic en **"Cargar extensión sin empaquetar"**
5. Seleccionar la carpeta `IAndes`

La extensión envía el prompt al servidor local para optimización.

---

## Instalación del Servidor (Obligatorio)

Para funcionar, IAndes requiere el servidor Python local:

```bash
# 1. Instalar dependencias del servidor
cd iandes-server
pip install -r requirements.txt

# 2. Iniciar el servidor
python run.py
# o
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

El servidor debe estar corriendo en `http://localhost:8000` antes de usar la extensión.

---

## Uso

1. Asegurarse que el servidor está corriendo (`python run.py` en `iandes-server/`)
2. Abrir ChatGPT, Claude o Gemini
3. Escribir un prompt
4. IAndes muestra overlay con métricas locales (tokens, 💧 gotas, 🌍 CO₂)
5. Automáticamente envía al servidor para optimización
6. Panel Before/After muestra el resultado con segmentos anotados
7. Aceptar, editar o descartar

### Botones de Modo

Los botones **[⬇ Comprimir]** **[✦ Mejorar]** están en el overlay, sin necesidad de abrir el popup.

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│  EXTENSIÓN CHROME                                                │
│                                                                  │
│  Content Scripts ─────────────────────────────────────────────► │
│  (content.js)     │ Texto → Métricas locales → SW               │
│                                                                  │
│  Service Worker ──────────────────────────────────────────────► │
│  (background.js)  │ Pre-flight classification → Servidor        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  SERVIDOR LOCAL (localhost:8000)                                 │
│                                                                  │
│  D1: Intent Verifier     — Verifica/clasifica intent             │
│  D2: Semantic Segmenter  — Divide en segmentos semánticos       │
│  D3: Budget Controller   — Asigna presupuesto de compresión     │
│  D4: Token Pruner        — poda TF-IDF (aquí lived las regex)   │
│  D5: Coherence Validator — Verifica similitud, rollback si baja  │
│  D6: Rebuilder           — Reconstruye prompt optimizado         │
└─────────────────────────────────────────────────────────────────┘
```
┌─────────────────────────────────────────────────────────────┐
│  Capa 0: Clasificación (classifyPrompt)                     │
│  - Detecta perfil: short_direct, long_padded, etc.         │
│  - Determina qué capas activar                              │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Capa 1: Filtro Léxico (applyLayer1Detailed)                │
│  - Regex: saludos, cortesía, muletillas                     │
│  - SIEMPRE se aplica (baseline)                             │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Capa 2: Deduplicación Semántica                            │
│  - Transformers.js (preciso, ~22MB)                         │
│  - Jaccard fallback (heurística, siempre disponible)        │
│  - Elimina frases redundantes                               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Capa 3: Reescritura Generativa (Ollama)                    │
│  - Requiere Ollama instalado                                │
│  - Modelo: qwen3.5:2b recomendado                           │
│  - Comprime sin perder significado                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Estructura del Proyecto

```
IAndes/
├── iandes-server/         # Servidor Python (FastAPI)
│   ├── main.py            # Entry point
│   ├── run.py             # Launcher
│   ├── pipeline/          # D1-D6 modules
│   │   ├── verifier.py    # D1: Intent verification
│   │   ├── segmenter.py  # D2: Semantic segmentation
│   │   ├── budget.py     # D3: Compression budget
│   │   ├── pruner.py     # D4: Token pruning
│   │   ├── validator.py  # D5: Coherence validation
│   │   └── rebuilder.py  # D6: Prompt rebuild
│   ├── models/           # ML models (spaCy, MiniLM)
│   ├── impact/           # Environmental formulas
│   ├── schemas/          # Pydantic schemas
│   └── ui/               # Server UI
├── preflight/             # Service Worker pre-flight modules
│   ├── classifier.js     # Intent classifier
│   ├── lang-detector.js  # Language detection
│   ├── signal-extractor.js
│   └── payload-builder.js # PromptAnalysis v2.0
├── tests/
│   └── sandbox/          # Test environment
├── content-*.js          # Content script modules
├── background.js         # Service Worker (v5: HTTP router)
├── bg-server-client.js    # HTTP client to server
├── config.js             # Configuration
├── token_utils.js        # Token estimation
├── error_utils.js        # Error contract
├── types.js              # JSDoc types
├── content.js            # Main content script
├── content-pipeline.js   # v5: Send to SW, no local processing
├── content-overlay.js    # Overlay UI
├── content-panels.js     # Before/After panels
├── manifest.json         # Manifest V3
├── popup.html/js         # Extension popup
└── README.md             # This file
```

---

## Tests

```bash
# Sandbox de pruebas (requiere servidor corriendo)
cd tests/sandbox
pip install fastapi uvicorn
python test-server.py
# Abrir test-page.html en Chrome

# Server tests
cd iandes-server
pytest tests/
```

---

## Requisitos

- **Servidor:** Python 3.10+, FastAPI, uvicorn, spaCy, sentence-transformers
- **Extensión:** Chrome 88+ (Manifest V3)

---

## Changelog

Ver [CHANGELOG.md](CHANGELOG.md) para historial completo de cambios.

---

## Licencia

MIT

---

*IAndes v4.0 — 26 de Abril 2026*
