# IAndes v5 — Guia de Arquitectura Detallada

## Indice

1. [Vision General](#vision-general)
2. [Pipeline D1-D6: Detalle de Cada Modulo](#pipeline-d1-d6)
3. [Flujo de Datos](#flujo-de-datos)
4. [Modelos ML y Fallbacks](#modelos-ml-y-fallbacks)
5. [Schemas de Request/Response](#schemas)
6. [Extension Chrome: Zonas A-E](#extension-chrome)
7. [Testing](#testing)
8. [Despliegue con PyInstaller](#despliegue)

---

## Vision General

IAndes v5 es un **optimizador de prompts** que se ejecuta como servidor local (FastAPI) y se comunica con una extension de Chrome. El objetivo es reducir el numero de tokens enviados a modelos de lenguaje (ChatGPT, Claude, Gemini) eliminando texto innecesario, preservando la intencion del usuario.

### Principios de diseno

1. **Nunca modificar la intencion del usuario** — Los segmentos `intent` y `constraint` nunca se comprimen
2. **Nunca dejar el prompt vacio** — Si la optimizacion resulta en texto vacio, se usa el original
3. **Preservar entidades** — URLs, numeros, fechas, nombres propios, codigo no se eliminan
4. **Preservar verbos principales** — Los verbos de accion en espanol no se eliminan
5. **Fallback graceful** — Si spaCy o MiniLM no estan disponibles, se usan heuristicas

---

## Pipeline D1-D6

### D1 — Intent Verifier (`pipeline/verifier.py`)

**Que hace**: Verifica la clasificacion de intent que envia la extension Chrome.

**Logica**:
- Si `confidence >= 0.60`: acepta el intent del cliente sin procesar (bypass)
- Si `confidence < 0.60`: recalcula usando:
  1. Patrones lexicos (regex para code/qa/creative/general)
  2. spaCy para analisis sintactico (verbos principales)
  3. Si los patrones dan algo especifico, confia en ellos
  4. Si los patrones dan "general", usa spaCy para refinar

**Prioridad de clasificacion**: `code > creative > qa > general`

**Patrones detectados**:
- **code**: `codigo`, `function`, `debug`, `python`, `javascript`, bloques de codigo, etc.
- **qa**: `explica`, `que es`, `como funciona`, `por que`, `definicion`, etc.
- **creative**: `escribe`, `crea`, `genera`, `historia`, `poema`, `inventa`, etc.
- **general**: todo lo demas

**Salida**: `{verified_intent: str, verification_source: "client"|"server", confidence: float}`

---

### D2 — Semantic Segmenter (`pipeline/segmenter.py`)

**Que hace**: Divide el prompt en segmentos semanticamente coherentes y los etiqueta.

**Proceso**:
1. **Division**: spaCy divide el texto en oraciones (fallback a regex)
2. **Embeddings**: MiniLM genera vectores de 384 dimensiones por oracion (fallback a heuristicas)
3. **Agrupacion**: Oraciones consecutivas con similitud coseno >= 0.65 se agrupan en un segmento
4. **Etiquetado**: Cada segmento se etiqueta con prioridad: `filler > constraint > intent > context_high > context_low`

**Etiquetas**:
| Label | Significado | Compresion max |
|-------|------------|----------------|
| `intent` | Intencion principal del usuario | 0% (intocable) |
| `constraint` | Restricciones explicitas | 0% (intocable) |
| `context_high` | Contexto relevante | 20% |
| `context_low` | Contexto accesorio | 60% |
| `filler` | Saludos, cortesias, relleno | 100% (eliminable) |

**Fallback**: Si spaCy o MiniLM no estan disponibles, cada oracion es su propio segmento y se etiqueta con heuristicas.

---

### D3 — Budget Controller (`pipeline/budget.py`)

**Que hace**: Asigna presupuesto de compresion a cada segmento.

**Tabla de presupuestos** (determinista):
| Label | max_compression | Razon |
|-------|----------------|-------|
| intent | 0.0 | Intocable, core del prompt |
| constraint | 0.0 | Compresion = alterar el significado |
| context_high | 0.20 | Relevante, comprimir con cuidado |
| context_low | 0.60 | Accesorio, probablemente redundante |
| filler | 1.0 | Sin valor informativo |

**Redistribucion**: Si `max_output_tokens` esta definido y el total excede el limite, se redistribuye comprimiendo primero filler, luego context_low, luego context_high. **Nunca** se toca intent o constraint.

---

### D4 — Token Pruner (`pipeline/pruner.py`)

**Que hace**: Elimina palabras de menor peso TF-IDF segun el presupuesto de compresion.

**Estrategia por segmento**:
- `max_compression == 0.0`: Devuelve el texto sin modificar (intent, constraint)
- `max_compression == 1.0`: Devuelve texto vacio (filler eliminado)
- `0.0 < max_compression < 1.0`: TF-IDF para identificar palabras de menor peso

**Proteccion de entidades** (cuando `preserve_entities=True`):
- URLs (`https://...`)
- Numeros y decimales
- Fechas (`12/04/2026`)
- Nombres propios (`Juan Perez`)
- Siglas (`API`, `HTTP`)
- Emails
- Bloques de codigo (`` `code` `` y ` ```code``` `)
- Verbos principales en espanol (explica, necesita, puede, etc.)

**TF-IDF**: Implementacion propia (sin sklearn). Calcula TF-IDF sobre el corpus completo del prompt para identificar palabras con menor peso informativo.

---

### D5 — Coherence Validator (`pipeline/validator.py`)

**Que hace**: Verifica que el prompt optimizado preserve la intencion del original.

**Proceso**:
1. Calcula similitud coseno entre original y optimizado usando MiniLM
2. Si `similarity >= quality_floor` (default 0.85): pasa sin rollback
3. Si `similarity < quality_floor`: identifica el segmento mas problematico y lo restaura
4. Repite hasta 2 iteraciones de rollback
5. Si despues de 2 rollbacks sigue bajo el umbral: `quality_warning = true`

**Fallback**: Si MiniLM no esta disponible, usa similitud Jaccard (overlap de tokens). Mas conservador pero funcional.

**Principio clave**: Nunca deja el prompt vacio. Si el resultado optimizado esta vacio, usa el original.

---

### D6 — Rebuilder (`pipeline/rebuilder.py`)

**Que hace**: Reconstruye el prompt final y calcula metricas de ahorro.

**Proceso**:
1. Filtra segmentos con `kept=True`
2. Concatena `text_compressed` de cada segmento
3. Si el resultado esta vacio, usa el texto original
4. Calcula tokens originales vs optimizados
5. Calcula ahorro de CO2 y agua usando formulas Patterson/Li

---

## Flujo de Datos

```
Input: PromptAnalysis (JSON)
  │
  ├─ raw_prompt: "Hola, necesito que expliques la fotosintesis. No uses ejemplos."
  ├─ mode: "compress"
  ├─ preflight.intent: "qa"
  ├─ preflight.confidence: 0.80
  └─ constraints.quality_floor: 0.85
  │
  ▼
[D1] verify_intent(payload)
  │ verified_intent: "qa"
  │ verification_source: "client"
  │
  ▼
[D2] segment_prompt(text, verified_intent="qa")
  │ segments: [
  │   {text: "Hola,", label: "filler"},
  │   {text: "necesito que expliques la fotosintesis", label: "intent"},
  │   {text: "No uses ejemplos.", label: "constraint"}
  │ ]
  │
  ▼
[D3] assign_budgets(segments)
  │ segments: [
  │   {text: "Hola,", label: "filler", max_compression: 1.0},
  │   {text: "necesito que expliques la fotosintesis", label: "intent", max_compression: 0.0},
  │   {text: "No uses ejemplos.", label: "constraint", max_compression: 0.0}
  │ ]
  │
  ▼
[D4] prune_segments(segments, preserve_entities=True)
  │ segments: [
  │   {text: "Hola,", label: "filler", text_compressed: "", compression_ratio: 0.0, kept: False},
  │   {text: "necesito que expliques la fotosintesis", label: "intent", text_compressed: "...", compression_ratio: 1.0, kept: True},
  │   {text: "No uses ejemplos.", label: "constraint", text_compressed: "No uses ejemplos.", compression_ratio: 1.0, kept: True}
  │ ]
  │
  ▼
[D5] validate_coherence(original, optimized, quality_floor=0.85, segments)
  │ similarity_score: 0.95
  │ rollback_count: 0
  │ quality_warning: False
  │
  ▼
[D6] rebuild_result(original, segments, tokens, pipeline_ms, request_id)
  │
  ▼
Output: OptimizationResult (JSON)
  ├─ optimized_prompt: "Necesito que expliques la fotosintesis. No uses ejemplos."
  ├─ original_tokens: 35
  ├─ optimized_tokens: 28
  ├─ similarity_score: 0.95
  ├─ quality_warning: False
  ├─ savings: {tokens_saved: 7, co2_grams_saved: 0.0161, water_ml_saved: 3.5}
  └─ pipeline_ms: {d1: 5, d2: 120, d3: 2, d4: 15, d5: 50, d6: 1, total: 193}
```

---

## Modelos ML y Fallbacks

| Modulo | Modelo | Fallback | Impacto del fallback |
|--------|--------|-----------|----------------------|
| D1 Verifier | spaCy `es_core_news_sm` | Patrones regex | Pierde analisis sintactico, usa solo patrones |
| D2 Segmenter | spaCy + MiniLM | Regex + heuristicas | Cada oracion = segmento propio, sin agrupacion semantica |
| D5 Validator | MiniLM cosine similarity | Jaccard (overlap de tokens) | Mas conservador, puede dar `quality_warning: true` cuando MiniLM daria `false` |

**Todos los modulos funcionan sin modelos ML**. Los modelos mejoran la precision pero no son requeridos para funcionamiento basico.

---

## Schemas

### PromptAnalysis v2.0 (Request)

```python
class PromptAnalysis(BaseModel):
    version: str = "2.0"
    request_id: str          # UUID v4
    raw_prompt: str          # 1-8000 caracteres
    mode: ModeEnum            # "compress" | "enhance"
    preflight: PreflightInfo  # Intent, confidence, language, etc.
    constraints: Constraints  # max_output_tokens, preserve_entities, quality_floor
    metadata: Metadata         # source, timestamp
```

### OptimizationResult (Response)

```python
class OptimizationResult(BaseModel):
    request_id: str
    server_version: str
    optimized_prompt: str
    original_tokens: int
    optimized_tokens: int
    similarity_score: float       # 0.0 - 1.0
    quality_warning: bool         # True si no se alcanzo quality_floor
    segments: list[Segment]        # Detalle por segmento
    savings: Savings              # CO2, agua, tokens ahorrados
    pipeline_ms: PipelineMs       # Tiempos por modulo
```

---

## Extension Chrome: Zonas A-E

| Zona | Componente | Que hace |
|------|-----------|----------|
| A | Content Script | Detecta el prompt en la pagina del LLM |
| B | Service Worker | Pre-flight (clasifica intent, detecta idioma) + HTTP al servidor |
| C | (Servidor) | Pipeline D1-D6 |
| D | Service Worker | Recibe la respuesta optimizada |
| E | Content Script | Muestra panel anotado con segmentos y metricas |

**Flujo de mensajes (MV3)**:
```
Content Script → chrome.runtime.sendMessage → Service Worker
Service Worker → fetch(http://localhost:8000/optimize) → Server
Server → JSON response → Service Worker
Service Worker → chrome.tabs.sendMessage → Content Script
Content Script → Render annotated panel
```

---

## Testing

### Ejecutar todos los tests

```bash
cd iandes-server
python -m pytest tests/ -v
```

### Tests por modulo

| Modulo | Archivo | Tests | Que cubre |
|--------|---------|-------|-----------|
| D3 Budget | `test_budget.py` | 14 | Tabla de presupuestos, redistribucion, estimacion de tokens |
| D4 Pruner | `test_pruner.py` | 21 | TF-IDF, entidades protegidas, verbos, compresion parcial |
| D2 Segmenter | `test_segmenter.py` | 35 | Etiquetado, agrupacion semantica, spaCy, fallbacks |
| D5 Validator | `test_validator.py` | 22 | Jaccard, MiniLM, rollback, quality_warning |
| D1 Verifier | `test_verifier.py` | 24 | Bypass, recalculo, patrones, code blocks, confianza |
| Integracion API | `test_integration.py` | 18 | Endpoints, validacion, pipeline D1-D6, edge cases |
| **Total** | | **136** | |

---

## Despliegue

### Desarrollo

```bash
 cd iandes-server
 python run.py              # Servidor con hot-reload en localhost:8000
 python run.py --check      # Verificar dependencias y modelos
 python run.py --install     # Instalar dependencias faltantes
 python run.py --port 9000   # Puerto personalizado
 python run.py --no-reload   # Sin hot-reload (produccion)
```

### Produccion (PyInstaller)

```bash
# TODO: Fase 7
pyinstaller --onefile --windowed main.py
```

### Variables de entorno

No se requieren variables de entorno. Los modelos se cargan automaticamente.

---

## Bugs parcheados (v5.0)

| Bug | Sintoma | Fix |
|-----|---------|-----|
| Service Worker `importScripts()` + `type: module` | `Status code: 15` + `Module scripts don't support importScripts()` | Eliminado `"type": "module"` del manifest |
| `OPTIMIZE_HINT_ID` already declared | Error en consola al recargar extension | Causado por el bug anterior. Corregido con el fix del manifest |
| `getLayer1RulesCatalog is not defined` | Error en content.js | Agregado `layer1_rules.js` a content_scripts en manifest |
| `Extension context invalidated` | Error al recargar extension con ChatGPT abierto | Agregadas `isContextValid()` y `safeSendMessage()`. MutationObserver se desconecta automaticamente |
| Metricas locales con valores v4 | Fallbacks usaban 0.0035/0.0004 en vez de 0.50/0.0023 | Actualizados fallbacks en `content-metrics.js` a Patterson/Li |
| Metricas sin indicador de estimacion | Overlay mostraba valores sin aclarar que son estimados | Agregado `(est.)` y nota aclaratoria en overlay y popup |
| Token Worker CSP en ChatGPT | `Failed to construct 'Worker'` | Comportamiento esperado. Fallback a heuristica local funciona correctamente |

## Bugs conocidos (no bloqueantes)

| Bug | Impacto | Plan |
|-----|---------|------|
| Segmentador etiqueta oraciones con saludo como filler | "Hola, podrias explicarme..." se etiqueta como filler | El validador revierte correctamente. Mejorar en v5.1 separando saludo del contenido |
| Segmentador menos preciso en ingles | Prompts en ingles pueden tener etiquetas suboptimas | El validador protege contra perdida. Mejorar patrones ingleses en v5.1 |