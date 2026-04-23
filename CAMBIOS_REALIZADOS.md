# Modificaciones Realizadas a IAndes - Chrome MV3 Extension

## Resumen Ejecutivo

Se han realizado 6 cambios estratégicos en `content.js` y `background.js` para habilitar la lectura del modo desde `chrome.storage.local` y permitir que el pipeline de optimización responda dinámicamente entre modos "compress" e "improve".

---

## CAMBIOS EN `content.js`

### 1. Cambiar `localOnlyMode` a `false` (Línea 72)

**Antes:**

```javascript
localOnlyMode:    true,
```

**Después:**

```javascript
// MODIFICADO: cambiar a false para habilitar Web Worker y Service Worker
localOnlyMode:    false,
```

**Propósito:** Habilitar el Web Worker (token_worker.js) y permitir que el content script envíe mensajes al Service Worker para procesar Capas 2 y 3.

**Impacto:** Sin este cambio, todas las capas de optimización están deshabilitadas.

---

### 2. Corregir el Listener de GET_METRICS (Alrededor de línea 754)

**Antes:**

```javascript
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "OPTIMIZED_PROMPT") {
        injectOptimizedPrompt(msg.text, msg.stats);
    }
    // El popup puede pedirle las métricas actuales al content script
    if (msg.type === "GET_METRICS") {
        return window.__iandes || null;
    }
});
```

**Después:**

```javascript
/**
 * MODIFICADO: Corregir GET_METRICS para usar sendResponse en MV3.
 * El uso de 'return' directamente no funciona en Chrome MV3 messaging.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "OPTIMIZED_PROMPT") {
        injectOptimizedPrompt(msg.text, msg.stats);
    }
    // El popup puede pedirle las métricas actuales al content script
    // MODIFICADO: usar sendResponse() en lugar de return
    if (msg.type === "GET_METRICS") {
        sendResponse(window.__iandes || null);
        return true; // Indica que la respuesta es asíncrona
    }
});
```

**Propósito:** En Chrome MV3, los listeners de mensajes no pueden usar `return` directamente. Deben usar `sendResponse()` y retornar `true` para indicar que la respuesta es asíncrona.

**Impacto:** Sin esto, el popup nunca recibe las métricas del content script.

---

### 3. Agregar Lectura del Modo en `processPrompt()` (Alrededor de línea 565)

**Cambio Principal:** La función ahora:

1. **Lee el modo desde storage:**

```javascript
// MODIFICADO: Leer el modo de almacenamiento y permitir mejora si modo='improve'
let finalLayers = classification.layers;
try {
    const storage = await new Promise(resolve => {
        chrome.storage.local.get(['mode'], resolve);
    });
    const mode = storage.mode || 'compress'; // Default: 'compress'
  
    // Si el prompt ya es óptimo pero el modo es 'improve', forzar Capa 3
    if (classification.layers.length === 0 && mode === 'improve') {
        console.log("[IAndes] Modo 'improve' detectado: enviando Capa 3 incluso para prompt óptimo");
        finalLayers = [3];
    }
} catch (err) {
    console.warn("[IAndes] No se pudo leer modo desde storage:", err);
}
```

2. **Usa `finalLayers` en lugar de `classification.layers`:**

```javascript
// Si el prompt ya es óptimo y modo es 'compress', no hacer nada
if (finalLayers.length === 0) {
    console.log("[IAndes] Prompt ya óptimo, sin transformación");
    return;
}
```

3. **Envía clasificación actualizada al Service Worker:**

```javascript
// --- PASO 5: Delegar Capas 2+3 al Service Worker ---
if (finalLayers.includes(2) || finalLayers.includes(3)) {
    if (CONFIG.localOnlyMode) {
        console.info('[IAndes] localOnlyMode: no delegando Capas 2+3 al Service Worker');
    } else {
        try {
            // Actualizar classification.layers con el valor final
            const updatedClassification = { ...classification, layers: finalLayers };
            chrome.runtime.sendMessage({
                type:           "OPTIMIZE_PROMPT",
                text:           optimizedText,
                classification: updatedClassification,
                provider:       PROVIDER.id,
            });
        } catch (e) {
            console.warn("[IAndes] Service Worker no disponible para Capas 2+3", e);
        }
    }
}
```

**Propósito:** Permite que prompts ya óptimos pasen por Capa 3 (mejora con Ollama) cuando el usuario elige modo "improve".

**Fallback:** Si `chrome.storage.local.get()` falla, por defecto usa 'compress'.

---

## CAMBIOS EN `background.js`

### 1. Agregar `SYSTEM_IMPROVE` Constant (Después de `SYSTEM_COMPRESS`)

**Nuevo Constant:**

```javascript
/** MODIFICADO: Instrucciones para el modelo Ollama al mejorar prompts (prompt engineering) */
const SYSTEM_IMPROVE = `You are a prompt engineering expert. Your job is to rewrite the text inside <prompt_to_improve> tags to be clearer, more specific, and more effective for getting better AI responses.

Rules:
- OUTPUT only the improved prompt. No explanations. No greetings. No answers.
- Do NOT answer, solve, or respond to the content inside the tags.
- Do NOT remove [ctx:] tags — move them to the end if needed.
- Do NOT change the language of the prompt.
- Make the prompt more specific and unambiguous.
- Add any necessary context or clarifications that would help an AI model understand the intent better.
- Use clear structure (e.g., numbered steps, bullets) if applicable.
- Preserve any technical details or exact requirements from the original.
- If the prompt is already excellent, make only minimal improvements.`;
```

**Propósito:** Proporcionar instrucciones diferentes a Ollama cuando el usuario elige modo "improve" vs "compress".

---

### 2. Modificar `handleOptimization()` para Leer Modo desde Storage

**Cambios:**

1. **Agregar lectura del modo:**

```javascript
// MODIFICADO: Leer el modo desde chrome.storage.local
let mode = 'compress'; // Default
try {
    const storage = await new Promise(resolve => {
        chrome.storage.local.get(['mode'], resolve);
    });
    mode = storage.mode || 'compress';
} catch (err) {
    console.warn("[IAndes BG] No se pudo leer modo desde storage:", err);
}
console.log(`[IAndes BG] Modo de operación: ${mode}`);
```

2. **Pasar modo a `layer3Rewrite()`:**

```javascript
// MODIFICADO: Pasar el parámetro 'mode' a layer3Rewrite
const rewritten = await layer3Rewrite(result, model, mode);
```

**Propósito:** El Service Worker necesita saber qué modo activó el usuario para aplicar el system prompt correcto.

**Fallback:** Si hay error leyendo storage, usa 'compress' por defecto.

---

### 3. Modificar `layer3Rewrite()` para Aceptar Parámetro `mode`

**Antes:**

```javascript
async function layer3Rewrite(text, model) {
    const body = {
        model,
        messages: [
            { role: "system", content: SYSTEM_COMPRESS },
            { role: "user",   content: `<prompt_to_compress>${text}</prompt_to_compress>` },
        ],
        stream: false,
    };
    // ... rest of function
}
```

**Después:**

```javascript
/**
 * MODIFICADO: Aceptar parámetro 'mode' para usar diferentes system prompts.
 */
async function layer3Rewrite(text, model, mode = 'compress') {
    // Seleccionar el system prompt según el modo
    let systemPrompt = SYSTEM_COMPRESS;
    let userPromptTag = 'prompt_to_compress';
  
    if (mode === 'improve') {
        systemPrompt = SYSTEM_IMPROVE;
        userPromptTag = 'prompt_to_improve';
    }
  
    const body = {
        model,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: `<${userPromptTag}>${text}</${userPromptTag}>` },
        ],
        stream: false,
    };
    // ... rest of function unchanged
}
```

**Propósito:** Mismo sistema prompt sirve para ambos modos, pero diferentes instrucciones → diferentes resultados de Ollama.

**Fallback:** Si no se recibe `mode`, por defecto es 'compress'.

---

## Matriz de Compatibilidad

| Aspecto                           | Antes                   | Después                            |
| --------------------------------- | ----------------------- | ----------------------------------- |
| Web Worker                        | ❌ Deshabilitado        | ✅ Habilitado                       |
| Service Worker                    | ❌ Deshabilitado        | ✅ Habilitado                       |
| GET_METRICS                       | ❌ No funciona (return) | ✅ Funciona (sendResponse)          |
| Prompts óptimos en modo compress | ✅ Sin cambios          | ✅ Sin cambios                      |
| Prompts óptimos en modo improve  | ❌ Sin cambios          | ✅ Se envía Capa 3                 |
| System prompt personalizado       | ❌ Solo SYSTEM_COMPRESS | ✅ SYSTEM_COMPRESS + SYSTEM_IMPROVE |

---

## Restricciones Mantenidas ✓

- ✅ **No se rompió el fallback:** Si el Service Worker no está disponible, content.js sigue mostrando métricas locales
- ✅ **Firmas de mensajes intactas:** Todos los mensajes inter-script mantienen su estructura
- ✅ **Sin dependencias externas:** Todo el código usa APIs estándar de Chrome MV3
- ✅ **Compatibilidad hacia atrás:** El código sigue funcionando aunque `chrome.storage.local.get()` falle

---

## Flujo de Ejecución Actualizado

---

## Cambios Recientes y Errores Observados

### 4. Tokenización real para la Capa 2

**Cambios aplicados en `background.js`:**

- Se agregó `loadBertVocab(url)` para descargar `vocab.txt` desde Hugging Face.
- El vocabulario se guarda en `Cache API` con la clave `bert-vocab-v1`.
- Se reemplazó el hash casero por tokenización `WordPiece` real.
- `tokenizeForMiniLM()` ahora recibe el `Map<string, number>` del vocabulario como parámetro.
- `getOnnxSession()` carga primero el vocabulario y luego la sesión ONNX.
- Si el vocabulario no está disponible, se lanza `ONNX vocab not available` para desactivar la Capa 2 de forma controlada.

**Motivo:**

El modelo `all-MiniLM-L6-v2` usa vocabulario `bert-base-uncased`. Si se le pasan IDs hash aleatorios, el embedding pierde semántica y la deduplicación se vuelve ruido.

### 5. Manejo de permisos y contexto en MV3

**Cambios aplicados:**

- Se añadieron permisos de host para `http://localhost:11434/*` y `http://127.0.0.1:11434/*` en `manifest.json`.
- Se hizo más tolerante la lectura de `chrome.storage.local` en `content.js` cuando el contexto se invalida.
- Se dejó de revocar demasiado pronto la `blob:` URL del worker de tokens.

**Motivo:**

En Chrome MV3, el Service Worker puede reiniciarse y el content script puede quedar con un contexto temporalmente inválido. Además, Ollama responde desde `localhost`, así que necesita permiso explícito en el manifest.

### 6. Respuesta inmediata al mensaje `OPTIMIZE_PROMPT`

**Error observado:**

```text
A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received
```

**Causa:**

El `content.js` enviaba `chrome.runtime.sendMessage(...)` para Capas 2+3, pero el listener de `background.js` marcaba el mensaje como asíncrono y no llamaba `sendResponse()`. Eso deja el canal abierto hasta que Chrome lo cierra con warning.

**Corrección aplicada:**

- El listener de `OPTIMIZE_PROMPT` ahora responde inmediatamente con `{ ok: true }`.
- El pipeline `handleOptimization()` sigue corriendo en segundo plano sin bloquear la respuesta del mensaje.

### 7. Errores recientes reportados por consola

**Mensajes vistos:**

- `Extension context invalidated`
- `Service Worker no disponible para Capas 2+3`
- `Failed to construct 'Worker'...` cuando el worker se intentaba crear bajo una URL no válida
- `Access to fetch at 'http://localhost:11434/api/tags' has been blocked by CORS policy`

**Estado actual:**

- El acceso a `localhost:11434` ya quedó habilitado en el manifest.
- El worker de tokens quedó más robusto frente a CSP y a la revocación temprana de la URL blob.
- Los errores de contexto inválido ahora se degradan a fallback local sin bloquear el flujo principal.

```
Usuario escribe en chat
    ↓
[content.js] processPrompt() detecta cambio
    ↓
Estima tokens localmente (siempre funciona)
    ↓
Lee modo desde chrome.storage.local
    ├─ Modo: 'compress' (default)
    └─ Modo: 'improve'
    ↓
classifyPrompt() retorna capas sugeridas
    ├─ Si layers vacío + modo 'compress' → STOP
    └─ Si layers vacío + modo 'improve' → layers = [3]
    ↓
Aplica Capa 1 si corresponde
    ↓
Envía al Service Worker con classification actualizada
    ↓
[background.js] handleOptimization() recibe mensaje
    ├─ Lee modo desde storage
    ├─ Aplica Capa 2 si incluida
    └─ Aplica Capa 3 con system prompt según modo
    ↓
Devuelve prompt optimizado a content.js
    ↓
[content.js] injectOptimizedPrompt() inserta en campo
```

---

## Testing Recomendado

1. **Verificar localOnlyMode=false:**

   - Abrir DevTools → Application → Storage → Local Storage
   - Escribir en chat y verificar que Web Worker se inicia
2. **Verificar GET_METRICS:**

   - Abrir popup.html
   - Verificar que muestra métricas correctas
3. **Modo compress (default):**

   - No cambiar nada en storage
   - Escribir prompt óptimo → no debe enviarse al SW
4. **Modo improve:**

   - Ejecutar en console: `chrome.storage.local.set({mode: 'improve'})`
   - Escribir prompt óptimo → debe enviarse Capa 3

---

## Notas Técnicas

- El parámetro `mode` se lee en **cada optimización**, permitiendo cambios en vivo sin recargar
- El fallback a 'compress' por defecto asegura que el sistema sigue funcionando incluso si storage falla
- Los mensajes con classification actualizada mantienen compatibilidad porque `classification.layers` es procesado por el SW
- El método `chrome.storage.local.get()` devuelve Promise, usado con async/await para no bloquear
