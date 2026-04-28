# IAndes Server v5.0

Servidor local de procesamiento para IAndes — optimizador de prompts con impacto ambiental.

## Que hace IAndes?

IAndes toma un prompt (texto que le envias a ChatGPT, Claude, etc.) y lo optimiza:
- Elimina texto innecesario (saludos, relleno)
- Comprime contexto redundante
- Protege la intencion original y las restricciones
- Calcula el ahorro de CO2 y agua

**Resultado**: Prompts mas cortos, mas claros, y mas baratos — sin perder lo que importa.

---

## Arquitectura

```
Chrome Extension                    IAndes Server (localhost:8000)
┌─────────────────┐                ┌──────────────────────────────────┐
│  Content Script  │                │                                  │
│  (detecta prompt)│──HTTP POST───> │  /optimize                       │
│                  │                │    │                             │
│  Service Worker  │<──JSON──────── │    ├─ D1 Intent Verifier         │
│  (Zona B)        │                │    ├─ D2 Semantic Segmenter     │
│                  │                │    ├─ D3 Budget Controller      │
│  Annotated Panel │                │    ├─ D4 Token Pruner           │
│  (Zona E)        │                │    ├─ D5 Coherence Validator     │
│                  │                │    └─ D6 Rebuilder               │
└─────────────────┘                └──────────────────────────────────┘
```

## Pipeline D1-D6

Cada request pasa por 6 modulos secuenciales:

| Modulo | Archivo | Que hace |
|--------|---------|----------|
| **D1** Intent Verifier | `pipeline/verifier.py` | Verifica el intent del cliente. Si confidence >= 0.60, acepta. Si no, recalcula con spaCy + patrones. |
| **D2** Semantic Segmenter | `pipeline/segmenter.py` | Divide el prompt en segmentos y los etiqueta (intent, constraint, context_high, context_low, filler). Usa spaCy + MiniLM embeddings. |
| **D3** Budget Controller | `pipeline/budget.py` | Asigna presupuesto de compresion a cada segmento. Intent/constraint = 0%, filler = 100%. Redistribuye si hay limite de tokens. |
| **D4** Token Pruner | `pipeline/pruner.py` | Elimina palabras de menor peso TF-IDF segun el presupuesto. Protege entidades (URLs, numeros, nombres) y verbos principales. |
| **D5** Coherence Validator | `pipeline/validator.py` | Verifica que el prompt optimizado preserve la intencion del original usando similitud coseno (MiniLM). Si baja del umbral (0.85), hace rollback parcial. |
| **D6** Rebuilder | `pipeline/rebuilder.py` | Reconstruye el prompt final concatenando segmentos, calcula ahorro de tokens/CO2/agua. |

## Endpoints

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `GET` | `/` | Panel de control (UI) |
| `GET` | `/health` | Estado del servidor y modelos |
| `POST` | `/optimize` | Pipeline de optimizacion |

### POST /optimize

**Request** (PromptAnalysis v2.0):
```json
{
  "request_id": "uuid-v4",
  "raw_prompt": "Hola, necesito que expliques la fotosintesis...",
  "mode": "compress",
  "preflight": {
    "intent": "qa",
    "confidence": 0.80,
    "estimated_tokens": 50,
    "language": "es",
    "has_code_blocks": false,
    "paragraph_count": 1
  },
  "constraints": {
    "max_output_tokens": null,
    "preserve_entities": true,
    "quality_floor": 0.85
  }
}
```

**Response** (OptimizationResult):
```json
{
  "request_id": "uuid-v4",
  "server_version": "5.0.0",
  "optimized_prompt": "Necesito que expliques la fotosintesis...",
  "original_tokens": 50,
  "optimized_tokens": 35,
  "similarity_score": 0.95,
  "quality_warning": false,
  "segments": [
    {"text": "Hola", "label": "filler", "kept": false, "compression_ratio": 0.0},
    {"text": "necesito que expliques la fotosintesis", "label": "intent", "kept": true, "compression_ratio": 1.0}
  ],
  "savings": {
    "tokens_saved": 15,
    "co2_grams_saved": 0.0345,
    "water_ml_saved": 7.5,
    "methodology_ref": "..."
  },
  "pipeline_ms": {"d1_verifier": 5, "d2_segmenter": 120, ...}
}
```

## Instalacion

```bash
cd iandes-server
pip install -r requirements.txt
python -m spacy download es_core_news_sm
```

El modelo MiniLM se descarga automaticamente en `models/minilm/` al primer uso.

## Ejecucion

```bash
cd iandes-server

# Iniciar servidor (con hot-reload)
python run.py

# Usar puerto personalizado
python run.py --port 9000

# Sin hot-reload (produccion)
python run.py --no-reload

# Solo verificar dependencias y modelos
python run.py --check

# Instalar dependencias faltantes
python run.py --install
```

El servidor expone:
- **UI**: http://localhost:8000
- **API**: http://localhost:8000/optimize
- **Health**: http://localhost:8000/health

## Tests

```bash
cd iandes-server
python -m pytest tests/ -v
```

136 tests cubriendo todos los modulos del pipeline + integracion API.

## Estructura del Proyecto

```
iandes-server/
├── main.py                    # FastAPI entrypoint, endpoints, CORS
├── requirements.txt           # Dependencias Python
├── pipeline/
│   ├── __init__.py
│   ├── verifier.py            # D1 — Intent Verifier (spaCy + patterns)
│   ├── segmenter.py           # D2 — Semantic Segmenter (spaCy + MiniLM)
│   ├── budget.py              # D3 — Budget Controller (lookup table)
│   ├── pruner.py              # D4 — Token Pruner (TF-IDF + entity protection)
│   ├── validator.py           # D5 — Coherence Validator (MiniLM cosine sim + rollback)
│   └── rebuilder.py           # D6 — Rebuilder (concatenation + savings)
├── models/
│   ├── loader.py              # Lazy singleton para spaCy y MiniLM
│   └── minilm/                # Modelo paraphrase-multilingual-MiniLM-L12-v2 (local)
├── schemas/
│   ├── request.py             # PromptAnalysis v2.0 (Pydantic)
│   └── response.py            # OptimizationResult (Pydantic)
├── impact/
│   └── calculator.py          # Formulas Patterson (CO2) y Li (agua)
├── ui/
│   ├── index.html             # Panel de control del servidor
│   ├── app.js                 # Logica del panel
│   └── styles.css              # Estilos del panel
└── tests/
    ├── test_budget.py          # 14 tests
    ├── test_pruner.py           # 21 tests
    ├── test_segmenter.py        # 35 tests
    ├── test_validator.py       # 22 tests
    ├── test_verifier.py         # 24 tests
    ├── test_integration.py      # 18 tests (API end-to-end)
    └── test_rebuilder.py        # 2 tests (placeholder + rebuild_result)
```

## Modelos ML

| Modelo | Uso | Tamano | Carga |
|--------|-----|--------|-------|
| `es_core_news_sm` | spaCy (D1, D2) | ~15 MB | Lazy, primer request |
| `paraphrase-multilingual-MiniLM-L12-v2` | Embeddings (D2, D5) | ~470 MB | Lazy, primer request |

Ambos modelos se cargan automaticamente en el primer request. El endpoint `/health` muestra el estado de carga.

## Formulas de Impacto Ambiental

| Metrica | Formula | Referencia |
|---------|---------|------------|
| CO2 ahorrado | `tokens_saved × 0.0023g` | Patterson et al. (2021) |
| Agua ahorrada | `tokens_saved × 0.50ml` | Li et al. (2023) |

## Licencia

Proyecto privado. Todos los derechos reservados.

---

## Changelog v5.0

### Bugs parcheados

| Bug | Sintoma | Fix |
|-----|---------|-----|
| **Service Worker `importScripts()` + `type: module`** | `Status code: 15` + `Module scripts don't support importScripts()` | Eliminado `"type": "module"` del manifest. El service worker usa `importScripts()` (no ES modules). |
| **`OPTIMIZE_HINT_ID` already declared** | Error en consola al recargar la extension | Causado por el bug anterior. Al fallar el service worker, Chrome intentaba recargar y re-declarar variables globales. Corregido con el fix del manifest. |
| **`getLayer1RulesCatalog is not defined`** | Error en content.js al cargar reglas Capa 1 | `layer1_rules.js` no estaba en la lista de content_scripts del manifest. Agregado entre `token_utils.js` y `content-provider.js`. |
| **`Extension context invalidated`** | Error al recargar la extension mientras ChatGPT esta abierto | Agregadas `isContextValid()` y `safeSendMessage()` en content.js. MutationObserver se desconecta automaticamente. Intervalos se limpian si el contexto muere. |
| **Metricas locales con valores v4** | `WATER_ML_PER_TOKEN` fallback era 0.0035 (v4) en vez de 0.50 (v5) | Actualizados fallbacks en `content-metrics.js` a valores v5 (Patterson/Li). |
| **Metricas locales sin indicador de estimacion** | El overlay mostraba tokens/CO2/agua sin aclarar que son estimaciones | Agregado `(est.)` y nota "Metricas locales · valores exactos tras optimizar" en overlay y popup. |
| **Token Worker CSP en ChatGPT** | `Failed to construct 'Worker'` en consola | Comportamiento esperado. ChatGPT tiene CSP restrictivo. El codigo ya maneja esto con try/catch y fallback a heuristica local. No es un bug — las metricas locales son estimadas (±15%), las del servidor son exactas. |

### Archivos nuevos

| Archivo | Descripcion |
|---------|-------------|
| `iandes-server/run.py` | Launcher del servidor con `--check`, `--install`, `--port`, `--no-reload` |
| `iandes-server/tests/test_integration.py` | 18 tests de integracion API (endpoints, validacion, pipeline, edge cases) |

### Archivos modificados (extension)

| Archivo | Cambio |
|---------|--------|
| `manifest.json` | Eliminado `"type": "module"`, agregado `layer1_rules.js` a content_scripts |
| `content.js` | Agregadas `isContextValid()` y `safeSendMessage()`. Proteccion contra contexto invalidado en MutationObserver e intervalos. |
| `content-overlay.js` | Agregado indicador de estado del servidor. `setOverlayMode()` usa `safeSendMessage()`. Metricas muestran `(est.)`. |
| `content-panels.js` | Eliminado banner Ollama. Agregado panel de segmentos anotados, badge de similitud, metricas de ahorro (CO2/agua/tokens). |
| `content-pipeline.js` | Eliminado `ollamaDegraded`. Proteccion `isContextValid()` antes de enviar mensajes. |
| `content-metrics.js` | Fallbacks actualizados a v5 (0.50ml/token, 0.0023g/token). Metricas muestran `(est.)` y nota aclaratoria. |
| `popup.html` | Reemplazado estado Ollama/ONNX por estado del servidor. Banner de inicio del servidor. Version v5.0. Nota de metricas estimadas. |
| `popup.js` | Reescrito para v5: verifica estado del servidor via `GET_STATUS` en vez de Ollama/ONNX. |
| `config.js` | Eliminada config de Ollama/ONNX. Agregada config del servidor local. Formulas Patterson/Li. |
| `background.js` | Reescrito para v5: pipeline via HTTP al servidor local. |
| `bg-server-client.js` | Nuevo: cliente HTTP con reintentos y health check. |
| `preflight/*.js` | Eliminados TODOs (ya implementados). |
| `error_utils.js` | `ONNX_ERROR`/`OLLAMA_ERROR` → `SERVER_ERROR`. |
| `types.js` | Eliminado `ollamaDegraded`. Agregados `similarityScore`, `qualityWarning`, `segments`, `savings`. |