/**
 * =============================================================================
 * IAndes – Service Worker (background.js) v3.0
 * =============================================================================
 *
 * ¿Qué hace este archivo?
 *   El Service Worker es un script que corre en segundo plano del navegador,
 *   separado de las páginas web. No tiene acceso al DOM de los chats — para
 *   eso está content.js. Su trabajo es el procesamiento pesado:
 *
 *   CAPA 2: Deduplicación semántica
 *     Usa un modelo de IA pequeño (all-MiniLM-L6-v2, ~22 MB) para detectar
 *     frases repetidas en el prompt y eliminar las redundantes.
 *     Ejemplo: Si el prompt dice "explícame la fotosíntesis" y luego
 *     "describe el proceso de la fotosíntesis", ambas dicen lo mismo
 *     → elimina la segunda.
 *
 *   CAPA 3: Reescritura generativa (solo si Ollama está disponible)
 *     Si el usuario tiene Ollama instalado en su computadora, usa un modelo
 *     de lenguaje local para reescribir el prompt de forma más compacta
 *     sin perder el significado.
 *
 *   ¿Por qué aquí y no en content.js?
 *     El Service Worker puede cargar el modelo ONNX (22 MB) en memoria sin
 *     afectar el rendimiento de la página del chat. Si lo hiciéramos en
 *     content.js, podría ralentizar el navegador.
 *
 * =============================================================================
 */

// ---------------------------------------------------------------------------
// CONSTANTES DE CONFIGURACIÓN
// ---------------------------------------------------------------------------

/**
 * URL del modelo de embeddings que usamos para la Capa 2.
 * all-MiniLM-L6-v2 es un modelo pequeño (~22 MB) que convierte texto en
 * vectores numéricos. Dos textos con significado similar tendrán vectores
 * similares → podemos detectar redundancia.
 */
const ONNX_MODEL_URL  = "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx";
const ONNX_CACHE_NAME = "iandes-onnx-v1";    // Nombre del cache del navegador
const ONNX_CACHE_KEY  = "all-MiniLM-L6-v2-int8.onnx";  // Clave dentro del cache

/** URL base de Ollama (servidor local de modelos de IA) */
const OLLAMA_BASE    = "http://localhost:11434";
const OLLAMA_TIMEOUT = 500;   // ms para detectar si Ollama está corriendo

/**
 * Umbral de similitud para considerar dos frases como "redundantes".
 * 0.88 significa: si dos frases son un 88% similares en significado,
 * eliminar la segunda.
 * - Más alto (ej: 0.95): solo elimina repeticiones casi literales
 * - Más bajo (ej: 0.80): elimina cosas relacionadas aunque no sean iguales
 */
const SIMILARITY_THRESHOLD = 0.88;

/**
 * Sistema de puntuación para elegir el mejor modelo de Ollama disponible.
 * Queremos modelos que sean buenos en instrucciones pero no demasiado grandes
 * (para que sean rápidos en hardware modesto).
 */
const OLLAMA_SCORING = {
    families:     ["qwen2.5", "llama3.2", "mistral", "gemma2", "phi3"],
    familyPts:    10,   // +10 si es una familia conocida y buena
    sizePts:       5,   // +5 si tiene entre 1.5B y 7B parámetros
    instructPts:   3,   // +3 si el nombre dice "instruct" o "chat"
    codePenalty:  -8,   // -8 si es un modelo especializado en código/matemáticas
    largePenalty: -3,   // -3 si tiene más de 7B parámetros (demasiado lento)
    tinyPenalty: -10,   // -10 si tiene menos de 1.5B (muy baja calidad)
    recentPts:     1,   // +1 si fue usado recientemente
};

/** Instrucciones para el modelo Ollama al comprimir prompts */
const SYSTEM_COMPRESS = `You are a text compressor. Your only job is to rewrite the text inside <prompt_to_compress> tags to be shorter while keeping the original intent, meaning, language, and any [ctx:] tags.

Rules:
- OUTPUT only the compressed text. No explanations. No greetings. No answers.
- Do NOT answer, solve, or respond to the content inside the tags.
- Do NOT remove [ctx:] tags — move them to the end if needed.
- Do NOT change the language of the prompt.
- Do NOT add information that was not in the original.
- If the text is already short (under 15 words), output it unchanged.`;


// ---------------------------------------------------------------------------
// ESTADO DEL SERVICE WORKER
// ---------------------------------------------------------------------------

let onnxSession   = null;   // La sesión del modelo ONNX (se carga una vez)
let ollamaModel   = null;   // El nombre del modelo Ollama seleccionado
let ollamaChecked = false;  // ¿Ya verificamos si Ollama está disponible?


// ---------------------------------------------------------------------------
// MENSAJERÍA CON EL CONTENT SCRIPT
// ---------------------------------------------------------------------------

/**
 * Escuchar mensajes que envía el Content Script (content.js).
 *
 * Tipos de mensajes:
 *   OPTIMIZE_PROMPT  → Procesar el prompt con las Capas 2+3
 *   DOWNLOAD_ONNX_MODEL → Descargar el modelo ONNX manualmente
 *   GET_STATUS       → ¿Qué está disponible? (para el popup)
 *   SET_MODE         → Cambiar entre modo "comprimir" y "mejorar"
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

    if (msg.type === "OPTIMIZE_PROMPT") {
        // Ejecutar el pipeline de optimización en segundo plano
        handleOptimization(msg.text, msg.classification, sender.tab?.id)
            .catch(err => console.error("[IAndes BG] Error en pipeline:", err));
        return true; // Indica que la respuesta será asíncrona
    }

    if (msg.type === "DOWNLOAD_ONNX_MODEL") {
        // El usuario inició la descarga manual del modelo desde el popup
        downloadOnnxModel()
            .then(()  => sendResponse({ ok: true }))
            .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    if (msg.type === "GET_STATUS") {
        // El popup pregunta qué está listo
        getSystemStatus().then(sendResponse);
        return true;
    }

    if (msg.type === "SET_MODE") {
        // El usuario cambió el modo en el popup → guardar en storage
        chrome.storage.local.set({ mode: msg.mode });
        return false;
    }
});


// ---------------------------------------------------------------------------
// PIPELINE PRINCIPAL DE OPTIMIZACIÓN
// ---------------------------------------------------------------------------

/**
 * Orquesta las Capas 2 y 3 sobre el texto que viene de content.js.
 *
 * Si alguna capa falla (modelo no disponible, Ollama apagado, etc.),
 * el pipeline continúa con lo que tenga, sin interrumpirse.
 *
 * @param {string} text           - El texto después de aplicar Capa 1
 * @param {object} classification - Resultado de classifyPrompt (de content.js)
 * @param {number} tabId          - ID de la pestaña para devolver el resultado
 */
async function handleOptimization(text, classification, tabId) {
    let result = text;
    const stats = {
        originalTokens: estimateTokens(text),
        layers: [],   // Qué capas se activaron realmente
    };

    // --- CAPA 2: Deduplicación semántica ---
    if (classification.layers.includes(2)) {
        try {
            const deduplicated = await layer2Deduplicate(result);
            if (deduplicated !== result) {
                stats.layers.push("layer2");
                result = deduplicated;
                console.log("[IAndes BG] Capa 2 aplicada: texto deduplicado");
            } else {
                console.log("[IAndes BG] Capa 2: sin redundancias detectadas");
            }
        } catch (err) {
            // La Capa 2 puede fallar si el modelo ONNX no está descargado
            console.warn("[IAndes BG] Capa 2 no disponible:", err.message);
        }
    }

    // --- CAPA 3: Reescritura con Ollama ---
    if (classification.layers.includes(3)) {
        try {
            const model = await getOllamaModel();
            if (model) {
                const rewritten = await layer3Rewrite(result, model);
                if (rewritten && rewritten !== result) {
                    stats.layers.push("layer3");
                    result = rewritten;
                    console.log("[IAndes BG] Capa 3 aplicada: texto reescrito con Ollama");
                }
            } else {
                console.log("[IAndes BG] Capa 3 no disponible: Ollama no encontrado");
            }
        } catch (err) {
            console.warn("[IAndes BG] Capa 3 falló:", err.message);
        }
    }

    // Si el texto cambió, enviarlo de vuelta al Content Script para inyectarlo
    if (result !== text && tabId) {
        const finalTokens    = estimateTokens(result);
        stats.savedTokens    = stats.originalTokens - finalTokens;
        stats.savedPct       = Math.round((stats.savedTokens / stats.originalTokens) * 100);

        chrome.tabs.sendMessage(tabId, {
            type:  "OPTIMIZED_PROMPT",
            text:  result,
            stats,
        });
    }
}


// ---------------------------------------------------------------------------
// CAPA 2 — DEDUPLICACIÓN SEMÁNTICA (ONNX)
// ---------------------------------------------------------------------------

/**
 * Encuentra y elimina frases/párrafos redundantes del texto.
 *
 * Proceso:
 *   1. Dividir el texto en fragmentos (párrafos, frases)
 *   2. Generar un vector numérico (embedding) para cada fragmento
 *   3. Comparar todos los vectores entre sí
 *   4. Si dos fragmentos son muy similares (>0.88), eliminar el segundo
 *   5. Reconstruir el texto solo con los fragmentos que sobreviven
 *
 * @param {string} text - El texto a procesar
 * @returns {string} - El texto sin redundancias
 */
async function layer2Deduplicate(text) {
    const session = await getOnnxSession();
    if (!session) throw new Error("Modelo ONNX no disponible");

    // Dividir el texto en fragmentos
    const segments = segmentText(text);
    if (segments.length <= 1) return text; // Solo hay un fragmento, nada que deduplicar

    // Generar un embedding (vector) para cada fragmento
    const embeddings = await Promise.all(
        segments.map(seg => computeEmbedding(session, seg))
    );

    // Comparar cada fragmento con los anteriores
    const survivors = [0]; // El primer fragmento siempre se conserva
    for (let i = 1; i < segments.length; i++) {
        let maxSimilarity = 0;

        // Comparar con cada fragmento ya aceptado
        for (const j of survivors) {
            const sim = cosineSimilarity(embeddings[i], embeddings[j]);
            if (sim > maxSimilarity) maxSimilarity = sim;
        }

        // Solo conservar este fragmento si NO es muy similar a ninguno anterior
        if (maxSimilarity < SIMILARITY_THRESHOLD) {
            survivors.push(i);
        }
    }

    // Si todos los fragmentos sobrevivieron, el texto no tenía redundancias
    if (survivors.length === segments.length) return text;

    // Reconstruir el texto solo con los fragmentos que sobrevivieron
    return survivors.map(i => segments[i]).join(" ");
}

/**
 * Divide el texto en fragmentos para analizar.
 *
 * Jerarquía de separadores (de mayor a menor peso):
 *   \n\n → separador de párrafo
 *   \n   → separador de línea/idea
 *   . ? ! → separador de oración
 *   ventana deslizante → para texto sin puntuación
 */
function segmentText(text) {
    if (text.includes("\n\n")) {
        return text.split(/\n\n+/).map(s => s.trim()).filter(Boolean);
    }
    if (text.includes("\n")) {
        return text.split(/\n/).map(s => s.trim()).filter(Boolean);
    }
    // Dividir por oraciones (punto, signo de pregunta, exclamación)
    const sentences = text.match(/[^.?!]+[.?!]+|[^.?!]+$/g);
    if (sentences && sentences.length > 1) {
        return sentences.map(s => s.trim()).filter(Boolean);
    }
    // Fallback: ventana deslizante de ~80 palabras con 20 de solapamiento
    return slidingWindowChunks(text, 80, 20);
}

/**
 * Divide el texto en chunks de tamaño fijo con solapamiento.
 * Se usa cuando el texto no tiene puntuación ni saltos de línea.
 *
 * @param {string} text    - El texto completo
 * @param {number} size    - Tamaño del chunk en palabras
 * @param {number} overlap - Palabras de solapamiento entre chunks
 */
function slidingWindowChunks(text, size, overlap) {
    const words  = text.split(/\s+/);
    const chunks = [];
    let   i      = 0;
    while (i < words.length) {
        chunks.push(words.slice(i, i + size).join(" "));
        i += size - overlap;  // Avanzar, dejando overlap palabras de solapamiento
    }
    return chunks;
}

/**
 * Genera el embedding (vector numérico) de un texto usando ONNX.
 *
 * Un embedding es una representación del significado del texto en forma
 * de vector de 384 números. Textos con significado similar tendrán
 * vectores similares.
 *
 * @param {object} session - La sesión ONNX ya cargada
 * @param {string} text    - El texto a vectorizar
 * @returns {Float32Array} - Vector de 384 dimensiones
 */
async function computeEmbedding(session, text) {
    // Paso 1: Tokenizar el texto (convertir palabras a números)
    const inputIds = tokenizeForMiniLM(text);
    const mask     = new Array(inputIds.length).fill(1);  // Todos los tokens son válidos

    // Paso 2: Preparar los tensores de entrada para el modelo
    const feeds = {
        input_ids:      new ort.Tensor("int64", BigInt64Array.from(inputIds.map(BigInt)), [1, inputIds.length]),
        attention_mask: new ort.Tensor("int64", BigInt64Array.from(mask.map(BigInt)),     [1, inputIds.length]),
        token_type_ids: new ort.Tensor("int64", new BigInt64Array(inputIds.length).fill(0n), [1, inputIds.length]),
    };

    // Paso 3: Ejecutar el modelo ONNX
    const output = await session.run(feeds);

    // Paso 4: Mean pooling — promediar todos los vectores por token para
    // obtener un único vector que representa todo el texto
    return meanPool(output.last_hidden_state.data, inputIds.length, 384);
}

/**
 * Mean pooling: promedia los vectores de todos los tokens para obtener
 * un único vector representativo del texto completo.
 *
 * @param {Float32Array} hiddenState - Salida del modelo (seqLen × hiddenSize)
 * @param {number}       seqLen     - Número de tokens
 * @param {number}       hiddenSize - Dimensión del vector (384 para MiniLM)
 */
function meanPool(hiddenState, seqLen, hiddenSize) {
    const result = new Float32Array(hiddenSize);
    for (let t = 0; t < seqLen; t++) {
        for (let h = 0; h < hiddenSize; h++) {
            result[h] += hiddenState[t * hiddenSize + h];
        }
    }
    for (let h = 0; h < hiddenSize; h++) result[h] /= seqLen;
    return result;
}

/**
 * Similitud coseno entre dos vectores.
 *
 * Retorna un valor entre -1 y 1:
 *   1.0  → idénticos en significado
 *   0.88 → muy similares (nuestro umbral de redundancia)
 *   0.0  → sin relación
 *  -1.0  → opuestos
 */
function cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot   += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    // 1e-8 evita división por cero
    return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
}

/**
 * Tokenización simplificada para all-MiniLM-L6-v2.
 *
 * NOTA: Esta es una aproximación. Para producción completa se debería
 * integrar el tokenizador oficial de Transformers.js, que requiere un
 * paso de build con webpack/rollup.
 */
function tokenizeForMiniLM(text) {
    const CLS     = 101;    // Token especial de inicio [CLS]
    const SEP     = 102;    // Token especial de fin [SEP]
    const MAX_LEN = 128;    // Longitud máxima de MiniLM

    const words   = text.toLowerCase().trim().split(/\s+/).slice(0, MAX_LEN - 2);
    // Convertir cada palabra a un ID numérico usando un hash simple
    const wordIds = words.map(w => {
        let hash = 0;
        for (const c of w) hash = (hash * 31 + c.charCodeAt(0)) & 0x7FFF;
        return Math.max(1000, hash % 30000); // Evitar IDs de tokens especiales (<1000)
    });
    return [CLS, ...wordIds, SEP];
}


// ---------------------------------------------------------------------------
// CAPA 3 — REESCRITURA GENERATIVA (OLLAMA)
// ---------------------------------------------------------------------------

/**
 * Envía el texto al modelo Ollama para que lo reescriba de forma más compacta.
 *
 * Solo se ejecuta si Ollama está corriendo en localhost:11434 Y tiene
 * un modelo adecuado (ver sistema de scoring más abajo).
 *
 * @param {string} text  - El texto a reescribir
 * @param {string} model - El nombre del modelo Ollama a usar
 * @returns {string|null} - El texto reescrito, o null si falló
 */
async function layer3Rewrite(text, model) {
    const body = {
        model,
        messages: [
            { role: "system", content: SYSTEM_COMPRESS },
            { role: "user",   content: `<prompt_to_compress>${text}</prompt_to_compress>` },
        ],
        stream: false,   // Queremos la respuesta completa, no streaming
    };

    const resp = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
    });

    if (!resp.ok) throw new Error(`Ollama respondió con error ${resp.status}`);

    const data = await resp.json();
    // El texto reescrito está en data.message.content
    return data?.message?.content?.trim() || null;
}


// ---------------------------------------------------------------------------
// DETECCIÓN Y SELECCIÓN DEL MEJOR MODELO OLLAMA
// ---------------------------------------------------------------------------

/**
 * Verifica si Ollama está disponible y selecciona el mejor modelo.
 *
 * Se hace una sola vez por sesión del Service Worker para no hacer
 * peticiones repetidas a Ollama.
 */
async function getOllamaModel() {
    if (ollamaChecked) return ollamaModel;
    ollamaChecked = true;

    try {
        // Intentar conectar a Ollama con un timeout corto
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT);

        const resp = await fetch(`${OLLAMA_BASE}/api/tags`, {
            signal: controller.signal
        });
        clearTimeout(tid);

        if (!resp.ok) { ollamaModel = null; return null; }

        const data   = await resp.json();
        const models = data?.models ?? [];
        ollamaModel  = selectBestModel(models);

        if (ollamaModel) {
            console.log(`[IAndes BG] Ollama disponible. Modelo seleccionado: ${ollamaModel}`);
        } else {
            console.log("[IAndes BG] Ollama disponible pero sin modelo adecuado");
        }
        return ollamaModel;

    } catch {
        // Ollama no está corriendo o no está instalado → no es un error fatal
        ollamaModel = null;
        return null;
    }
}

/**
 * Calcula la puntuación de un modelo Ollama según el sistema de scoring.
 *
 * Buscamos modelos que sean buenos siguiendo instrucciones pero no tan
 * grandes que sean lentos. El modelo ideal: qwen2.5:3b
 */
function scoreModel(model) {
    const name  = model.name.toLowerCase();
    let   score = 0;

    // Familia conocida y buena para instrucciones
    if (OLLAMA_SCORING.families.some(f => name.includes(f))) {
        score += OLLAMA_SCORING.familyPts;
    }

    // Tamaño del modelo (extraer el número antes de 'b', ej: "3b" → 3)
    const sizeMatch = name.match(/(\d+(?:\.\d+)?)b/);
    if (sizeMatch) {
        const size = parseFloat(sizeMatch[1]);
        if (size >= 1.5 && size <= 7) score += OLLAMA_SCORING.sizePts;   // Ideal
        if (size > 7)                  score += OLLAMA_SCORING.largePenalty;  // Demasiado lento
        if (size < 1.5)                score += OLLAMA_SCORING.tinyPenalty;   // Poca calidad
    }

    // Modelos de instrucciones
    if (/instruct|chat/.test(name)) score += OLLAMA_SCORING.instructPts;

    // Modelos especializados (no buenos para comprimir texto general)
    if (/code|math|vision|embed/.test(name)) score += OLLAMA_SCORING.codePenalty;

    // Preferir modelos usados recientemente
    const now      = Date.now();
    const modified = model.modified_at ? new Date(model.modified_at).getTime() : 0;
    if (now - modified < 7 * 24 * 3600 * 1000) score += OLLAMA_SCORING.recentPts;

    return score;
}

/** Selecciona el modelo con mayor puntuación (si supera el mínimo de 0) */
function selectBestModel(models) {
    if (!models.length) return null;

    let best = null, bestScore = -Infinity;
    for (const m of models) {
        const s = scoreModel(m);
        if (s > bestScore) { bestScore = s; best = m.name; }
    }

    // Si la mejor puntuación es negativa, ningún modelo es adecuado
    return bestScore >= 0 ? best : null;
}


// ---------------------------------------------------------------------------
// GESTIÓN DEL MODELO ONNX
// ---------------------------------------------------------------------------

/**
 * Obtiene la sesión ONNX, cargándola desde caché o descargándola.
 *
 * El modelo se descarga UNA SOLA VEZ (~22 MB) y queda guardado en el
 * Cache API del navegador. Las veces siguientes se carga desde ahí.
 */
async function getOnnxSession() {
    if (onnxSession) return onnxSession; // Ya está cargado en memoria

    const cache  = await caches.open(ONNX_CACHE_NAME);
    let   cached = await cache.match(ONNX_CACHE_KEY);

    if (!cached) {
        console.log("[IAndes BG] Modelo ONNX no en caché. Descargando (~22 MB)…");
        cached = await downloadOnnxModel();
    }

    const buffer = await cached.arrayBuffer();

    // Crear la sesión de inferencia con ONNX Runtime Web
    onnxSession = await ort.InferenceSession.create(buffer, {
        executionProviders: ["wasm"],  // Usar WebAssembly (compatible con todos los PCs)
    });

    console.log("[IAndes BG] Modelo ONNX cargado y listo");
    return onnxSession;
}

/** Descarga el modelo ONNX y lo guarda en el Cache API del navegador */
async function downloadOnnxModel() {
    const resp = await fetch(ONNX_MODEL_URL);
    if (!resp.ok) throw new Error(`Descarga del modelo ONNX falló: ${resp.status}`);

    const cache = await caches.open(ONNX_CACHE_NAME);
    await cache.put(ONNX_CACHE_KEY, resp.clone());

    console.log("[IAndes BG] Modelo ONNX guardado en caché del navegador");
    return resp;
}


// ---------------------------------------------------------------------------
// ESTADO DEL SISTEMA (para el popup)
// ---------------------------------------------------------------------------

/**
 * Recopila el estado actual del sistema para mostrarlo en el popup.
 * El popup llama a GET_STATUS para saber qué está disponible.
 */
async function getSystemStatus() {
    const ollamaAvailable = (await getOllamaModel()) !== null;
    const cache           = await caches.open(ONNX_CACHE_NAME);
    const onnxCached      = !!(await cache.match(ONNX_CACHE_KEY));

    return {
        onnxCached,               // ¿El modelo ONNX está descargado?
        ollamaAvailable,          // ¿Ollama está corriendo?
        ollamaModel,              // ¿Cuál modelo Ollama usamos?
        recommendedModel: "qwen2.5:3b",  // Recomendación si no hay Ollama
    };
}


// ---------------------------------------------------------------------------
// HEURÍSTICA LOCAL DE TOKENS (igual que en content.js)
// ---------------------------------------------------------------------------

/**
 * Estimación rápida de tokens (usada para calcular estadísticas de ahorro).
 * Es la misma función que está en content.js, duplicada aquí porque el
 * Service Worker no tiene acceso al código de content.js.
 */
function estimateTokens(text) {
    if (!text) return 0;
    try {
        const parts = text.match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu);
        return parts ? parts.length : 0;
    } catch {
        return text.split(/\s+/).filter(Boolean).length;
    }
}


// ---------------------------------------------------------------------------
// IMPORTAR ONNX RUNTIME
// ---------------------------------------------------------------------------

/**
 * ONNX Runtime Web es la librería que ejecuta los modelos .onnx en el navegador.
 * Se importa como un script estático que debe estar en la carpeta lib/ de la extensión.
 *
 * Para obtenerlo:
 *   npm install onnxruntime-web
 *   Copiar node_modules/onnxruntime-web/dist/ort.min.js → lib/ort.min.js
 */
try {
    importScripts("lib/ort.min.js");
    console.log("[IAndes BG] ONNX Runtime Web cargado correctamente");
} catch (e) {
    console.warn("[IAndes BG] ONNX Runtime no disponible (Capa 2 desactivada):", e.message);
    // La Capa 2 quedará deshabilitada, pero el resto del sistema funciona
}

console.log("[IAndes BG] Service Worker v3.0 inicializado");
