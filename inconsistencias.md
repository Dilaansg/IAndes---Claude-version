# 🔍 Análisis de Inconsistencias — IAndes Extension

## Resumen Ejecutivo

El proyecto tiene **3 bugs críticos que rompen el funcionamiento**, **4 inconsistencias arquitectónicas graves** y **varios problemas menores**. La causa raíz es que distintos agentes de IA modificaron partes del código en forma aislada sin ver el efecto sistémico.

---

## 🔴 BUGS CRÍTICOS (rompen la extensión)

### 1. `config.js` usa `export const` — incompatible con `importScripts()`

**Archivo:** `config.js` (todo el archivo)  
**Problema:** El Service Worker (`background.js`) carga config con:
```js
importScripts('config.js');
const { ONNX_MODEL_URL, ... } = self;
```
Pero `config.js` usa ES Modules (`export const`). `importScripts()` **no es compatible con ES Modules**. El Service Worker fallará silenciosamente al intentar leer `self.ONNX_MODEL_URL` — todas las constantes serán `undefined`.

**Fix:** Cambiar `config.js` de `export const X = ...` a `self.X = ...` (o `var X = ...` sin export), ya que se usa con `importScripts`.

---

### 2. `content.js` está INCOMPLETO — le faltan ~60-70% de las funciones

**Archivo:** `content.js`  
**Problema:** El archivo referencia estas funciones que **no están definidas en ningún lugar del proyecto**:

| Función llamada | ¿Dónde se define? |
|---|---|
| `getChatInputs()` | ❌ No existe |
| `attachListener()` | ❌ No existe |
| `INPUT_SELECTOR` | ❌ No definida |
| `classifyPrompt()` | ❌ No existe |
| `getOrCreateOverlay()` | ❌ No existe |
| `renderOverlay()` | ❌ No existe |
| `renderOverlayInfo()` | ❌ No existe |
| `renderOverlaySuccess()` | ❌ No existe |
| `renderOverlayError()` | ❌ No existe |
| `renderImproveReviewPanel()` | ❌ No existe |
| `isImproveResultMessage()` | ❌ No existe |
| `persistSessionStats()` | ❌ No existe |
| `escapeHtml()` | ❌ No existe |
| `hideOptimizeHint()` | ❌ No existe |
| `window.__iandes` | ❌ Nunca se asigna |

El archivo se inicia directamente llamando `getChatInputs().forEach(attachListener)` en la línea 626 — **esto crasha inmediatamente** con `ReferenceError: getChatInputs is not defined`.

**Causa probable:** Algún agente de IA dividió `content.js` en múltiples archivos pero nunca completó la extracción. Solo se extrajo `token_utils.js` y `layer1_rules.js`, pero el resto del contenido de `content.js` desapareció.

---

### 3. `error_utils.js` exporta a `window` — no funciona en Service Worker

**Archivo:** `error_utils.js` (línea 163)  
**Problema:**
```js
} else {
    window.IAndesErrors = { ... };  // ❌ window no existe en SW
}
```
El Service Worker no tiene objeto `window`. Cuando `background.js` hace `importScripts('error_utils.js')`, el `else` intenta `window.IAndesErrors = ...` y lanza `ReferenceError`.

El fallback en `background.js` (líneas 15-49) mitiga esto parcialmente, pero solo si el crash en `error_utils.js` es silencioso — y no lo es.

**Fix:** Cambiar a `self.IAndesErrors = ...` para cubrir tanto Service Workers como Workers.

---

## 🟠 INCONSISTENCIAS ARQUITECTÓNICAS GRAVES

### 4. `config.js` duplicado en `content.js`

`content.js` define sus propias constantes locales (líneas 169-191):
```js
const CONTENT_CONFIG = { debounceMs: 1500, ... };
const WATER_ML_PER_TOKEN = 0.0035;
const CO2_G_PER_TOKEN = 0.0004;
const MODEL_ENV_SCALE = { ... };
```
Estas son **idénticas** a las que están en `config.js`. Además, `content.js` intenta cargar `config.js` dinámicamente (líneas 147-165) pero **jamás usa las variables cargadas** — usa sus propias copias locales. Es código muerto.

---

### 5. `config/constants.js` — archivo huérfano con CommonJS

**Archivo:** `config/constants.js`  
Contiene:
```js
exports.OLLAMA_TIMEOUT = 1000;  // ← distinto valor que config.js (500ms)
exports.SIMILARITY_THRESHOLD = 0.88;
exports.RETRY_ATTEMPTS = 3;
```
- Usa `exports` (CommonJS/Node.js) — **incompatible con extensiones Chrome**.
- `OLLAMA_TIMEOUT` tiene valor diferente (1000 vs 500 en config.js) — **inconsistencia de configuración**.
- `RETRY_ATTEMPTS` está definido aquí pero nunca se usa en ningún lado.
- **Nada importa este archivo**. Es código muerto.

---

### 6. `fixCatch.js` — script Node.js incluido en la extensión

**Archivo:** `fixCatch.js`  
Es un script de mantenimiento para reemplazar `catch` vacíos automáticamente. Usa `require('fs')` — es un script de Node.js, no parte de la extensión. **No debería estar en la raíz del proyecto** ni ser referenciable por la extensión.

---

### 7. `background.js` intenta leer constantes de `self` pero config.js no las pone ahí

```js
// background.js líneas 84-97
const {
    ONNX_MODEL_URL,
    ONNX_CACHE_NAME,
    ...
} = self;
```
Esto funciona solo si `importScripts('config.js')` popula `self` con esas variables. Pero como `config.js` usa `export const`, no lo hace. Todas serán `undefined`.

---

## 🟡 PROBLEMAS MENORES

### 8. `content.js` — error en catch de `getLayer1RulesCatalog()` (líneas 660-673)

```js
try {
    window.__iandes_rulebook = getLayer1RulesCatalog();
} catch (e) {
    ErrorUtils.createStructuredError?.({
        ...
        context: { 
            savedTokens: stats?.savedTokens,  // ❌ `stats` no existe en este scope
            mode: mode,                        // ❌ `mode` no existe en este scope
```
El `catch` referencia variables `stats` y `mode` que no existen en el scope de ese bloque. Esto causaría un segundo error dentro del handler de error.

---

### 9. `token_worker.js` — líneas mezcladas con CRLF y LF

El archivo mezcla `\r\n` (Windows) y `\n` (Unix) en línea 129. Es cosmético pero indica edición manual inconsistente.

---

### 10. Capa 0 / `classifyPrompt` nunca definida en `content.js`

El comentario en `content.js` (línea 413) dice:
```js
// ---------------------------------------------------------------------------
// CAPA 0 — Router / Clasificador de intención
// ---------------------------------------------------------------------------
```
Pero la función `classifyPrompt` nunca se define. El mensaje que se envía al Service Worker incluye `msg.classification` (background.js línea 137), que vendría de `classifyPrompt` — **esta función nunca se implementó o se perdió**.

---

### 11. `popup.html` tiene toggle ON/OFF descrito en código pero no implementado en UI

`content.js` (línea 208) tiene:
```js
let extensionEnabled = true;
```
Y hay comentario `// --- Toggle ON/OFF ---`, pero el popup no tiene ningún control de toggle visible en el HTML. El estado se lee pero no hay forma de cambiarlo desde la UI.

---

## 📋 Mapa de Archivos

| Archivo | Estado | Notas |
|---|---|---|
| `manifest.json` | ✅ OK | Correcto para MV3 |
| `background.js` | 🟠 Parcial | Funcional si config.js se arregla |
| `content.js` | 🔴 ROTO | Le faltan ~50% de las funciones |
| `config.js` | 🔴 ROTO | `export` incompatible con `importScripts` |
| `error_utils.js` | 🟠 Parcial | `window` debe ser `self` |
| `layer1_rules.js` | ✅ OK | Correcto |
| `token_utils.js` | ✅ OK | Correcto |
| `token_worker.js` | ✅ OK | Funcional |
| `popup.js` | ✅ OK | Funcional |
| `popup.html` | ✅ OK | Correcto |
| `config/constants.js` | 🗑️ HUÉRFANO | CommonJS, nadie lo importa |
| `fixCatch.js` | 🗑️ FUERA DE LUGAR | Script Node.js, no extensión |

---

## 🔧 Prioridad de Fixes

1. **[CRÍTICO]** Arreglar `config.js`: reemplazar `export const X = ...` por `self.X = ...`
2. **[CRÍTICO]** Recuperar o reconstruir las funciones faltantes de `content.js` (overlay, DOM, classifyPrompt, etc.)
3. **[CRÍTICO]** Arreglar `error_utils.js`: `window.IAndesErrors` → `self.IAndesErrors`
4. **[MAYOR]** Eliminar `config/constants.js` y `fixCatch.js` del proyecto
5. **[MENOR]** Limpiar duplicación de constantes en `content.js`
6. **[MENOR]** Implementar o eliminar el toggle ON/OFF en el popup
