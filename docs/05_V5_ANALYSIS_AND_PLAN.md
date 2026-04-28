# IAndes v5 — Análisis y Plan de Implementación

> Análisis del documento `IANDES_V5_PLAN.md` cruzado contra el código v4 existente  
> Fecha: 27 de abril de 2026  
> **Actualizado con decisiones del usuario**

---

## Progreso de Implementación

| Fase | Estado | Fecha | Notas |
|------|--------|-------|-------|
| Fase 0: Preparación | ✅ Completada | 27 abr 2026 | Rama, estructura, sandbox, .gitignore |
| Fase 1: Servidor base + contrato + UI | ✅ Completada | 27 abr 2026 | FastAPI funcional, schemas, bg-server-client.js, background.js v5, manifest.json v5, config.js v5 |
| Fase 2: D4 Pruner + D3 Budget | 🔄 En progreso | — | — |
| Fase 3: D5 Validator | ⬜ Pendiente | — | — |
| Fase 4: D2 Segmenter | ⬜ Pendiente | — | — |
| Fase 5: D1 Verifier | ⬜ Pendiente | — | — |
| Fase 6: Extensión Zona B + E | ⬜ Pendiente | — | — |
| Fase 7: Sandbox + Empaquetado + Pulido | ⬜ Pendiente | — | — |

### Archivos creados/modificados hasta ahora

**Creados (nuevos):**
- `iandes-server/main.py` — FastAPI con `/health`, `/optimize`, `/`, CORS, error handling
- `iandes-server/requirements.txt` — Dependencias Python
- `iandes-server/pipeline/__init__.py`, `verifier.py`, `segmenter.py`, `budget.py`, `pruner.py`, `validator.py`, `rebuilder.py`
- `iandes-server/models/loader.py` — Singleton para spaCy y MiniLM
- `iandes-server/impact/calculator.py` — Fórmulas Patterson/Li
- `iandes-server/schemas/request.py` — PromptAnalysis v2.0 (solo compress/enhance)
- `iandes-server/schemas/response.py` — OptimizationResult con Segment, Savings, PipelineMs
- `iandes-server/ui/index.html`, `app.js`, `styles.css` — Panel de control del servidor
- `iandes-server/tests/` — 7 archivos de test placeholder
- `preflight/classifier.js` — Intent Classifier con 4 grupos + long_context
- `preflight/lang-detector.js` — Detección es/en/unknown por trigramas
- `preflight/signal-extractor.js` — has_code_blocks, paragraph_count, estimated_tokens
- `preflight/payload-builder.js` — Construcción de PromptAnalysis v2.0 con UUID
- `bg-server-client.js` — Cliente HTTP con health check, reintentos, backoff
- `sandbox/test-harness.html`, `test-harness.js`, `test-cases.json` — Sandbox de testing (20 casos)
- `.gitignore` — Exclusiones para node_modules, Python, IDE, etc.

**Modificados (v4 → v5):**
- `background.js` — Reescrito: elimina Ollama/ONNX/Transformers, usa bg-server-client.js + preflight
- `manifest.json` — v5.0: elimina Ollama/HuggingFace/jsDelivr perms, agrega localhost:8000, elimina wasm-unsafe-eval
- `config.js` — Elimina config Ollama/ONNX/Transformers/Jaccard, agrega config servidor, fórmulas Patterson/Li

**Verificado:**
- ✅ Servidor arranca y responde a `/health` y `/optimize`
- ✅ Pipeline D1-D6 integrado (con placeholders)
- ✅ Schemas Pydantic validan correctamente
- ✅ Impact calculator funciona con fórmulas Patterson/Li
- ✅ Archivos v4 existentes no fueron alterados (solo los 3 listados arriba)

---

## 0. Decisiones del Usuario

| # | Pregunta | Decisión |
|---|----------|----------|
| 1 | ¿Modo `structure` en scope? | **No.** Fuera de scope para v5. |
| 2 | ¿Compatibilidad con v4? | **No.** Corte limpio, refactorización total. |
| 3 | ¿Servidor empaquetado? | **Sí.** Ejecutable + interfaz propia para el usuario. |
| 4 | ¿Fórmulas de impacto ambiental? | **Nuevas** (Patterson/Li). Se investigarán papers más recientes. |
| 5 | ¿Ollama se mantiene? | **No.** Se elimina completamente. Se mencionará que se probará con LLM locales posteriormente. |
| 6 | ¿Tests existentes? | **Se crean nuevos.** Se recrea el sandbox para debug sin depender de las páginas oficiales. |

**Implicaciones de estas decisiones:**

- **Corte limpio:** Se eliminan todos los archivos de v4 que ya no se necesitan. No hay fallback al pipeline viejo.
- **Servidor con UI:** El servidor no es solo una API — tiene una interfaz gráfica para que el usuario lo inicie, vea el estado, y configure opciones.
- **Ejecutable:** Se empaqueta con PyInstaller para que el usuario no necesite instalar Python manualmente.
- **Sandbox propio:** Se crea un entorno de prueba HTML local para testear la extensión sin abrir ChatGPT/Claude/Gemini.
- **Sin Ollama:** Todo el código de `bg-ollama.js`, la config de Ollama en `config.js`, y las referencias a `localhost:11434` se eliminan.
- **Sin modo `structure`:** El contrato HTTP define `mode` con valores `compress` y `enhance` solamente.

---

## 1. Resumen del Cambio Arquitectónico

| Aspecto | v4 (actual) | v5 (propuesto) |
|---------|-------------|-----------------|
| Procesamiento | 100% en el navegador | Extensión (UI) + Servidor local Python |
| Capa 1 (regex) | `layer1_rules.js` en content script | Eliminada del browser → D4 en servidor |
| Capa 2 (deduplicación) | Jaccard/Transformers.js en SW | Eliminada del browser → D2 en servidor |
| Capa 3 (Ollama) | `bg-ollama.js` en SW | **Eliminada completamente** → D4-D6 en servidor |
| Clasificación | `classifyPrompt()` en content script | Pre-flight classifier (Zona B) + D1 en servidor |
| Métricas | Locales (estimación chars/4) | Locales para UI + servidor para resultado final |
| Comunicación | Mensajes internos Chrome | HTTP POST a `localhost:8000` vía Service Worker |
| Dependencias browser | Transformers.js (~22MB), ONNX Runtime | Ninguna (solo fetch al servidor vía SW) |
| Dependencias nuevas | Ninguna | Python: FastAPI, spaCy, sentence-transformers, sklearn |
| Modos | compress, improve | compress, enhance (sin `structure`) |
| Ollama | Requerido para Capa 3 | Eliminado. Nota: se probará con LLM locales en el futuro |
| Tests | En archivos JS sueltos | Sandbox HTML propio + pytest para servidor |
| Distribución servidor | N/A | Ejecutable con UI propia (PyInstaller) |

**El cambio central:** la extensión deja de procesar el prompt. Lo empaqueta, lo envía al servidor vía Service Worker, y muestra el resultado. El servidor tiene su propia interfaz gráfica.

---

## 2. Análisis del Plan v5 — Puntos Fuertes

### 2.1 Separación de responsabilidades bien definida
Las cinco zonas (A–E) tienen responsabilidades claras y no se invaden mutuamente. Esto es una mejora significativa sobre v4 donde `content-pipeline.js` mezcla clasificación, procesamiento, y orquestación.

### 2.2 Contrato HTTP versionado
El `PromptAnalysis v2.0` y `OptimizationResult` con campo `version` y `request_id` es una buena práctica. Permite evolución sin romper compatibilidad y correlación de requests para debugging.

### 2.3 Coherence Validator con rollback (D5)
El mecanismo de rollback parcial con máximo 2 iteraciones es pragmático. Evita sobre-compresión sin crear bucles infinitos. El `quality_floor` configurable (default 0.85) es un buen balance.

### 2.4 Latencia presupuestada
Cada módulo D tiene una latencia esperada documentada. El total (~180ms) está bien por debajo del límite de 2000ms. Esto permite medir regresiones.

### 2.5 Fases ordenadas con criterios de éxito
Las 7 fases tienen criterios de éxito claros y verificables. Cada fase produce un sistema funcional.

### 2.6 Degradación elegante
El plan contempla que la extensión funcione en modo degradado si el servidor no está disponible (métricas locales sin botón "Enhance").

---

## 3. Análisis del Plan v5 — Problemas y Brechas

### 3.1 🔴 CRÍTICO: Content scripts no pueden hacer HTTP requests directos

**Problema:** El plan dice "la extensión hace `POST http://localhost:8000/optimize`" pero en Manifest V3, los content scripts **no pueden hacer fetch a URLs arbitrarias**. Solo el Service Worker tiene permisos de `host_permissions`.

**Solución:** Toda comunicación HTTP debe ir a través del Service Worker:

```
Content Script → chrome.runtime.sendMessage({type: "OPTIMIZE_PROMPT", ...})
  → Service Worker (bg-server-client.js) construye payload (Zona B)
  → Service Worker → fetch("http://localhost:8000/optimize", {method: "POST", body: ...})
  → Service Worker recibe OptimizationResult
  → Service Worker → chrome.tabs.sendMessage({type: "OPTIMIZED_PROMPT", result: ...})
  → Content Script muestra panel Before/After
```

**Impacto:** La Zona B (pre-flight classifier) se ejecuta en el Service Worker, no en el content script. El payload se construye en el SW.

**Archivos afectados:** `background.js` (reescritura completa), `content.js` (adaptar listeners), nuevo `bg-server-client.js`.

### 3.2 🔴 CRÍTICO: El plan no detalla qué archivos se eliminan vs. modifican

Ver sección 5 para el mapa completo de archivos.

### 3.3 🟡 MEDIO: Duplicación de lógica entre Zona B y D1

**Problema:** El pre-flight classifier (Zona B, JS) y el Intent Verifier (D1, Python) hacen clasificación de intent. Si el cliente clasifica con confianza ≥ 0.60, D1 acepta sin verificar. Dos clasificadores deben mantenerse en sincronía.

**Mitigación:**
1. Documentar explícitamente que ambos clasificadores cubren los mismos 4 intents (`code`, `qa`, `creative`, `general`). Nota: `long_context` es una condición de tokens, no un intent per se.
2. Crear un test suite compartido (mismos casos de prueba en JS y Python).
3. Considerar que D1 siempre verifique si la latencia de spaCy (~15ms) es aceptable.

### 3.4 🟡 MEDIO: El plan no detalla cambios en `manifest.json`

Ver sección 5.3 para los cambios exactos.

### 3.5 🟡 MEDIO: Tests existentes quedan obsoletos

Todos los tests de v4 (`test_layer1.js`, `test_classify.js`, `test_dedup.js`, `test_pipeline.js`) quedan obsoletos. Se crean nuevos tests:
- **Extensión:** Sandbox HTML propio para probar sin abrir sitios de LLM
- **Servidor:** pytest para cada módulo D1-D6
- **Integración:** Tests end-to-end en el sandbox

### 3.6 🟡 MEDIO: El plan no detalla el flujo de mensajes en la extensión

Ver sección 6 para el flujo detallado.

### 3.7 🟡 MEDIO: El plan no detalla el popup

El popup actual muestra estado de Ollama/ONNX. Necesita reescribirse para mostrar:
- Estado del servidor local (disponible/no disponible, latencia)
- Versión del servidor
- Toggle ON/OFF
- Modo Comprimir/Mejorar
- Botón o instrucciones para iniciar el servidor

### 3.8 🟡 MEDIO: El plan no detalla la UI del servidor

**Decisión del usuario:** El servidor tendrá su propia interfaz gráfica. Esto no está en el plan original y necesita diseño.

**Componentes de la UI del servidor:**
- Ventana principal con estado del servidor (running/stopped)
- Indicador de modelos cargados (spaCy, MiniLM)
- Botón Start/Stop
- Log de requests en tiempo real
- Configuración básica (puerto, calidad_floor)
- System tray icon para minimizar a bandeja

### 3.9 🟢 MENOR: Fórmulas de impacto ambiental inconsistentes

**Decisión del usuario:** Se usan las fórmulas nuevas (Patterson/Li) y se investigarán papers más recientes.

| Métrica | v4 | v5 (nuevo) |
|---------|-----|------------|
| CO₂ por token | 0.0004 g | 0.0023 g (Patterson et al. 2021) |
| Agua por token | 0.0035 ml | 0.50 ml (Li et al. 2023) |

**Acción:** Actualizar `content-metrics.js` y `config.js` con las nuevas fórmulas. Documentar las fuentes académicas. Marcar como pendiente de actualización con papers más recientes.

---

## 4. Arquitectura v5 Actualizada

### 4.1 Diagrama de flujo completo

```
┌─────────────────────────────────────────────────────────────────────┐
│  MUNDO BROWSER — Extensión Chrome MV3                               │
│                                                                     │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐   │
│  │  Zona A              │    │  Zona B (en Service Worker)      │   │
│  │  Extension Core      │───>│  Pre-flight Classifier          │   │
│  │                      │    │                                  │   │
│  │  · DOM Observer      │    │  · Intent Classifier (~30 reglas)│   │
│  │  · Token Estimator   │    │  · Lang Detector (trigrams)    │   │
│  │  · Metrics UI        │    │  · Signal Extractor             │   │
│  │    (Shadow DOM)      │    │  · Payload Builder              │   │
│  │                      │    │                                  │   │
│  └──────────────────────┘    └──────────────┬───────────────────┘   │
│                                             │                      │
│  ┌──────────────────────┐                   │                      │
│  │  bg-server-client.js │◄──────────────────┘                      │
│  │  · checkServerHealth │                                         │
│  │  · sendToServer()     │                                         │
│  │  · timeout 2000ms     │                                         │
│  └──────────┬───────────┘                                         │
└─────────────┼───────────────────────────────────────────────────────┘
              │ HTTP POST localhost:8000
              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Zona C — Contrato HTTP · JSON · localhost:8000                     │
│                                                                     │
│  PromptAnalysis v2.0 ──────────────────────────────────────────▶  │
│  ◀──────────────────────────────────────────────── OptimizationResult│
└─────────────┬───────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  MUNDO SERVIDOR — FastAPI · Python · localhost:8000                  │
│  + Interfaz gráfica propia (PyInstaller executable)                 │
│                                                                     │
│  Zona D — Pipeline de procesamiento                                 │
│                                                                     │
│  D1 Intent Verifier ──▶ D2 Segmenter ──▶ D3 Budget                 │
│  (spaCy, ~15ms)         (MiniLM, ~90ms)   Controller               │
│                                │          (<1ms)                    │
│                                ▼             │                      │
│                         D4 Token Pruner ◀───┘                      │
│                         (TF-IDF, ~10ms)                            │
│                                │                                    │
│                                ▼                                    │
│                     D5 Coherence Validator ──[rollback]──▶ D4      │
│                     (cosine similarity, ~50ms)                     │
│                                │ score ≥ quality_floor              │
│                                ▼                                    │
│                         D6 Rebuilder                               │
│                         (<2ms)                                     │
└─────────────┬───────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Zona E — Preview UI · extensión                                    │
│                                                                     │
│  · Before / After anotado por segmentos                             │
│  · Score de similitud + impacto ambiental                          │
│  · Aceptar → reinyección del prompt en el DOM del LLM              │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 Flujo de mensajes en la extensión (detalle)

```
1. Usuario deja de tipear (1.5s debounce)
2. Content Script calcula métricas locales (Zona A)
3. Content Script muestra overlay con métricas
4. Usuario hace clic en [⬇ Comprimir] o [✦ Mejorar]
5. Content Script → chrome.runtime.sendMessage({
     type: "OPTIMIZE_PROMPT",
     text: "...",
     mode: "compress" | "enhance",
     provider: "chatgpt" | "claude" | "gemini"
   })
6. Service Worker recibe el mensaje
7. Service Worker ejecuta Zona B:
   a. classifier.classifyIntent(text) → {intent, confidence}
   b. langDetector.detect(text) → "es" | "en" | "unknown"
   c. signalExtractor.extract(text) → {has_code_blocks, paragraph_count, estimated_tokens}
   d. payloadBuilder.build({text, mode, intent, confidence, language, signals, provider})
8. Service Worker → fetch("http://localhost:8000/optimize", {method: "POST", body: payload})
   - Timeout: 2000ms
   - Si falla: enviar mensaje de error al content script
9. Service Worker recibe OptimizationResult
10. Service Worker → chrome.tabs.sendMessage(tabId, {
      type: "OPTIMIZED_PROMPT",
      result: OptimizationResult
    })
11. Content Script recibe OptimizationResult
12. Content Script renderiza panel Before/After anotado (Zona E)
13. Usuario acepta → reinyección en el DOM
```

### 4.3 Modos soportados

| Modo | Descripción | Comportamiento en servidor |
|------|-------------|---------------------------|
| `compress` | Reducir tokens eliminando relleno | D4 elimina filler, comprime context_low |
| `enhance` | Añadir estructura (rol, contexto, restricciones) | D4 no elimina, D6 añade componentes faltantes |

**Nota:** El modo `structure` queda fuera de scope para v5. Se puede agregar en v5.1.

---

## 5. Mapa de Archivos

### 5.1 Archivos eliminados (10 archivos)

| Archivo | Razón |
|---------|-------|
| `bg-ollama.js` | Ollama eliminado completamente |
| `bg-layer2.js` | Jaccard/Transformers.js reemplazado por D2 en servidor |
| `bg-pipeline.js` | Orquestación de capas reemplazada por servidor |
| `layer1_rules.js` | Regex reemplazado por D4 en servidor |
| `lib/transformers.min.js` | Ya no se necesita en el browser |
| `lib/ort.min.js` | Ya no se necesita en el browser |
| `token_worker.js` | Conteo exacto se hace en el servidor |
| `scripts/build-transformers.js` | Ya no se necesita |
| `test_layer1.js` | Lógica movida al servidor |
| `test_classify.js` | Lógica movida al servidor |
| `test_dedup.js` | Lógica movida al servidor |
| `test_pipeline.js` | Lógica movida al servidor |

### 5.2 Archivos modificados significativamente (9 archivos)

| Archivo | Cambio |
|---------|--------|
| `background.js` | De orquestador de capas → router HTTP al servidor + Zona B |
| `content.js` | Eliminar lógica de optimización, adaptar listeners para nuevo formato |
| `content-pipeline.js` | Reemplazar classifyPrompt/processPrompt por construcción de payload simple |
| `content-overlay.js` | Agregar modo Enhance, indicador de estado del servidor, timeout visual |
| `content-panels.js` | Reescribir para panel Before/After anotado por segmentos |
| `content-state.js` | Adaptar estado para nuevo flujo (server status, request_id) |
| `content-metrics.js` | Unificar fórmulas con servidor (Patterson/Li) |
| `config.js` | Agregar URL del servidor, eliminar config de Ollama/ONNX/Transformers |
| `manifest.json` | Permisos, content_scripts, CSP, web_accessible_resources |

### 5.3 Cambios en `manifest.json`

```json
{
  "host_permissions": [
    "*://chat.openai.com/*",
    "*://chatgpt.com/*",
    "*://claude.ai/*",
    "*://gemini.google.com/*",
    "http://localhost:8000/*"          // NUEVO: servidor local
    // ELIMINADOS: "http://localhost:11434/*", "http://127.0.0.1:11434/*",
    //            "https://huggingface.co/*", "https://cdn.jsdelivr.net/*"
  ],
  "content_scripts": [{
    "js": [
      "error_utils.js",
      "config.js",
      "token_utils.js",
      // ELIMINADOS: "layer1_rules.js", "types.js"
      // NUEVOS:
      "preflight/classifier.js",
      "preflight/lang-detector.js",
      "preflight/signal-extractor.js",
      "preflight/payload-builder.js",
      "content-provider.js",
      "content-state.js",
      "content-metrics.js",
      "content-pipeline.js",
      "content-overlay.js",
      "content-panels.js",
      "content.js"
    ]
  }],
  "web_accessible_resources": [{
    "resources": [
      // ELIMINADOS: "lib/ort.min.js", "lib/transformers.min.js",
      //            "token_worker.js", "bg-ollama.js", "bg-pipeline.js", "bg-layer2.js"
      // NUEVOS: ninguno (el SW hace fetch al servidor)
    ]
  }],
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
    // ELIMINADO: 'wasm-unsafe-eval' — ya no se necesita
  }
}
```

### 5.4 Archivos modificados moderadamente (4 archivos)

| Archivo | Cambio |
|---------|--------|
| `popup.js` | Reemplazar indicadores Ollama/ONNX por estado del servidor |
| `popup.html` | UI de estado del servidor, botón iniciar, latencia |
| `types.js` | Actualizar tipos JSDoc para PromptAnalysis v2.0 y OptimizationResult |
| `error_utils.js` | Agregar códigos de error del servidor (TIMEOUT, SERVER_UNAVAILABLE, etc.) |

### 5.5 Archivos nuevos en la extensión (5 archivos)

| Archivo | Descripción |
|---------|-------------|
| `preflight/classifier.js` | Intent Classifier determinista (4 intents + long_context) |
| `preflight/lang-detector.js` | Detección de idioma por trigramas (es/en/unknown) |
| `preflight/signal-extractor.js` | Extracción de señales estructurales |
| `preflight/payload-builder.js` | Construcción de PromptAnalysis v2.0 |
| `bg-server-client.js` | Cliente HTTP para servidor local (health check, optimize, timeout) |

### 5.6 Archivos nuevos en el servidor (16+ archivos)

| Archivo | Descripción |
|---------|-------------|
| `iandes-server/main.py` | FastAPI entrypoint + UI |
| `iandes-server/requirements.txt` | Dependencias Python |
| `iandes-server/pipeline/__init__.py` | Package |
| `iandes-server/pipeline/verifier.py` | D1: Intent Verifier |
| `iandes-server/pipeline/segmenter.py` | D2: Semantic Segmenter |
| `iandes-server/pipeline/budget.py` | D3: Budget Controller |
| `iandes-server/pipeline/pruner.py` | D4: Token Pruner |
| `iandes-server/pipeline/validator.py` | D5: Coherence Validator |
| `iandes-server/pipeline/rebuilder.py` | D6: Rebuilder |
| `iandes-server/models/loader.py` | Singleton para modelos ML |
| `iandes-server/impact/calculator.py` | Fórmulas CO₂ y agua |
| `iandes-server/schemas/request.py` | Pydantic: PromptAnalysis |
| `iandes-server/schemas/response.py` | Pydantic: OptimizationResult |
| `iandes-server/ui/` | Interfaz gráfica del servidor (HTML/JS o PyQt) |
| `iandes-server/build.py` | Script de empaquetado con PyInstaller |
| `iandes-server/tests/` | pytest para cada módulo D1-D6 |

### 5.7 Archivos nuevos para sandbox (2+ archivos)

| Archivo | Descripción |
|---------|-------------|
| `sandbox/test-harness.html` | Página HTML local para probar la extensión sin sitios de LLM |
| `sandbox/test-harness.js` | Lógica del sandbox: simular textarea, capturar resultados |
| `sandbox/test-cases.json` | Casos de prueba predefinidos para el sandbox |

---

## 6. Plan de Implementación Detallado

### Fase 0 — Preparación (1 día)

**Objetivo:** Crear la estructura del proyecto sin romper v4.

#### 0.1 Crear rama de desarrollo
```bash
git checkout -b v5-architecture
```

#### 0.2 Crear estructura del servidor Python
```
iandes-server/
├── main.py
├── requirements.txt
├── pipeline/
│   ├── __init__.py
│   ├── verifier.py
│   ├── segmenter.py
│   ├── budget.py
│   ├── pruner.py
│   ├── validator.py
│   └── rebuilder.py
├── models/
│   └── loader.py
├── impact/
│   └── calculator.py
├── schemas/
│   ├── request.py
│   └── response.py
├── ui/
│   ├── index.html
│   ├── app.js
│   └── styles.css
└── tests/
    ├── __init__.py
    ├── test_verifier.py
    ├── test_segmenter.py
    ├── test_budget.py
    ├── test_pruner.py
    ├── test_validator.py
    ├── test_rebuilder.py
    └── test_integration.py
```

#### 0.3 Crear directorio preflight en la extensión
```
preflight/
├── classifier.js
├── lang-detector.js
├── signal-extractor.js
└── payload-builder.js
```

#### 0.4 Crear sandbox de testing
```
sandbox/
├── test-harness.html
├── test-harness.js
└── test-cases.json
```

#### 0.5 Actualizar `.gitignore`
Agregar:
```
iandes-server/__pycache__/
iandes-server/*.egg-info/
iandes-server/.venv/
iandes-server/dist/
iandes-server/build/
*.pyc
```

**Criterio de éxito:** Estructura creada, v4 sigue funcionando sin cambios.

---

### Fase 1 — Servidor base + contrato + UI mínima (3-4 días)

**Objetivo:** Servidor FastAPI con endpoints funcionales, contrato definido, y UI mínima. Extensión puede enviar un payload y recibir un JSON válido.

#### 1.1 Implementar `schemas/request.py` (Pydantic)
- `PromptAnalysis` con todos los campos del contrato v2.0
- `mode` solo acepta `compress` y `enhance` (sin `structure`)
- Validación: `raw_prompt` max 8000 chars, `preflight.confidence` entre 0 y 1

#### 1.2 Implementar `schemas/response.py` (Pydantic)
- `Segment` con `text`, `label`, `kept`, `compression_ratio`
- `OptimizationResult` con todos los campos del contrato
- `pipeline_ms` como diccionario con claves `d1_verifier` a `d6_rebuilder`

#### 1.3 Implementar `main.py`
- FastAPI app con CORS para `chrome-extension://*` y `http://localhost:*`
- `GET /health` → `{"status": "ready", "models_loaded": true/false, "version": "5.0.0"}`
- `POST /optimize` → por ahora devuelve el prompt original con tokens calculados y segments vacíos
- Middleware de timing para `pipeline_ms`

#### 1.4 Implementar `impact/calculator.py`
- Fórmulas: `co2_grams_saved = tokens_saved × 0.0023`, `water_ml_saved = tokens_saved × 0.50`
- `methodology_ref` con las citas académicas
- **Nota:** Se investigarán papers más recientes para actualizar estos valores

#### 1.5 Implementar `models/loader.py`
- Singleton para carga lazy de modelos
- `get_spacy_model()` → carga `es_core_news_sm`
- `get_sentence_model()` → carga `paraphrase-multilingual-MiniLM-L12-v2`
- Warmup en startup

#### 1.6 Implementar UI mínima del servidor
- Ventana con estado del servidor (running/stopped)
- Indicador de modelos cargados (spaCy ✓/✗, MiniLM ✓/✗)
- Botón Start/Stop
- Log de requests en tiempo real (últimas 10 requests)
- Puerto configurable (default 8000)
- **Opciones de implementación:**
  - **Opción A:** HTML/JS servido por FastAPI en `/` — más simple, sin dependencias extra
  - **Opción B:** PyQt/PySide — más nativo, requiere dependencias extra
  - **Recomendación:** Opción A para v5.0 (simplicidad), migrar a Opción B en v5.1 si se quiere system tray

#### 1.7 Extensión: crear `bg-server-client.js`
- `checkServerHealth()` → `GET http://localhost:8000/health`
- `sendToServer(payload)` → `POST http://localhost:8000/optimize`
- Timeout de 2000ms
- Reintentos con backoff exponencial (máximo 3)
- Polling cada 5 segundos para detectar cuando el servidor está disponible
- Códigos de error: `SERVER_UNAVAILABLE`, `TIMEOUT`, `PAYLOAD_TOO_LARGE`, `SERVER_ERROR`

#### 1.8 Extensión: modificar `background.js`
- Eliminar `importScripts` de `bg-ollama.js`, `bg-layer2.js`, `bg-pipeline.js`
- Agregar `importScripts` de `bg-server-client.js` y módulos `preflight/`
- Reemplazar lógica de `handleOptimization` por:
  1. Ejecutar Zona B (classifier, lang-detector, signal-extractor, payload-builder)
  2. Enviar payload al servidor vía `bg-server-client.js`
  3. Recibir `OptimizationResult`
  4. Enviar al content script
- Manejar errores del servidor (413, 500, timeout)

#### 1.9 Extensión: modificar `manifest.json`
- Agregar `"http://localhost:8000/*"` a `host_permissions`
- Eliminar permisos de Ollama, HuggingFace, jsDelivr
- Eliminar archivos muertos de `content_scripts` y `web_accessible_resources`
- Eliminar `'wasm-unsafe-eval'` de CSP

**Criterio de éxito:** `curl -X POST http://localhost:8000/optimize` devuelve un JSON válido. La extensión envía un payload y recibe la respuesta. La UI del servidor muestra el estado.

---

### Fase 2 — D4 Pruner + D3 Budget (2-3 días)

**Objetivo:** El servidor comprime prompts simples eliminando filler y reduciendo context_low.

#### 2.1 Implementar `pipeline/budget.py`
- Tabla de presupuestos determinista (lookup table)
- `intent` → 0%, `constraint` → 0%, `context_high` → 20%, `context_low` → 60%, `filler` → 100%
- Lógica de redistribución cuando `max_output_tokens` está definido
- Tests unitarios

#### 2.2 Implementar `pipeline/pruner.py`
- TF-IDF con sklearn (TfidfVectorizer)
- Detección de entidades con spaCy (nombres, números, fechas, URLs)
- Protección de verbo principal de cada oración
- Eliminación de palabras de menor peso TF-IDF hasta alcanzar compresión target
- Tests unitarios con al menos 10 casos

#### 2.3 Integrar en `/optimize`
- Placeholder para segmenter: usar segmentación por oraciones (spaCy `nlp(text).sents`)
- Placeholder para verifier: aceptar siempre el intent del cliente
- Pipeline: placeholder_segmenter → budget → pruner → placeholder_validator → rebuilder

**Criterio de éxito:** El servidor comprime prompts con cortesías obvias. La UI muestra tokens ahorrados.

---

### Fase 3 — D5 Coherence Validator (1-2 días)

**Objetivo:** Seguro contra sobre-compresión.

#### 3.1 Implementar `pipeline/validator.py`
- Cálculo de similitud coseno entre embeddings del prompt original y optimizado
- Rollback parcial: identificar el segmento más problemático, restaurarlo, recalcular
- Límite duro de 2 iteraciones de rollback
- `quality_warning: true` si no se alcanza `quality_floor` tras 2 rollbacks

#### 3.2 Tests de validator
- Caso donde la compresión es buena (score ≥ 0.85) → pasa sin rollback
- Caso donde la compresión es agresiva (score < 0.85) → rollback parcial
- Caso donde 2 rollbacks no son suficientes → `quality_warning: true`

**Criterio de éxito:** Prompts donde el Pruner elimina demasiado activan rollback automáticamente.

---

### Fase 4 — D2 Semantic Segmenter (3-4 días)

**Objetivo:** El módulo más difícil. Segmentar y etiquetar correctamente.

#### 4.1 Implementar `pipeline/segmenter.py`
- Dividir en oraciones con spaCy
- Generar embeddings con `paraphrase-multilingual-MiniLM-L12-v2`
- Agrupar oraciones por similitud coseno consecutiva (umbral 0.65)
- Etiquetar segmentos: `intent`, `constraint`, `context_high`, `context_low`, `filler`
- Heurísticas de etiquetado (verbos de acción → intent, "no"/"solo" → constraint, etc.)

#### 4.2 Tests del segmenter (mínimo 15 casos)
- Prompt con código → segmentos de código etiquetados correctamente
- Pregunta directa corta → un solo segmento `intent`
- Prompt largo con múltiple contexto → segmentación correcta
- Prompt con solo cortesías → todo `filler`
- Prompt en inglés → funciona igual
- Prompt mixto es/en → etiquetado correcto
- Prompt con restricciones explícitas → `constraint` identificado
- Prompt con contexto accesorio → `context_low` identificado

#### 4.3 Calibración del umbral
- Ajustar el umbral de corte de segmento (inicialmente 0.65)
- Probar con prompts reales

**Criterio de éxito:** El segmenter identifica correctamente `intent`, `constraint` y `filler` en los 15 casos de test.

---

### Fase 5 — D1 Intent Verifier (1 día)

**Objetivo:** Verificar la clasificación del cliente cuando la confianza es baja.

#### 5.1 Implementar `pipeline/verifier.py`
- Si `confidence >= 0.60`: aceptar sin procesar
- Si `confidence < 0.60`: usar spaCy para recalcular intent
- Análisis de entidades, dependencias sintácticas y vocabulario

#### 5.2 Tests del verifier
- Caso con confianza alta → bypass
- Caso con confianza baja → recálculo con spaCy
- Caso ambiguo → recálculo produce resultado diferente

**Criterio de éxito:** Prompts con `confidence >= 0.60` no tocan spaCy. Prompts ambiguos sí.

---

### Fase 6 — Extensión: Zona B (Pre-flight) + Zona E (UI) (3-4 días)

**Objetivo:** La extensión clasifica, envía, y muestra el resultado anotado.

#### 6.1 Implementar `preflight/classifier.js`
- Árbol de decisiones determinista (4 intents + condición de longitud)
- Grupos: `code`, `qa`, `creative`, `general`
- Condición: `long_context` (tokens > 800) → confianza 0.90
- Umbral: ≥ 2 señales del mismo grupo → intent con confianza 0.75+
- 1 señal → intent con confianza 0.60
- Ningún grupo → `general` con confianza 0.50

#### 6.2 Implementar `preflight/lang-detector.js`
- Detección por trigramas de caracteres (es/en/unknown)
- Tabla de trigramas más comunes en memoria
- Sin librerías externas

#### 6.3 Implementar `preflight/signal-extractor.js`
- `has_code_blocks`: detección de backticks y bloques de código
- `paragraph_count`: contar `\n\n`
- `estimated_tokens`: usar `estimateTokens()` existente

#### 6.4 Implementar `preflight/payload-builder.js`
- Construir `PromptAnalysis v2.0` completo
- Generar UUID v4 para `request_id`
- Timestamp, source (provider), constraints

#### 6.5 Modificar `content-pipeline.js`
- Reemplazar `classifyPrompt()` por llamada al pre-flight classifier
- Reemplazar `processPrompt()` por construcción de payload + envío al SW
- Reemplazar `requestOptimization()` por envío del payload al SW

#### 6.6 Modificar `background.js`
- Recibir `OPTIMIZE_PROMPT` del content script
- Ejecutar Zona B (classifier, lang-detector, signal-extractor, payload-builder)
- Enviar al servidor via `bg-server-client.js`
- Recibir `OptimizationResult`
- Enviar al content script con formato nuevo

#### 6.7 Reescribir `content-panels.js`
- Panel Before/After anotado por segmentos
- Colorización: `intent` (verde), `constraint` (azul), `context_high` (amarillo), `context_low` (naranja), `filler` (rojo con tachado)
- Barra de similitud semántica
- Métricas de ahorro con referencias metodológicas
- Edición directa del prompt optimizado antes de aceptar
- Botones: Aceptar, Editar, Descartar

#### 6.8 Adaptar `content-overlay.js`
- Agregar modo "Mejorar" (sin "Estructurar")
- Indicador de estado del servidor (disponible/no disponible)
- Timeout visual (si el servidor tarda > 2s)

#### 6.9 Adaptar `popup.js` + `popup.html`
- Reemplazar indicadores Ollama/ONNX por estado del servidor
- Mostrar latencia del servidor
- Botón o instrucciones para iniciar el servidor
- Solo modos Comprimir y Mejorar

**Criterio de éxito:** El panel muestra visualmente qué fue eliminado y por qué. La reinyección funciona en los tres proveedores (ChatGPT, Claude, Gemini).

---

### Fase 7 — Sandbox de Testing + Empaquetado + Pulido (2-3 días)

#### 7.1 Crear sandbox de testing
- `sandbox/test-harness.html`: página HTML local que simula un textarea de LLM
- `sandbox/test-harness.js`: lógica para capturar resultados de la extensión
- `sandbox/test-cases.json`: al menos 20 casos de prueba predefinidos
- El sandbox permite probar la extensión sin abrir ChatGPT/Claude/Gemini
- Debe funcionar como `content_scripts` match para `localhost` o como página de prueba

#### 7.2 Tests del servidor (pytest)
- `test_verifier.py`: al menos 10 casos
- `test_segmenter.py`: al menos 15 casos
- `test_budget.py`: al menos 5 casos
- `test_pruner.py`: al menos 10 casos
- `test_validator.py`: al menos 5 casos
- `test_rebuilder.py`: al menos 5 casos
- `test_integration.py`: al menos 10 casos end-to-end

#### 7.3 Empaquetado del servidor
- Crear `iandes-server/build.py` con PyInstaller
- Generar ejecutable para Windows (prioridad), macOS, Linux
- La UI del servidor se empaqueta junto con los modelos
- El ejecutable debe iniciar FastAPI + UI en un solo comando
- Tamaño estimado: ~200-300MB (incluyendo modelos spaCy y MiniLM)

#### 7.4 Verificar `impact/calculator.py`
- Fórmulas con referencias académicas
- `methodology_ref` en el response
- **Pendiente:** investigar papers más recientes para actualizar valores

#### 7.5 Warmup automático
- La extensión hace `GET /health` al detectar que el servidor puede estar disponible
- Indicador visual en el overlay cuando el servidor está listo

#### 7.6 Manejo de errores
- Servidor no disponible → overlay muestra "Inicia iandes-server para optimizar prompts"
- Timeout > 2000ms → mensaje de timeout
- HTTP 413 → "Prompt demasiado largo (máximo 8000 caracteres)"
- HTTP 500 → mensaje del servidor

#### 7.7 Actualizar métricas locales
- Unificar fórmulas: usar Patterson/Li para la estimación local
- Actualizar `content-metrics.js` y `config.js`

#### 7.8 Limpieza
- Eliminar archivos obsoletos de v4 (ver sección 5.1)
- Actualizar `package.json` (eliminar dependencias de Transformers.js, ONNX)
- Actualizar `README.md` y `INSTALL.md`
- Eliminar `CHANGELOG.md` viejo (o archivarlo)
- Eliminar `REGLAS_CAPA1.md` (la lógica se mueve al servidor)
- Eliminar `PLAN_CORRECCION_CAPA1_SANDBOX.md` y `PROYECTO_STATUS.md` (documentos de v4)

**Criterio de éxito:** El sandbox permite probar la extensión sin sitios de LLM. El servidor se empaqueta como ejecutable. Las métricas muestran cifras con fuente citada. El sistema falla de forma elegante si el servidor no está corriendo.

---

## 7. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| D2 (Segmenter) produce segmentación incorrecta | Alta | Crítico | Tests exhaustivos (15+ casos), calibrar umbral, fallback a segmentación por oraciones |
| Latencia del servidor > 2s en hardware modesto | Media | Alto | Benchmark en laptop sin GPU, optimizar con batching de embeddings, warmup en startup |
| spaCy `es_core_news_sm` no detecta bien intents en español | Media | Medio | D1 solo se activa cuando confidence < 0.60; el pre-flight classifier cubre el 80% de los casos |
| sentence-transformers model (~126MB) tarda en descargar | Alta | Bajo | Descargar en `pip install`, no en runtime. Documentar en INSTALL.md |
| Content script no puede hacer fetch a localhost | Alta (ya identificado) | Crítico | Toda comunicación HTTP va por el Service Worker (ya diseñado así) |
| Mantener dos clasificadores (JS + Python) en sincronía | Media | Medio | Tests compartidos, documentación explícita |
| El usuario no tiene Python instalado | Alta | Alto | Empaquetar como ejecutable con PyInstaller |
| Rollback parcial en D5 no converge | Baja | Medio | Límite duro de 2 iteraciones. Si no converge, `quality_warning: true` |
| PyInstaller genera ejecutable muy grande (>500MB) | Media | Bajo | Optimizar con exclusión de módulos innecesarios, compresión UPX |
| UI del servidor no es intuitiva | Media | Medio | Iterar con feedback del usuario, mantener minimalista |

---

## 8. Dependencias entre Fases

```
Fase 0 (Preparación)
  │
  ├── Fase 1 (Servidor base + contrato + UI mínima)
  │     │
  │     ├── Fase 2 (D4 Pruner + D3 Budget)
  │     │     │
  │     │     └── Fase 3 (D5 Validator)
  │     │           │
  │     │           └── Fase 4 (D2 Segmenter) ← la más difícil
  │     │                 │
  │     │                 └── Fase 5 (D1 Verifier)
  │     │
  │     └── Fase 6 (Extensión: Zona B + Zona E) ← puede empezar en paralelo con Fase 2
  │           │
  │           └── Fase 7 (Sandbox + Empaquetado + Pulido)
  │
  └── Fase 6 puede empezar tan pronto como Fase 1 esté completa
```

**Paralelización posible:**
- Fases 2-5 (servidor) y Fase 6 (extensión) pueden avanzar en paralelo una vez que Fase 1 esté completa.
- Fase 7 depende de que Fase 6 esté completa.

---

## 9. Estimación de Tiempo Total

| Fase | Días | Notas |
|------|------|-------|
| Fase 0: Preparación | 1 | Estructura de directorios |
| Fase 1: Servidor base + contrato + UI mínima | 3-4 | FastAPI + Pydantic + CORS + UI |
| Fase 2: D4 Pruner + D3 Budget | 2-3 | TF-IDF + lookup table |
| Fase 3: D5 Validator | 1-2 | Cosine similarity + rollback |
| Fase 4: D2 Segmenter | 3-4 | El módulo más difícil |
| Fase 5: D1 Verifier | 1 | spaCy, simple |
| Fase 6: Extensión Zona B + E | 3-4 | Pre-flight + UI anotada |
| Fase 7: Sandbox + Empaquetado + Pulido | 2-3 | Tests, PyInstaller, limpieza |
| **Total** | **16-22 días** | Con paralelización: ~14-17 días |

---

## 10. Contrato HTTP Actualizado (sin `structure`)

### PromptAnalysis v2.0 (extensión → servidor)

```json
{
  "version": "2.0",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "raw_prompt": "Texto completo del prompt tal como lo escribió el usuario",
  "mode": "compress",
  "preflight": {
    "intent": "general",
    "confidence": 0.50,
    "estimated_tokens": 312,
    "language": "es",
    "has_code_blocks": false,
    "paragraph_count": 2
  },
  "constraints": {
    "max_output_tokens": null,
    "preserve_entities": true,
    "quality_floor": 0.85
  },
  "metadata": {
    "source": "claude",
    "timestamp": 1745640000
  }
}
```

**Nota:** `mode` solo acepta `"compress"` y `"enhance"`. El valor `"structure"` queda reservado para v5.1+.

### OptimizationResult (servidor → extensión)

Sin cambios respecto al plan original. Ver sección "Zona C" del documento original.

---

## 11. Nota sobre LLM Locales

El plan v5 elimina completamente la dependencia de Ollama. Sin embargo, se menciona que **se probará posteriormente con LLM locales** como alternativa o complemento al pipeline D1-D6.

**Posibles integraciones futuras (v5.1+):**
- Ollama como alternativa al pipeline D4-D6 para modo `enhance`
- LM Studio como alternativa local
- API de OpenAI/Anthropic como alternativa cloud (con impacto en la promesa de "100% local")

**Por ahora:** el pipeline D1-D6 es la única vía de procesamiento. No hay fallback a LLM.

---

*Análisis actualizado con decisiones del usuario — 27 de abril de 2026*