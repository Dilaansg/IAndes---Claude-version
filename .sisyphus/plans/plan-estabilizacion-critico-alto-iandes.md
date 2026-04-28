# Plan de Estabilización Crítico/Alto — IAndes

## TL;DR
> **Summary**: Estabilizar IAndes corrigiendo exclusivamente fallos Críticos/Altos de runtime y ambigüedades de arquitectura, con refactor agresivo controlado, pruebas automáticas y CI mínima.
> **Deliverables**:
> - Correcciones de runtime en ONNX/Ollama/mensajería MV3 con degradación segura.
> - Eliminación de `catch` silenciosos y contrato de errores estructurado.
> - Fuente única de verdad para reglas Capa 1 y consolidación de heurísticas de tokens.
> - Infra mínima de tests + CI + sandbox local HTML para simular chatbots LLM.
> **Effort**: Large
> **Parallel**: YES - 3 waves
> **Critical Path**: T1/T4/T5/T10/T11/T12 → T7/T8/T9/T13/T14

## Context
### Original Request
- Analizar el proyecto, encontrar errores/bugs/ambigüedades y crear plan para corregir y mejorar.

### Interview Summary
- Prioridad: estabilidad y bugs críticos.
- Alcance bloqueado: **solo severidad Crítica y Alta** (excluye media/baja en esta iteración).
- Estrategia: **agresiva controlada** (se permite refactor focalizado para eliminar causa raíz).
- Calidad: incluir **tests automáticos + CI mínima** en esta iteración.
- Requisito adicional del usuario: incluir **sandbox HTML local** para simular UIs tipo chatbot y probar flujo local de prompts.

### Metis Review (gaps addressed)
- Se bloquea alcance con severidad explícita (Critical/High only).
- Se agregan guardrails de refactor: fail-open, request correlation, single-flight en cargas pesadas y límites de scope.
- Se exige verificación ejecutable por agente (happy + failure por tarea) y evidencia en `.sisyphus/evidence/`.
- Se evita dependencia de QA manual: CI ejecuta pruebas determinísticas; pruebas live no bloqueantes si dependen de servicios externos.
- Se agrega matriz de dependencias completa y política de rollback por wave.

### Oracle Review (guardrails incorporated)
- Capa 1 tendrá **fuente única de verdad en código** (`layer1_rules.js`), documentación sincronizada.
- Toda falla de capas avanzadas debe degradar en forma segura (retornar texto original o salida previa segura).
- Toda comunicación asíncrona debe estar correlacionada por `requestId` para descartar respuestas obsoletas.
- El estado MV3 se considera efímero: rutas críticas deben tolerar cold start de Service Worker.

## Work Objectives
### Core Objective
Eliminar fallos Críticos/Altos que comprometen estabilidad funcional (runtime, mensajería, integraciones ONNX/Ollama, reglas duplicadas y observabilidad de errores) sin introducir alcance de severidad media/baja.

### Deliverables
- D1. Runtime ONNX robusto ante variación de nombres/shapes y fallos de descarga/cache.
- D2. Integración Ollama robusta ante timeout/respuestas inválidas/no disponibilidad.
- D3. Mensajería MV3 robusta (sin respuestas obsoletas ni estados colgados).
- D4. Contrato de errores estructurado sin `catch` silenciosos.
- D5. Reglas Capa 1 consolidadas (source of truth única).
- D6. Heurística de tokens consolidada y worker endurecido.
- D7. Infra de pruebas + CI mínima + sandbox local HTML con escenarios automatizados.

### Definition of Done (verifiable conditions with commands)
- `npm ci`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:sandbox`
- `npm run ci:verify`
- Resultado esperado: todos los comandos terminan exit code 0 y generan evidencia en `.sisyphus/evidence/`.

### Must Have
- Solo correcciones de issues Críticos/Altos.
- Refactor permitido únicamente si reduce riesgo raíz de un issue Crítico/Alto.
- Cada tarea incluye implementación + test + escenarios QA happy/failure.
- Degradación segura en fallos de ONNX/Ollama/mensajería (sin romper UX principal).
- Sandbox local funcional para pruebas determinísticas de flujo de prompts.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- No incluir mejoras Medium/Low salvo bloqueador técnico directo de un fix Crítico/Alto (debe justificarse en PR).
- No introducir features nuevas de producto fuera del objetivo de estabilidad.
- No aceptar criterios vagos (“se ve bien”, “parece funcionar”).
- No dejar manejo de errores por `console` únicamente en rutas críticas.
- No separar fuente de verdad de reglas Capa 1 entre múltiples implementaciones divergentes.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: **tests-after** (nueva base de pruebas en esta iteración).
- Framework propuesto: Node test runner + Playwright para sandbox UI local.
- QA policy: cada tarea incluye escenario happy + escenario failure/edge.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1 (Foundations / Infra + Contracts): T1, T2, T3, T4, T5, T6, T10, T11, T12

Wave 2 (Critical Runtime Fixes): T7, T8, T9, T13, T14

Wave 3 (Consolidation + Regression Proof): T15, T16

### Dependency Matrix (full, all tasks)
| Task | Depends On | Blocks | Notes |
|---|---|---|---|
| T1 | - | T7, T8, T9, T13, T14 | Bootstrap de pruebas |
| T2 | T1 | T14 | Configurar CI mínima |
| T3 | - | T14 | Crear sandbox HTML |
| T4 | - | T7, T8, T9, T13 | Definir contrato de errores |
| T5 | - | T10, T11, T12, T13 | Estandarizar mensajería |
| T6 | - | T8, T9, T13 | Centralizar config crítica |
| T7 | T4, T6 | T13 | Endurecer pipeline ONNX |
| T8 | T4, T6 | T13 | Endurecer descarga/caché ONNX |
| T9 | T4, T6 | T13 | Endurecer detección/uso Ollama |
| T10 | T5 | T13 | Consolidar fuente única reglas Capa 1 |
| T11 | T5 | T13 | Consolidar heurística tokens |
| T12 | T5 | T13 | Endurecer lifecycle MV3 |
| T13 | T1, T4, T5, T6, T7, T8, T9, T10, T11, T12 | T14 | Integrar flujos de degradación UI |
| T14 | T1, T2, T3, T13 | Final Verification | Ejecutar suite completa |
| T15 | T13 | - | UI error states overlay |
| T16 | T13 | - | Final verification completa |

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 9 tasks → `unspecified-high` (6), `quick` (2), `visual-engineering` (1)
- Wave 2 → 5 tasks → `unspecified-high` (5)
- Wave 3 → 2 tasks → `visual-engineering` (1), `unspecified-high` (1)

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

<!-- TASKS INSERTED HERE IN BATCHES -->

- [x] 1. Bootstrap de pruebas y scripts de verificación

  **What to do**: Crear infraestructura mínima de ejecución (`package.json`, scripts `test:unit`, `test:integration`, `test:sandbox`, `ci:verify`) y estructura de carpetas de tests para habilitar verificación automática de fixes Críticos/Altos.
  **Must NOT do**: Añadir tooling de formato/lint no requerido para estabilidad en esta iteración.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: diseño base de tooling afecta todo el plan.
  - Skills: `[]` - no skill obligatorio.
  - Omitted: `[/frontend-ui-ux]` - no foco visual.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [2, 13, 14] | Blocked By: [-]

  **References**:
  - Pattern: `README.md:1` - arquitectura y flujo esperados para definir suites.
  - API/Type: `manifest.json:24` - contexto MV3 service worker.
  - Test: `.sisyphus/plans/plan-estabilizacion-critico-alto-iandes.md:1` - contrato de estrategia de verificación.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npm ci` ejecuta sin error.
  - [ ] `npm run test:unit` existe y retorna exit code 0 (aunque inicialmente con pruebas base).
  - [ ] `npm run ci:verify` ejecuta pipeline local completo y retorna exit code 0.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Happy path bootstrap
    Tool: Bash
    Steps: Ejecutar `npm ci`; luego `npm run ci:verify`
    Expected: ambos comandos finalizan con código 0 y generan evidencia de ejecución
    Evidence: .sisyphus/evidence/task-1-bootstrap-tooling.txt

  Scenario: Failure path dependencia ausente
    Tool: Bash
    Steps: Ejecutar `npm run test:sandbox` antes de crear archivos de sandbox
    Expected: falla explícita con mensaje de archivo/suite faltante (no fallo silencioso)
    Evidence: .sisyphus/evidence/task-1-bootstrap-tooling-error.txt
  ```

  **Commit**: YES | Message: `chore(tests): bootstrap minimal test runner and scripts` | Files: `package.json`, `tests/**`, config de test

- [x] 2. Configurar CI mínima bloqueante para suites determinísticas

  **What to do**: Crear workflow CI que ejecute `npm ci` y `npm run ci:verify`; separar cualquier prueba dependiente de servicios externos como job no bloqueante.
  **Must NOT do**: Hacer bloqueante una prueba live que dependa de Ollama/red externa.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: cambio acotado de infraestructura CI.
  - Skills: `[]` - no skill obligatorio.
  - Omitted: `[/dev-browser]` - no aplica.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [14] | Blocked By: [1]

  **References**:
  - Pattern: `README.md:1` - requisitos externos ONNX/Ollama que no deben hard-fallar en CI.
  - API/Type: `.sisyphus/plans/plan-estabilizacion-critico-alto-iandes.md:46` - política de QA sin intervención humana.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Workflow CI corre automáticamente en push/PR.
  - [ ] Job bloqueante ejecuta únicamente pruebas determinísticas.
  - [ ] Job de pruebas live (si existe) queda marcado como no bloqueante.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Happy path CI dry-run
    Tool: Bash
    Steps: Ejecutar workflow local/simulador o validar YAML + lanzar `npm run ci:verify`
    Expected: configuración válida y comandos de job principal exitosos
    Evidence: .sisyphus/evidence/task-2-ci.txt

  Scenario: Failure path script inexistente
    Tool: Bash
    Steps: Referenciar temporalmente un script inválido en CI (rama de prueba) y ejecutar validación
    Expected: CI falla con error explícito de script, no con timeout ambiguo
    Evidence: .sisyphus/evidence/task-2-ci-error.txt
  ```

  **Commit**: YES | Message: `ci(tests): add minimal deterministic verification workflow` | Files: `.github/workflows/**`

- [x] 3. Crear sandbox HTML local para simular chatbots LLM (refactorizado a tester.html con transformación de prompts)

  **What to do**: Implementar página(s) HTML local(es) de sandbox con variantes `textarea`, `contenteditable`, y flujo de envío para simular entornos estilo ChatGPT/Claude/Gemini; incluir datos de prueba predecibles.
  **Must NOT do**: Integrar sandbox al bundle productivo de extensión ni depender de autenticación/servicios externos.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: requiere reproducción fiel de patrones UI/DOM de chat.
  - Skills: `[]` - no skill obligatorio.
  - Omitted: `[/git-master]` - no operación git especial.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [14] | Blocked By: [-]

  **References**:
  - Pattern: `content.js:108` - inicialización worker y puntos de enganche UI.
  - Pattern: `content.js:295` - clasificación local de prompts.
  - Pattern: `content.js:1182` - envío de mensaje a background en pipeline.
  - API/Type: `manifest.json:45` - recursos accesibles y restricciones MV3.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Existe sandbox local con al menos 3 variantes DOM (textarea/contenteditable/híbrido).
  - [ ] Pruebas automatizadas pueden cargar sandbox y ejecutar flujo de optimización local.
  - [ ] Sandbox no se incluye en artefactos productivos de extensión.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Happy path flujo en sandbox
    Tool: Playwright
    Steps: Abrir `http://127.0.0.1:4173/sandbox/chat-sim.html`; llenar `#prompt-input` con `"Hola, por favor ayúdame a resumir este texto largo con bullets"`; click `#btn-optimize`; esperar `#status-pill[data-state="done"]`; verificar `#output-text` no vacío
    Expected: `#status-pill` cambia a `done`, `#output-text` contiene texto optimizado y no hay errores en consola
    Evidence: .sisyphus/evidence/task-3-sandbox-happy.png

  Scenario: Failure path DOM no soportado
    Tool: Playwright
    Steps: Abrir `http://127.0.0.1:4173/sandbox/chat-missing-input.html`; click `#btn-optimize`; capturar `#error-banner`
    Expected: `#error-banner` visible con código `SANDBOX_INPUT_NOT_FOUND` y sin excepción no controlada
    Evidence: .sisyphus/evidence/task-3-sandbox-error.png
  ```

  **Commit**: YES | Message: `test(sandbox): add local html chatbot simulation harness` | Files: `sandbox/**`, `tests/sandbox/**`

- [x] 4. Definir contrato de errores estructurado y eliminar catch silencioso crítico

  **What to do**: Introducir contrato unificado de errores (códigos, contexto, severidad) y aplicar en rutas críticas de `content.js`, `background.js`, `token_worker.js` reemplazando `catch` silenciosos por manejo explícito + degradación segura.
  **Must NOT do**: Dejar fallos críticos solo en `console.warn` sin propagación estructurada al flujo.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: atraviesa varios módulos críticos con impacto runtime.
  - Skills: `[]` - no skill obligatorio.
  - Omitted: `[/frontend-ui-ux]` - foco principal es contrato de runtime.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [7, 8, 9, 13] | Blocked By: [-]

  **References**:
  - Pattern: `content.js:143`, `content.js:667`, `content.js:1207` - catches representativos.
  - Pattern: `background.js:136` - entrada de mensajería runtime.
  - Pattern: `token_worker.js:47`, `token_worker.js:65`, `token_worker.js:107`, `token_worker.js:119` - catch/silencios en worker.

  **Acceptance Criteria** (agent-executable only):
  - [ ] No quedan catches vacíos en rutas críticas identificadas.
  - [ ] Errores críticos generan objeto estructurado con código y contexto.
  - [ ] Pipeline mantiene fail-open (retorna salida segura) ante error de capas avanzadas.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Happy path error controlado
    Tool: Bash
    Steps: Ejecutar suite de tests de errores (`npm run test:integration -- --grep error-contract`)
    Expected: todos los errores simulados devuelven código estructurado + fallback seguro
    Evidence: .sisyphus/evidence/task-4-error-contract.txt

  Scenario: Failure path excepción no tipada
    Tool: Bash
    Steps: Inyectar excepción genérica en prueba de integración y ejecutar suite
    Expected: se normaliza a error estructurado; no revienta proceso principal
    Evidence: .sisyphus/evidence/task-4-error-contract-error.txt
  ```

  **Commit**: YES | Message: `fix(runtime): enforce structured error contract in critical paths` | Files: `content.js`, `background.js`, `token_worker.js`, `tests/**`

- [x] 5. Estandarizar protocolo de mensajería MV3 con requestId

  **What to do**: Definir esquema de mensaje y correlación por `requestId` entre `content.js`, `background.js` y `popup.js`; asegurar que respuestas tardías o de pestañas inválidas se descartan limpiamente.
  **Must NOT do**: Mezclar respuestas de solicitudes distintas o dejar UI colgada esperando respuesta indefinida.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: coordinación asíncrona multi-módulo bajo restricciones MV3.
  - Skills: `[]` - no skill obligatorio.
  - Omitted: `[/dev-browser]` - no navegación real requerida para el núcleo de protocolo.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [10, 11, 12, 13] | Blocked By: [-]

  **References**:
  - Pattern: `background.js:136` - listener central `chrome.runtime.onMessage`.
  - Pattern: `content.js:1182` - `chrome.runtime.sendMessage` en flujo principal.
  - Pattern: `popup.js:1` - consumidor de estado/acciones por mensajería.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Cada solicitud de optimización tiene `requestId` único verificable por tests.
  - [ ] Respuestas fuera de orden se descartan sin alterar estado actual.
  - [ ] Timeout/control de conexión inválida retorna error estructurado y fallback seguro.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Happy path dos requests concurrentes
    Tool: Bash
    Steps: Ejecutar test de concurrencia que dispara dos OPTIMIZE_PROMPT con distinto requestId
    Expected: cada respuesta se aplica al request correcto; sin contaminación cruzada
    Evidence: .sisyphus/evidence/task-5-messaging-happy.txt

  Scenario: Failure path respuesta tardía obsoleta
    Tool: Bash
    Steps: Simular retraso artificial en background para request antiguo y emitir request nuevo
    Expected: respuesta tardía se descarta; UI conserva resultado del request vigente
    Evidence: .sisyphus/evidence/task-5-messaging-error.txt
  ```

  **Commit**: YES | Message: `fix(messaging): add request correlation and stale-response drop` | Files: `content.js`, `background.js`, `popup.js`, `tests/**`

- [x] 6. Centralizar configuración crítica

  **What to do**: Crear un módulo/config única para constantes críticas usadas por `background.js` y `content.js` (timeouts Ollama, thresholds de similitud, políticas de retry/degradación), eliminando dispersión de valores.
  **Must NOT do**: Cambiar valores funcionales sin pruebas de regresión asociadas.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: evita deriva de comportamiento en rutas críticas.
  - Skills: `[]` - no skill obligatorio.
  - Omitted: `[/frontend-ui-ux]` - no objetivo visual.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [7, 8, 9, 13] | Blocked By: [-]

  **References**:
  - Pattern: `background.js:844` - timeout/detección Ollama.
  - Pattern: `background.js:947` - inicialización ONNX.
  - Pattern: `content.js:295` - thresholds de clasificación local.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Constantes críticas viven en una sola fuente importable.
  - [ ] `background.js` y `content.js` consumen la misma configuración crítica.
  - [ ] Tests validan que no hay desviaciones entre módulos para los mismos parámetros.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Happy path consistencia de config
    Tool: Bash
    Steps: Ejecutar `npm run test:unit -- --grep config-consistency`
    Expected: pruebas pasan confirmando igualdad de valores críticos entre consumidores
    Evidence: .sisyphus/evidence/task-6-config-happy.txt

  Scenario: Failure path valor inválido
    Tool: Bash
    Steps: Inyectar valor fuera de rango en fixture de config y ejecutar test de validación
    Expected: falla controlada con error de validación `CONFIG_VALIDATION_FAILED`
    Evidence: .sisyphus/evidence/task-6-config-error.txt
  ```

  **Commit**: YES | Message: `refactor(runtime): centralize critical runtime configuration` | Files: `background.js`, `content.js`, `config/**`, `tests/**`

- [x] 7. Endurecer pipeline ONNX

  **What to do**: Modificar `computeEmbedding`/flujo Capa 2 para detectar nombres reales de inputs/outputs del modelo ONNX (`session.inputNames`/`session.outputNames`) y validar shapes antes de operar (`meanPool`, cosine), con fallback seguro.
  **Must NOT do**: Asumir nombres estáticos (`input_ids`, `last_hidden_state`) sin validación.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: riesgo crítico de runtime por mismatch de contrato ONNX.
  - Skills: `[]` - no skill obligatorio.
  - Omitted: `[/dev-browser]` - no interacción web necesaria.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [13] | Blocked By: [4, 6]

  **References**:
  - Pattern: `background.js:563` - `computeEmbedding`.
  - Pattern: `background.js:947` - `getOnnxSession`.
  - Pattern: `background.js:472` - llamada Capa 2 en deduplicación.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Tests cubren output name alternativo sin romper pipeline.
  - [ ] Shape inválido produce error estructurado + fallback seguro (sin crash).
  - [ ] Capa 2 funciona con modelo esperado y falla controladamente con modelo incompatible.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Happy path output dinámico válido
    Tool: Bash
    Steps: Ejecutar `npm run test:integration -- --grep onnx-io-contract`
    Expected: embedding generado correctamente usando output detectado dinámicamente
    Evidence: .sisyphus/evidence/task-7-onnx-io-happy.txt

  Scenario: Failure path shape mismatch
    Tool: Bash
    Steps: Ejecutar prueba con tensor de salida de shape inválido
    Expected: error `ONNX_SHAPE_MISMATCH` + retorno fail-open sin excepción fatal
    Evidence: .sisyphus/evidence/task-7-onnx-io-error.txt
  ```

  **Commit**: YES | Message: `fix(onnx): harden model io contract and shape validation` | Files: `background.js`, `tests/background/**`

- [x] 8. Endurecer descarga/caché ONNX y diagnóstico de disponibilidad runtime

  **What to do**: Fortalecer `downloadOnnxModel`/cache handling con validación de respuesta, diagnóstico explícito de CORS/red/tamaño, y mensajes estructurados hacia UI para degradación transparente.
  **Must NOT do**: Fallar silenciosamente cuando el modelo no se descarga o cachea.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: error de red/cache bloquea Capa 2 en producción.
  - Skills: `[]` - no skill obligatorio.
  - Omitted: `[/frontend-ui-ux]` - foco en backend runtime.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [13] | Blocked By: [4, 6]

  **References**:
  - Pattern: `background.js:982` - `downloadOnnxModel`.
  - Pattern: `background.js:958` - uso de modelo cacheado/descargado.
  - API/Type: `manifest.json:13` - permisos host relevantes.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Fallos de descarga/cors generan códigos de error diferenciables.
  - [ ] Cache corrupta o ausente se detecta y no produce estado inconsistente.
  - [ ] UI puede distinguir "ONNX deshabilitado" vs "ONNX temporalmente no disponible".

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Happy path descarga + cache
    Tool: Bash
    Steps: Ejecutar test de integración con fetch mock exitoso y cache vacío
    Expected: modelo se almacena en cache y Capa 2 queda disponible
    Evidence: .sisyphus/evidence/task-8-onnx-cache-happy.txt

  Scenario: Failure path CORS/red
    Tool: Bash
    Steps: Simular fetch 403/CORS en test de integración
    Expected: error estructurado `ONNX_DOWNLOAD_FAILED` y degradación segura en pipeline
    Evidence: .sisyphus/evidence/task-8-onnx-cache-error.txt
  ```

  **Commit**: YES | Message: `fix(onnx): harden download cache and runtime diagnostics` | Files: `background.js`, `content.js`, `tests/background/**`

- [x] 9. Endurecer detección/uso de Ollama (timeout, headers, respuesta inválida)

  **What to do**: Revisar `getOllamaModel`/`layer3Rewrite` para tolerar latencia realista, remover supuestos frágiles de headers, validar payload de respuesta y degradar limpiamente a capa previa.
  **Must NOT do**: Marcar indisponibilidad por timeout demasiado agresivo sin reintento controlado.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: integración externa crítica con alto riesgo de falsos negativos.
  - Skills: `[]` - no skill obligatorio.
  - Omitted: `[/dev-browser]` - no navegación requerida.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [13] | Blocked By: [4, 6]

  **References**:
  - Pattern: `background.js:844` - `getOllamaModel`.
  - Pattern: `background.js:781` - `layer3Rewrite`.
  - Pattern: `README.md:31` - requisito opcional de Ollama.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Timeout configurable y cubierto por pruebas (sin falsos negativos triviales).
  - [ ] Respuesta inválida/malformed produce error estructurado y fallback seguro.
  - [ ] Si no hay modelo válido, Capa 3 se desactiva limpiamente sin romper flujo.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Happy path Ollama disponible
    Tool: Bash
    Steps: Ejecutar tests con mock de `/api/tags` y `/api/chat` válidos
    Expected: se selecciona modelo válido y se genera reescritura
    Evidence: .sisyphus/evidence/task-9-ollama-happy.txt

  Scenario: Failure path timeout/JSON inválido
    Tool: Bash
    Steps: Simular timeout y luego respuesta JSON corrupta
    Expected: errores `OLLAMA_TIMEOUT` / `OLLAMA_RESPONSE_INVALID` + fallback seguro
    Evidence: .sisyphus/evidence/task-9-ollama-error.txt
  ```

  **Commit**: YES | Message: `fix(ollama): harden model detection timeout and response handling` | Files: `background.js`, `tests/background/**`

- [x] 10. Robustecer lifecycle MV3 ante suspensión de Service Worker

  **What to do**: Ajustar flujos de `sendMessage`/`onMessage` para manejar cold start, reconexión y timeout de SW; asegurar que UI no queda colgada y se aplica fallback determinista.
  **Must NOT do**: Asumir disponibilidad continua del SW entre request y response.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: condición crítica específica de MV3 con fallos intermitentes.
  - Skills: `[]` - no skill obligatorio.
  - Omitted: `[/frontend-ui-ux]` - objetivo principal es robustez de lifecycle.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [13] | Blocked By: [5]

  **References**:
  - Pattern: `background.js:136` - listener principal.
  - Pattern: `content.js:1182` - request al SW desde content.
  - Pattern: `popup.js:1` - consultas periódicas de estado.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Pruebas simulan SW suspendido/reanudado sin dejar estado colgado.
  - [ ] Errores de conexión runtime se traducen a fallback seguro + mensaje estructurado.
  - [ ] No hay mezcla de estado entre solicitudes consecutivas tras reconexión.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Happy path reconexión SW
    Tool: Bash
    Steps: Ejecutar test que simula suspensión/reanudación entre request y response
    Expected: request se recupera o falla controladamente sin colgar UI
    Evidence: .sisyphus/evidence/task-10-mv3-happy.txt

  Scenario: Failure path conexión inválida
    Tool: Bash
    Steps: Forzar `runtime.lastError` en mensajería durante test
    Expected: se emite error estructurado `MV3_CHANNEL_UNAVAILABLE` y fallback seguro
    Evidence: .sisyphus/evidence/task-10-mv3-error.txt
  ```

  **Commit**: YES | Message: `fix(mv3): handle service worker suspend-resume message lifecycle` | Files: `content.js`, `background.js`, `popup.js`, `tests/**`

- [x] 11. Consolidar fuente única de verdad para reglas Capa 1 y eliminar duplicación

  **What to do**: Establecer `layer1_rules.js` como fuente canónica; sincronizar o regenerar `REGLAS_CAPA1.md` desde el código; eliminar lógica duplicada en `content.js` y centralizar en la función exportación del módulo de reglas.
  **Must NOT do**: Mantener múltiples definiciones de reglas que pueden diverger silenciosamente.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: deuda alta por duplicación de lógica de negocio.
  - Skills: `[]` - no skill obligatorio.
  - Omitted: `[/dev-browser]` - no interacción web necesaria.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: [13] | Blocked By: [5]

  **References**:
  - Pattern: `layer1_rules.js:3` - catálogo de reglas.
  - Pattern: `REGLAS_CAPA1.md:1` - docs a sincronizar.
  - Pattern: `content.js:295` - classifyPrompt con reglas embebidas.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `layer1_rules.js` exporta función usable en consumo canónico.
  - [ ] `content.js` importa y usa función de `layer1_rules.js` (sin duplicar lógica).
  - [ ] Tests de equivalencia confirman mismo resultado para mismos inputs.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Happy path equivalencia rule-set
    Tool: Bash
    Steps: Ejecutar tests de equivalencia entre implementación actual y imported desde layer1_rules
    Expected: 100% match en outputs para dataset de pruebas
    Evidence: .sisyphus/evidence/task-11-layer1-happy.txt

  Scenario: Failure path divergencia detectado
    Tool: Bash
    Steps: Ejecutar test con input que difiere entre implementaciones actuales
    Expected: test falla y reporta divergencia exacta encontrada
    Evidence: .sisyphus/evidence/task-11-layer1-error.txt
  ```

  **Commit**: YES | Message: `refactor(layer1): consolidate rule source of truth` | Files: `layer1_rules.js`, `REGLAS_CAPA1.md`, `content.js`, `tests/**`

- [x] 12. Consolidar heurística de conteo de tokens y endurecer token_worker.js

  **What to do**: Unificar heurística entre `token_utils.js` y `token_worker.js` en un solo módulo; endurecer worker ante fallbacks, mensajes malformados y timeouts.
  **Must NOT do**: Mantener lógicas divergentes que producen recuentos inconsistentes.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: duplicación de lógica de conteo con potencial de diverge.
  - Skills: `[]` - no skill obligatorio.
  - Omitted: `[/frontend-ui-ux]` - no objetivo visual.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: [13] | Blocked By: [5]

  **References**:
  - Pattern: `token_utils.js:1` - heurística compartida.
  - Pattern: `token_worker.js:47` - fallback worker.
  - Pattern: `content.js:153` - llamada a conteo.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Un módulo exporta función de estimación usable en ambos contextos.
  - [ ] Worker reporta errores estructurados (no silenciosos) ante fallbacks.
  - [ ] Tests comparan worker vs heurística locally para detectar drift.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Happy path convergencia resultados
    Tool: Bash
    Steps: Comparar output de estimación de worker vs módulo local para 50+ prompts
    Expected: diferencias dentro de tolerancia esperada (±15%)
    Evidence: .sisyphus/evidence/task-12-tokens-happy.txt

  Scenario: Failure path drift detectado
    Tool: Bash
    Steps: Ejecutar suite que força drift entre dos implementaciones
    Expected: falla con diff máximo real super + ubicación de divergencia
    Evidence: .sisyphus/evidence/task-12-tokens-error.txt
  ```

  **Commit**: YES | Message: `fix(tokens): consolidate token estimation heuristic` | Files: `token_utils.js`, `token_worker.js`, `content.js`, `tests/**`

- [ ] 13. Integrar flujos de degradación en UI y surface de errores para usuario

  **What to do**: Conectar el contrato de errores y degradaciones de las tareas previas a la UI overlay (`content.js`) y popup; asegurar que el usuario comprende estado (disponible/fallback/deshabilitado).
  **Must NOT do**: Mostrar errores crípticos o no documentados al usuario.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: requiere exponer estado y errores claramente en UI.
  - Skills: `[]` - no skill obligatorio.
  - Omitted: `[/git-master]` - no operación git especial.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: [14] | Blocked By: [1, 4, 5, 6, 7, 8, 9, 10, 11, 12]

  **References**:
  - Pattern: `content.js:667` - overlay de error.
  - Pattern: `popup.js:1` - estado visible en popup.
  - Pattern: `content.js:108` - initialization worker.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Overlay muestra estado claro: "optimizado", "fallback", "no disponible", "error".
  - [ ] Popup refleja estado de ONNX/Ollama con códigos de error legibles.
  - [ ] Tests UI verifican texto de estados correctos para cada condición.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Happy path estados visibles
    Tool: Playwright
    Steps: ejecutar flujos que trigger cada estado y verificar texto en overlay/popup
    Expected: estado legible y consistente con resultado de pipeline
    Evidence: .sisyphus/evidence/task-13-ui-happy.png

  Scenario: Failure path error genérico
    Tool: Playwright
    Steps: Forzar exception no manejada en pipeline y verificar respuesta UI
    Expected: mensaje "Error de optimización" sin detalle técnico al usuario
    Evidence: .sisyphus/evidence/task-13-ui-error.png
  ```

  **Commit**: YES | Message: `feat(ui): expose structured error states to user overlay and popup` | Files: `content.js`, `popup.js`, `tests/sandbox/**`

- [ ] 14. Ejecutar suite completa de verificación y generar evidencia

  **What to do**: Ejecutar `npm run ci:verify` (suite determinística) y generar evidencia de paso/fallo por tarea; documentar resultados y capturar logs para evidencia.
  **Must NOT do**: Omitir generación de evidencia; entregar sin prueba de que commands funcionan.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: verificación final de completitud del plan.
  - Skills: `[]` - no skill obligatorio.
  - Omitted: `[/dev-browser]` - no navegación.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: [Final Verification] | Blocked By: [1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]

  **References**:
  - API/Type: `plan-estabilizacion-critico-alto-iandes.md:51` - Definition of Done commands.
  - API/Type: `plan-estabilizacion-critico-alto-iandes.md:77` - Evidence paths.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npm ci` exit code 0.
  - [ ] `npm run test:unit` exit code 0.
  - [ ] `npm run test:integration` exit code 0.
  - [ ] `npm run test:sandbox` exit code 0.
  - [ ] `npm run ci:verify` exit code 0.
  - [ ] Existe evidencia en `.sisyphus/evidence/` para cada paso.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Happy path CI completa
    Tool: Bash
    Steps: ejecutar `npm run ci:verify` y capturar exit code + logs
    Expected: exit code 0; evidencia en carpeta evidence/
    Evidence: .sisyphus/evidence/task-14-ci-final.txt

  Scenario: Failure path CI falla
    Tool: Bash
    Steps: ejecutar suite y capturar primer failure + stack trace
    Expected: evidencia de failure con código + test que falló
    Evidence: .sisyphus/evidence/task-14-ci-failure.txt
  ```

  **Commit**: YES | Message: `test(verification): run final verification suite` | Files: evidencia en `.sisyphus/evidence/**`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay**. Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.

- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy
- Commits at least one per task (or paired micro-tasks only when atomicity requires).
- Conventional commits format: `type(scope): desc`.
- Required scopes: `runtime`, `onnx`, `ollama`, `messaging`, `layer1`, `tokens`, `tests`, `ci`, `sandbox`.
- No commit may include Medium/Low cleanups unless tagged as blocker in commit body.

## Success Criteria
- Todos Crítico/Alto identificados en diagnóstico quedan corregidos o con degradación segura verificable.
- No quedan `catch` silenciosos en rutas críticas (`content.js`, `background.js`, `token_worker.js`).
- Capa 2/Capa 3 no bloquean UX: fallos devuelven salida segura y mensaje estructurado.
- Sandbox local reproduce flujos de prompt y escenarios de error de forma determinística.
- CI mínima ejecuta pruebas unitarias, de integración y sandbox sin intervención humana.