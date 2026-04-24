/**
 * =============================================================================
 * IAndes – Content Script v3.0
 * =============================================================================
 *
 * ¿Qué hace este archivo?
 *   Es el script que se inyecta en las páginas de los chats (ChatGPT, Claude,
 *   Gemini, etc.). Se encarga de:
 *
 *   1. DETECTAR en qué chat estás (ChatGPT, Claude, Gemini)
 *   2. ESCUCHAR lo que escribes en el campo de texto
 *   3. CALCULAR estimaciones locales de tokens e impacto ambiental
 *   4. MOSTRAR un pequeño overlay (cuadrito) con las métricas
 *   5. EJECUTAR la Capa 0 y Capa 1 del pipeline de compresión localmente
 *   6. DELEGAR las Capas 2 y 3 al Service Worker (background.js)
 *
 * ¿Por qué detectar el proveedor?
 *   Porque ChatGPT, Claude y Gemini usan tokenizadores distintos.
 *   El mismo texto tiene diferente número de tokens en cada uno.
 *   Le pasamos el proveedor al servidor para que use el método correcto.
 *
 * =============================================================================
 */

// ---------------------------------------------------------------------------
// DETECCIÓN DEL PROVEEDOR (¿en qué chat estamos?)
// ---------------------------------------------------------------------------

/**
 * Lee la URL actual y determina en qué plataforma de chat está el usuario.
 *
 * Retorna un objeto con:
 *   - id:    identificador interno ("chatgpt", "claude", "gemini")
 *   - name:  nombre legible para el usuario
 *   - model: modelo predeterminado de esa plataforma
 */
function detectProvider() {
    const url = window.location.hostname;

    if (url.includes("chat.openai.com") || url.includes("chatgpt.com")) {
        return { id: "chatgpt", name: "ChatGPT",   model: "gpt-4o" };
    }
    if (url.includes("claude.ai")) {
        return { id: "claude",  name: "Claude",    model: "claude-sonnet-4-6" };
    }
    if (url.includes("gemini.google.com")) {
        return { id: "gemini",  name: "Gemini",    model: "gemini-2.0-flash" };
    }

    // Si no reconocemos la URL, usamos ChatGPT/tiktoken como fallback
    // (es el método que funciona sin API key)
    console.warn("[IAndes] Proveedor no reconocido para:", url, "— usando ChatGPT como fallback");
    return { id: "chatgpt", name: "Chat desconocido", model: "gpt-4o" };
}

// Detectar el proveedor una sola vez al cargar la página
const PROVIDER = detectProvider();
console.log(`[IAndes] Proveedor detectado: ${PROVIDER.name} (${PROVIDER.id})`);


// ---------------------------------------------------------------------------
// CONFIGURACIÓN
// ---------------------------------------------------------------------------

const CONFIG = {
    debounceMs:      1500,    // Esperar 1.5s después de que el usuario deja de escribir
    overlayId:       "iandes-overlay",
    // Si true: usar SOLO la heurística local; no intentar Worker ni Service Worker
    // MODIFICADO: cambiar a false para habilitar Web Worker y Service Worker
    localOnlyMode:    false,
};

const IMPROVE_REVIEW_ID = "iandes-improve-review";
const OPTIMIZE_HINT_ID = "iandes-optimize-hint";

// Variable global que guarda el último texto del campo de prompt
let textoTemporal = "";
let lastProcessedPrompt = "";
let lastProcessedAt = 0;
let suppressNextScheduledProcess = false;
let dismissedHintForText = "";
let pendingOptimizeContext = null;
let ignoreInputBlurUntil = 0;
let optimizationTimeoutId = null;

// ---------------------------------------------------------------------------
// WEB WORKER: conteo de tokens (tiktoken en worker o heurística)
// ---------------------------------------------------------------------------
// [FIX-CSP] Variables globales del worker
let tokenWorker = null;
let workerReady = false;
const workerPending = new Map();
let workerReqId = 1;
let tokenWorkerErrorReason = null;

// [FIX-CSP] Inicialización del worker usando Blob URL para evitar CSP
async function initTokenWorker() {
    if (CONFIG.localOnlyMode) {
        console.info('[IAndes] localOnlyMode — skipping token worker');
        return;
    }

    try {
        // [FIX-CSP] Paso 1: Fetch del código del worker
        const workerUrl  = chrome.runtime.getURL('token_worker.js');
        const response   = await fetch(workerUrl);
        if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
        const workerCode = await response.text();

        // [FIX-CSP] Paso 2: Crear Blob URL (sin restricción de origen del sitio host)
        const blob    = new Blob([workerCode], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);

        // [FIX-CSP] Paso 3: Crear Worker desde Blob URL
        tokenWorker = new Worker(blobUrl);

        // [FIX-CSP] Paso 4: Listeners ANTES de revocar la URL
        tokenWorker.addEventListener('message', (ev) => {
            const msg = ev.data || {};
            if (msg.type === 'WORKER_READY') {
                workerReady = true;
                console.info('[IAndes] Token worker listo (blob method)');
                // [FIX-CSP] Revocar la Blob URL cuando ya no se necesita
                URL.revokeObjectURL(blobUrl);
                return;
            }
            if (msg.type === 'WORKER_ERROR') {
                console.error('[IAndes] Worker error:', msg.message, msg.stack || '');
                return;
            }
            if (msg.type === 'COUNT_RESULT' && msg.id) {
                const resolver = workerPending.get(msg.id);
                if (resolver) {
                    workerPending.delete(msg.id);
                    resolver(msg);
                }
            }
        });

        tokenWorker.addEventListener('error', (e) => {
            tokenWorkerErrorReason = String(e.message || e);
            console.warn('[IAndes] Worker runtime error:', tokenWorkerErrorReason);
            tokenWorker = null;
        });
    } catch (e) {
        tokenWorkerErrorReason = String(e && e.message ? e.message : e);
        console.warn('[IAndes] Token worker init failed:', tokenWorkerErrorReason);
        tokenWorker = null;
    }
}

// [FIX-CSP] Invocar inicialización
initTokenWorker();

function countTokensWithWorker(text, model) {
    if (!tokenWorker) {
        // Run heuristic asynchronously to avoid blocking the page (simulate worker)
        return new Promise((resolve) => {
            setTimeout(() => {
                const tokens = estimateTokensLocally(text);
                const source = tokenWorkerErrorReason ? `local_estimate (no worker: ${tokenWorkerErrorReason})` : 'local_estimate';
                resolve({ tokens, source });
            }, 0);
        });
    }

    return new Promise((resolve) => {
        const id = String(workerReqId++);
        const timeout = setTimeout(() => {
            if (workerPending.has(id)) {
                workerPending.delete(id);
                const source = tokenWorkerErrorReason ? `worker_timeout (no worker: ${tokenWorkerErrorReason})` : 'worker_timeout';
                resolve({ tokens: estimateTokensLocally(text), source });
            }
        }, 1200);

        workerPending.set(id, (msg) => {
            clearTimeout(timeout);
            resolve({ tokens: msg.tokens, source: msg.source || 'worker' });
        });

        try {
            tokenWorker.postMessage({ type: 'COUNT_TOKENS', id, text, model, provider: PROVIDER.id });
        } catch (e) {
            workerPending.delete(id);
            clearTimeout(timeout);
            const reason = String(e && e.message ? e.message : e);
            tokenWorkerErrorReason = reason;
            console.warn('[IAndes] tokenWorker.postMessage failed:', reason);
            resolve({ tokens: estimateTokensLocally(text), source: `worker_error (${reason})` });
        }
    });
}


// ---------------------------------------------------------------------------
// ESTIMACIÓN LOCAL DE TOKENS (heurística, sin servidor)
// ---------------------------------------------------------------------------

/**
 * Estima el número de tokens de un texto usando una heurística simple.
 *
 * Divide el texto en palabras y signos de puntuación y los cuenta.
 * NO es el conteo exacto de ningún modelo, pero sirve para dar una
 * respuesta INMEDIATA mientras esperamos al servidor.
 *
 * Error típico: ±15% respecto al conteo real.
 */
function estimateTokensLocally(text) {
    if (!text) return 0;
    try {
        const chars = text.length;
        const letters = (text.match(/\p{L}/gu) || []).length;
        const digits = (text.match(/\d/g) || []).length;
        const symbols = (text.match(/[^\p{L}\d\s]/gu) || []).length;
        const lines = text.split(/\r?\n/).length;
        const avgLineLen = chars / Math.max(1, lines);

        const looksLikeJSON = /\{\s*\".+\"\s*:/s.test(text) || /\"[^\"]+\"\s*:\s*/.test(text);
        const codeIndicators = /\b(function|const|let|var|class|def|import|return)\b/.test(text) || /[{};<>=]/.test(text) || avgLineLen > 80;
        const accented = (text.match(/[\u00C0-\u017F]/g) || []).length;
        const accentedRatio = letters ? accented / letters : 0;

        let factor = 4.0;
        if (looksLikeJSON) factor = 3.0;
        else if (codeIndicators) factor = 3.2;
        else if (accentedRatio > 0.02) factor = 3.8;
        else if (letters / chars > 0.9) factor = 4.2;

        let tokens = chars / factor;
        const numSeq = (text.match(/\d+/g) || []).length;
        tokens += numSeq * 1.2;
        tokens += symbols * 0.6;
        if (avgLineLen < 20 && lines > 6) tokens *= 1.08;

        return Math.max(1, Math.round(tokens));
    } catch (e) {
        return Math.max(1, text.split(/\s+/).filter(Boolean).length);
    }
}

// ---------------------------------------------------------------------------
// ESTIMACIÓN AMBIENTAL LOCAL (sustituye al servidor)
// ---------------------------------------------------------------------------
const WATER_ML_PER_TOKEN = 0.0035;
const CO2_G_PER_TOKEN    = 0.0004;

const MODEL_ENV_SCALE = {
    "gpt-4o":               1.0,
    "gpt-4":                1.8,
    "gpt-3.5-turbo":        0.4,
    "claude-opus-4-6":      1.8,
    "claude-sonnet-4-6":    1.0,
    "claude-haiku-4-5":     0.3,
    "gemini-2.0-flash":     0.4,
    "gemini-1.5-pro":       1.2,
    "gemini-1.5-flash":     0.4,
};

function inferModelScale(model) {
    if (!model) return 1.0;
    const m = model.toLowerCase();
    if (MODEL_ENV_SCALE[m]) return MODEL_ENV_SCALE[m];
    if (m.includes("opus")) return 1.8;
    if (m.includes("haiku")) return 0.3;
    if (m.includes("flash")) return 0.4;
    if (m.includes("mini")) return 0.3;
    return 1.0;
}

function computeEnvironmentalImpactLocal(promptTokens, model) {
    const completion = Math.max(50, Math.ceil(promptTokens * 0.8));
    const total = promptTokens + completion;
    const scale = inferModelScale(model);

    const water_ml = Number((total * WATER_ML_PER_TOKEN * scale).toFixed(4));
    const co2_g    = Number((total * CO2_G_PER_TOKEN * scale).toFixed(6));
    const water_drops = Math.round(water_ml / 0.05);
    const co2_steps   = Number((co2_g / 0.12).toFixed(2));
    const co2_led_secs = Math.round((co2_g / 0.000833) * 10) / 10;

    return {
        completion_est: completion,
        tokens_total:   total,
        water_ml,
        water_drops,
        co2_g,
        co2_steps,
        co2_led_secs,
        model_scale: scale,
    };
}


// ---------------------------------------------------------------------------
// COMPATIBILIDAD LEGACY (SIN SERVIDOR)
// ---------------------------------------------------------------------------

/**
 * Función heredada para compatibilidad.
 * En la versión actual no se usa servidor local; retornamos null.
 *
 * @param {string} text     - El texto del prompt
 * @param {string} provider - "chatgpt", "claude" o "gemini"
 * @param {string} model    - El modelo específico
 */
// Antes este cliente llamaba a un servidor local para conteos exactos.
// Ahora usamos solo estimaciones locales (heurística ±15%).
async function fetchTokenMetrics() {
    // Función mantenida por compatibilidad, pero ya no hace fetch.
    return null;
}


// ---------------------------------------------------------------------------
// CAPA 1 -FILTRO LÉXICO DETERMINISTA
// ---------------------------------------------------------------------------
// Esta capa elimina "ruido conversacional" del prompt: saludos, despedidas,
// frases de cortesía, etc. Se ejecuta localmente (sin servidor, sin internet).

/** Reglas de la Capa 1 (explicitas y trazables) */
const LAYER1_RULES = {
    // Señales rápidas para clasificación (Capa 0)
    positional: {
        start: /^(?:hola|hey|ey|saludos|buen(?:os?|as?)\s+d[ií]as|buen(?:os?|as?)\s+tardes|buen(?:os?|as?)\s+noches|estimad[oa]|espero\s+que\s+est[eé]s?\s+bien)[,.:;\-\s]*/i,
        end:   /[\s,.;:!?-]*(?:gracias(?:\s+de\s+antemano)?|muchas\s+gracias|te\s+lo\s+agradezco|quedo\s+atent[oa])[\s,.;:!?-]*$/i,
    },

    // Catálogo detallado para aplicar y explicar reglas
    catalog: [
        { id: "start_greeting", label: "Saludo inicial", scope: "inicio", regex: /^(?:hola|hey|ey|saludos|buen(?:os?|as?)\s+d[ií]as|buen(?:os?|as?)\s+tardes|buen(?:os?|as?)\s+noches|estimad[oa])[,.:;\-\s]*/i },
        { id: "start_wellbeing", label: "Frase de cortesía inicial", scope: "inicio", regex: /^(?:espero\s+que\s+est[eé]s?\s+bien|c[oó]mo\s+est[aá]s)[,.:;\-\s]*/i },
        { id: "end_thanks", label: "Agradecimiento final", scope: "final", regex: /[\s,.;:!?-]*(?:gracias(?:\s+de\s+antemano)?|muchas\s+gracias|te\s+lo\s+agradezco|quedo\s+atent[oa])[\s,.;:!?-]*$/i },

        { id: "ask_permission", label: "Fórmula de ruego", scope: "global", regex: /\b(?:quisiera|me\s+gustar[ií]a|te\s+quer[ií]a\s+pedir|te\s+pido\s+que|si\s+no\s+es\s+molestia|me\s+har[ií]as\s+el\s+favor\s+de|te\s+agradecer[ií]a\s+si)\b/gi },
        { id: "please", label: "Cortesía explícita", scope: "global", regex: /\b(?:por\s+favor|porfa|si\s+puedes|si\s+es\s+posible)\b/gi },
        { id: "assist_request", label: "Solicitud indirecta", scope: "global", regex: /\b(?:podr[ií]as?|puedes?)\s+(?:ayudarme|apoyarme|explicarme|resumirme|darme)\b/gi },
        { id: "need_help", label: "Petición redundante de ayuda", scope: "global", regex: /\b(?:necesito|quiero)\s+que\s+me\s+(?:ayudes|expliques|digas|cuentes|resumas)\b/gi },
        { id: "verbosity_request", label: "Pedida de verbosidad", scope: "global", regex: /\bde\s+forma\s+(?:muy\s+)?(?:detallada|exhaustiva|completa|clara\s+y\s+sencilla)\b/gi },
        { id: "transition_filler", label: "Muletilla de transición", scope: "global", regex: /\b(?:a\s+continuaci[oó]n|antes\s+que\s+nada|primero\s+que\s+todo)\b/gi },
    ],
};

function getLayer1RulesCatalog() {
    return LAYER1_RULES.catalog.map(rule => ({
        id: rule.id,
        label: rule.label,
        scope: rule.scope,
        pattern: String(rule.regex),
    }));
}

/**
 * Aplica el filtro léxico (Capa 1) al texto.
 *
 * IMPORTANTE: "Un falso negativo (dejar basura) es tolerable.
 *              Un falso positivo (borrar contenido útil) es el error que importa."
 * Cuando haya duda, NO eliminar.
 */
function applyLayer1(text) {
    return applyLayer1Detailed(text).text;
}

function applyLayer1Detailed(text) {
    let result = String(text || "");
    const matchedRules = [];
    const matchedFragments = [];
    const applied = new Set();

    function applyRule(rule) {
        const next = result.replace(rule.regex, (match) => {
            const fragment = String(match || "").trim();
            if (fragment) matchedFragments.push(fragment);
            return "";
        });

        if (next !== result) {
            result = next;
            if (!applied.has(rule.id)) {
                applied.add(rule.id);
                matchedRules.push({ id: rule.id, label: rule.label, scope: rule.scope });
            }
        }
    }

    const looksLikeCode = /```[\s\S]*?```|^\s{4}[\w]|^\t[\w]/m.test(text) ||
        /\b(function|const|let|var|class|def |import |#include)\b/.test(text);

    for (const rule of LAYER1_RULES.catalog) {
        // Si parece código, saltear reglas globales
        if (looksLikeCode && rule.scope === 'global') continue;
        applyRule(rule);
    }

    result = result
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/^\s*[,.;:!?-]+\s*/g, "")
        .trim();

    const savedTokens = Math.max(0, estimateTokensLocally(text) - estimateTokensLocally(result));
    const uniqueFragments = [...new Set(matchedFragments)].slice(0, 5);

    return {
        text: result,
        savedTokens,
        matchedRules,
        matchedFragments: uniqueFragments,
    };
}


// ---------------------------------------------------------------------------
// CAPA 0 — Router / Clasificador de intención
// ---------------------------------------------------------------------------

/**
 * Analiza el prompt y decide qué capas de optimización activar.
 *
 * Esto permite no hacer trabajo innecesario:
 *   - Un prompt corto y concreto no necesita la Capa 1 (no hay cortesía).
 *   - Un prompt ya óptimo no necesita nada.
 *
 * Retorna un objeto con:
 *   - profile: nombre del perfil detectado (para debugging)
 *   - layers:  array con las capas a activar [1, 2, 3]
 */
function classifyPrompt(text) {
    const words       = text.trim().split(/\s+/).filter(Boolean);
    const wordCount   = words.length;

    // Señal: ¿hay cortesía en los extremos del texto?
    const head        = text.slice(0, 200);
    const tail        = text.slice(-160);
    const hasCourtesy = LAYER1_RULES.positional.start.test(head) ||
                        LAYER1_RULES.positional.end.test(tail)   ||
                        /\bpor\s+favor\b/i.test(text)           ||
                        /\bgracias\b/i.test(tail);

    // Señal: ratio de palabras funcionales (artículos, preposiciones, etc.)
    // Un ratio alto indica más relleno, menos contenido
    const functionalWords = words.filter(w =>
        /^(el|la|los|las|un|una|de|del|en|y|a|que|se|es|por|para|con|su|al|lo)$/i.test(w)
    ).length;
    const functionalRatio = functionalWords / wordCount;

    // Señal: ¿tiene estructura (saltos de línea, puntuación)?
    const hasStructure = /\n/.test(text) || (text.match(/[.?!]/g) || []).length > 2;

    // ---- Clasificación ----

    if (wordCount < 15 && hasCourtesy) {
        // Prompt corto CON cortesía → Capa 1 siempre, Capa 3 si hay Ollama para mejorar
        return { profile: "short_with_courtesy", layers: [1, 3] };
    }
    if (wordCount < 15 && !hasCourtesy) {
        // Prompt corto y directo → solo necesita reformulación (Capa 3)
        return { profile: "short_vague", layers: [3] };
    }
    if (wordCount >= 15 && hasCourtesy) {
        // Prompt largo con cortesía → pipeline completo independiente del ratio funcional
        return { profile: "long_padded", layers: [1, 2, 3] };
    }
    if (wordCount >= 15 && hasStructure && !hasCourtesy) {
        // Prompt largo y técnico → solo filtro + deduplicación
        return { profile: "long_technical", layers: [1, 2] };
    }
    if (wordCount >= 15 && !hasCourtesy && functionalRatio <= 0.25) {
        // Prompt ya denso y concreto → no tocar
        return { profile: "already_optimal", layers: [] };
    }

    // Caso general
    return { profile: "generic", layers: [1, 2, 3] };
}


// ---------------------------------------------------------------------------
// OVERLAY DE MÉTRICAS (el cuadrito que aparece en la esquina)
// ---------------------------------------------------------------------------

/**
 * Obtiene el elemento del overlay o lo crea si no existe todavía.
 *
 * El overlay es un div que se inyecta directamente en el DOM de la página
 * del chat. Está fijado en la esquina inferior derecha y no interfiere
 * con la interfaz del chat.
 */
function getOrCreateOverlay() {
    let overlay = document.getElementById(CONFIG.overlayId);
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = CONFIG.overlayId;

        // Estilos inline para que el overlay sea visible e independiente
        // del CSS de la página del chat
        overlay.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 2147483647;
            background: rgba(10, 12, 20, 0.93);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(0, 230, 150, 0.22);
            border-radius: 12px;
            padding: 10px 14px;
            font-family: 'SF Mono', 'Fira Code', monospace;
            font-size: 11px;
            color: #e0ffe8;
            line-height: 1.75;
            min-width: 220px;
            box-shadow: 0 4px 24px rgba(0,0,0,0.5);
            transition: opacity 0.3s ease;
            pointer-events: none;
            user-select: none;
        `;
        document.body.appendChild(overlay);
    }
    return overlay;
}

function openPopupFromOverlay() {
    const popupUrl = chrome.runtime.getURL("popup.html");
    window.open(popupUrl, "_blank", "noopener,noreferrer");
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function renderOverlayError(message) {
    const overlay = getOrCreateOverlay();
    overlay.style.pointerEvents = "auto";
    overlay.style.cursor = "pointer";
    overlay.style.userSelect = "auto";
    overlay.title = "Abrir popup";
    overlay.onclick = openPopupFromOverlay;
    overlay.innerHTML = `
        <div style="color:#ffb347;font-weight:700;letter-spacing:0.05em;margin-bottom:5px;">
            ▸ IAndes
        </div>
        <div style="color:#e0ffe8;line-height:1.55;">
            ${escapeHtml(message)}
        </div>
        <div style="color:#6b8a78;font-size:9px;margin-top:6px;">
            Ver popup →
        </div>
    `;
    overlay.style.opacity = "1";
}

function renderOverlaySuccess(message) {
    const overlay = getOrCreateOverlay();
    overlay.onclick = null;
    overlay.title = "";
    overlay.style.pointerEvents = "none";
    overlay.style.cursor = "default";
    overlay.style.userSelect = "none";
    overlay.innerHTML = `
        <div style="color:#00e696;font-weight:700;letter-spacing:0.05em;margin-bottom:5px;">
            ▸ IAndes
        </div>
        <div style="color:#e0ffe8;line-height:1.55;">
            ${escapeHtml(message)}
        </div>
    `;
    overlay.style.opacity = "1";
}

function renderOverlayInfo(message) {
    const overlay = getOrCreateOverlay();
    overlay.onclick = null;
    overlay.title = "";
    overlay.style.pointerEvents = "none";
    overlay.style.cursor = "default";
    overlay.style.userSelect = "none";
    overlay.innerHTML = `
        <div style="color:#4dabf7;font-weight:700;letter-spacing:0.05em;margin-bottom:5px;">
            ▸ IAndes
        </div>
        <div style="color:#e0ffe8;line-height:1.55;">
            ${escapeHtml(message)}
        </div>
    `;
    overlay.style.opacity = "1";
}

/**
 * Actualiza el contenido del overlay con los datos de métricas.
 *
 * @param {object} data - Objeto con tokens, water_ml, co2_g, etc.
 */
function renderOverlay(data) {
    const overlay = getOrCreateOverlay();
    overlay.onclick = null;
    overlay.title = "";
    overlay.style.pointerEvents = "none";
    overlay.style.cursor = "default";
    overlay.style.userSelect = "none";

    // Usar "–" si un valor no está disponible
    const tokens     = data.tokens      ?? "–";
    const waterMl    = data.water_ml    ?? "–";
    const waterDrops = data.water_drops ?? "–";
    const co2G       = data.co2_g       ?? "–";
    const co2Steps   = data.co2_steps   ?? "–";
    const source     = data.source      ?? "estimado";

    // El nombre del proveedor para mostrar en el overlay
    const providerName = {
        chatgpt: "ChatGPT",
        claude:  "Claude",
        gemini:  "Gemini",
    }[data.provider] || PROVIDER.name;

    overlay.innerHTML = `
        <div style="color:#00e696;font-weight:700;letter-spacing:0.05em;margin-bottom:5px;">
            ▸ IAndes · ${providerName}
        </div>
        <div>🔢 <b>${tokens}</b> tokens
            <span style="opacity:0.45;font-size:9px;">${source}</span>
        </div>
        <div>💧 <b>${waterMl} ml</b> · ${waterDrops} gotas</div>
        <div>🌿 <b>${co2G} g</b> CO₂ · ~${co2Steps} pasos</div>
    `;
    overlay.style.opacity = "1";
}

/** Oculta el overlay (cuando el campo de texto está vacío) */
function hideOverlay() {
    const overlay = document.getElementById(CONFIG.overlayId);
    if (overlay) {
        overlay.style.opacity = "0";
        overlay.style.pointerEvents = "none";
        overlay.style.cursor = "default";
        overlay.onclick = null;
        overlay.title = "";
    }
}

function markIgnoreInputBlur(ms = 300) {
    ignoreInputBlurUntil = Date.now() + ms;
}

function isIAndesUiElement(node) {
    if (!node || typeof node.closest !== "function") return false;
    return Boolean(
        node.closest(`#${IMPROVE_REVIEW_ID}`) ||
        node.closest(`#${OPTIMIZE_HINT_ID}`) ||
        node.closest(`#${CONFIG.overlayId}`)
    );
}

function normalizePromptKey(text) {
    return String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function readCurrentPromptText(preferredEl = null) {
    if (preferredEl) {
        try {
            return preferredEl.value !== undefined
                ? preferredEl.value
                : (preferredEl.innerText || preferredEl.textContent || "");
        } catch {}
    }

    const inputs = getChatInputs();
    const targetEl = inputs.find(el => el === document.activeElement) || inputs[0];
    if (!targetEl) return "";
    return targetEl.value !== undefined
        ? targetEl.value
        : (targetEl.innerText || targetEl.textContent || "");
}

function getOrCreateOptimizeHint() {
    let hint = document.getElementById(OPTIMIZE_HINT_ID);
    if (!hint) {
        hint = document.createElement("div");
        hint.id = OPTIMIZE_HINT_ID;
        hint.style.cssText = `
            position: fixed;
            left: 0;
            top: 0;
            z-index: 2147483646;
            max-width: min(340px, calc(100vw - 24px));
            background: rgba(11, 16, 26, 0.96);
            border: 1px solid rgba(0, 230, 150, 0.26);
            border-radius: 8px;
            box-shadow: 0 6px 20px rgba(0,0,0,0.35);
            backdrop-filter: blur(8px);
            color: #dff5e8;
            font-family: 'SF Mono', 'Fira Code', monospace;
            font-size: 10px;
            line-height: 1.35;
            padding: 7px 8px;
            pointer-events: auto;
        `;
        hint.addEventListener("pointerdown", () => markIgnoreInputBlur(), true);
        hint.addEventListener("mousedown", () => markIgnoreInputBlur(), true);
        document.body.appendChild(hint);
    }
    return hint;
}

function positionOptimizeHintNearInput(hint, anchorEl) {
    if (!hint || !anchorEl) return;
    try {
        const rect       = anchorEl.getBoundingClientRect();
        const hintHeight = hint.offsetHeight || 80;
        const hintWidth  = hint.offsetWidth  || 300;
        const margin = 8;

        // Preferir: derecha del input → izquierda del input → debajo del input → arriba del input
        let left = rect.right + margin;
        let top  = rect.top - hintHeight - margin;

        if (left + hintWidth > window.innerWidth - 8) {
            left = Math.max(8, rect.left - hintWidth - margin);
        }
        if (top < 8) {
            top = rect.bottom + margin;
        }

        top  = Math.max(8, Math.min(top,  window.innerHeight - hintHeight - 8));
        left = Math.max(8, Math.min(left, window.innerWidth  - hintWidth  - 8));

        hint.style.top      = `${Math.round(top)}px`;
        hint.style.left     = `${Math.round(left)}px`;
        hint.style.opacity  = "1";
        hint.style.display  = "block";
    } catch (e) {
        // Fallback centrado
        hint.style.top      = "50%";
        hint.style.left     = "50%";
        hint.style.transform = "translate(-50%, -50%)";
        hint.style.opacity  = "1";
        hint.style.display  = "block";
    }
}

function hideOptimizeHint() {
    pendingOptimizeContext = null;
    const hint = document.getElementById(OPTIMIZE_HINT_ID);
    if (hint) hint.remove();
}

function showOptimizeHint({ text, mode, sourceElement }) {
    const normalized = normalizePromptKey(text);
    if (!normalized || dismissedHintForText === normalized) return;

    const actionVerb   = mode === "improve" ? "mejorar" : "comprimir";
    const actionQuestion = mode === "improve" ? "¿Mejorar?" : "¿Comprimir?";
    pendingOptimizeContext = { text, mode, sourceElement: sourceElement || null, normalized };

    // Limpiar hint previo si existe
    const existing = document.getElementById(OPTIMIZE_HINT_ID);
    if (existing) existing.remove();

    // Crear hint con contenido HTML completo desde el inicio
    const hint = document.createElement("div");
    hint.id = OPTIMIZE_HINT_ID;
    hint.style.cssText = `
        position: fixed;
        left: -9999px;
        top: -9999px;
        z-index: 2147483646;
        max-width: min(340px, calc(100vw - 24px));
        background: rgba(11, 16, 26, 0.97);
        border: 1px solid rgba(0, 230, 150, 0.3);
        border-radius: 8px;
        box-shadow: 0 6px 20px rgba(0,0,0,0.4);
        backdrop-filter: blur(8px);
        color: #dff5e8;
        font-family: 'SF Mono', 'Fira Code', monospace;
        font-size: 10px;
        line-height: 1.35;
        padding: 8px 10px;
        pointer-events: auto;
        white-space: normal;
    `;

    // Construir HTML completo y establecerlo ANTES de appendChild
    // para que los elementos estén listos cuando se posicionen
    hint.innerHTML = `
        <div style="color:#e7fff0;margin-bottom:5px;">
            (!)&nbsp;Prompt ${escapeHtml(actionVerb)}:
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
            <span style="color:#9bc6ae;">${escapeHtml(actionQuestion)}</span>
            <button id="iandes-hint-yes"
                    style="border:1px solid rgba(0,230,150,0.58);background:rgba(0,230,150,0.12);color:#00e696;border-radius:6px;padding:3px 10px;cursor:pointer;font-size:10px;"
                    data-action="yes">si</button>
            <button id="iandes-hint-no"
                    style="border:1px solid rgba(255,255,255,0.2);background:transparent;color:#d8e8df;border-radius:6px;padding:3px 10px;cursor:pointer;font-size:10px;"
                    data-action="no">no</button>
        </div>
    `;

    // Solo ahora appendChild — el DOM interno ya está listo
    document.body.appendChild(hint);

    // Exponer handlers en window ANTES de que se haga clic
    window.__iandes_hint_yes_fn = () => {
        const ctx = pendingOptimizeContext;
        const currentText = readCurrentPromptText(ctx?.sourceElement || null);
        dismissedHintForText = ctx?.normalized || normalizePromptKey(currentText);
        hint.remove();
        pendingOptimizeContext = null;
        Promise.resolve(processPrompt(currentText, {
            autoApply: true,
            force: true,
            sourceElement: ctx?.sourceElement || null,
        })).catch(err => console.warn("[IAndes] processPrompt failed:", err));
    };

    window.__iandes_hint_no_fn = () => {
        dismissedHintForText = normalized;
        hint.remove();
        pendingOptimizeContext = null;
    };

    // Delegar click al body (más confiable que onclick inline)
    hint.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-action]");
        if (!btn) return;
        const action = btn.getAttribute("data-action");
        if (action === "yes") window.__iandes_hint_yes_fn();
        if (action === "no")  window.__iandes_hint_no_fn();
    });

    // Posicionar DESPUÉS de que el DOM interno existe y tiene dimensiones
    const anchor = sourceElement || document.activeElement || document.querySelector("textarea");
    positionOptimizeHintNearInput(hint, anchor);
}

// [FIX-CONTEXT] Mostrar aviso en overlay cuando el content script quedó invalidado.
function showContextInvalidatedOverlay() {
    const overlay = getOrCreateOverlay();
    overlay.style.pointerEvents = "none";
    overlay.style.cursor = "default";
    overlay.onclick = null;
    overlay.title = "";
    overlay.innerHTML = `
        <div style="color:#ff4d6d;font-weight:700;margin-bottom:6px;">
            ⚠ IAndes actualizado
        </div>
        <div style="font-size:10px;line-height:1.4;">
            Recarga esta página (F5) para usar la extensión.
        </div>
    `;
    overlay.style.opacity = "1";
}

function getOrCreateImproveReviewPanel() {
    let panel = document.getElementById(IMPROVE_REVIEW_ID);
    if (!panel) {
        panel = document.createElement("div");
        panel.id = IMPROVE_REVIEW_ID;
        panel.style.cssText = `
            position: fixed;
            right: 20px;
            bottom: 20px;
            z-index: 2147483647;
            width: min(560px, calc(100vw - 32px));
            max-height: min(70vh, 680px);
            overflow: auto;
            background: rgba(8, 12, 22, 0.98);
            border: 1px solid rgba(0, 230, 150, 0.26);
            border-radius: 14px;
            box-shadow: 0 8px 40px rgba(0, 0, 0, 0.55);
            backdrop-filter: blur(10px);
            color: #e7fff0;
            font-family: 'SF Mono', 'Fira Code', monospace;
            font-size: 11px;
            padding: 12px;
        `;
        panel.addEventListener("pointerdown", () => markIgnoreInputBlur(), true);
        panel.addEventListener("mousedown", () => markIgnoreInputBlur(), true);
        document.body.appendChild(panel);
    }
    return panel;
}

function hideImproveReviewPanel() {
    const panel = document.getElementById(IMPROVE_REVIEW_ID);
    if (panel) panel.remove();
}

function buildImproveDiffPreview(originalText, improvedText) {
    const toLines = (text) => String(text || "")
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    const normalize = (line) => line.toLowerCase().replace(/\s+/g, " ").trim();
    const originalSet = new Set(toLines(originalText).map(normalize));
    const improvedLines = toLines(improvedText);
    const decorated = improvedLines.map(line => {
        const marker = originalSet.has(normalize(line)) ? "   " : "[+]";
        return `${marker} ${line}`;
    });

    if (decorated.length > 14) {
        return `${decorated.slice(0, 14).join("\n")}\n...`;
    }
    return decorated.join("\n");
}

function persistSessionStats(stats, mode = "compress") {
    if (!stats || typeof stats.savedTokens !== "number") return;
    if (stats.savedTokens <= 0) return;

    try {
        chrome.storage.local.get(["iandesSession"], (result) => {
            if (chrome.runtime.lastError) return;

            const current = result?.iandesSession || {
                savedTokensTotal: 0,
                optimizations: 0,
                totalPct: 0,
                avgPct: 0,
                lastMode: "compress",
            };

            const next = {
                ...current,
                savedTokensTotal: Number(current.savedTokensTotal || 0) + stats.savedTokens,
                optimizations: Number(current.optimizations || 0) + 1,
                totalPct: Number(current.totalPct || 0) + (Number.isFinite(stats.savedPct) ? stats.savedPct : 0),
                lastMode: mode,
                updatedAt: Date.now(),
            };

            next.avgPct = next.optimizations > 0
                ? Math.round(next.totalPct / next.optimizations)
                : 0;

            chrome.storage.local.set({ iandesSession: next });
        });
    } catch {}
}

function renderImproveReviewPanel(originalText, improvedText, stats) {
    const panel = getOrCreateImproveReviewPanel();
    const diffPreview = buildImproveDiffPreview(originalText, improvedText);
    const finalTokens = Number.isFinite(stats?.originalTokens) && Number.isFinite(stats?.savedTokens)
        ? stats.originalTokens - stats.savedTokens
        : null;

    const tokenDelta = Number.isFinite(stats?.savedTokens)
        ? -stats.savedTokens
        : null;
    const deltaLabel = tokenDelta == null
        ? "n/d"
        : (tokenDelta > 0 ? `+${tokenDelta}` : `${tokenDelta}`);

    panel.innerHTML = `
        <div style="color:#00e696;font-weight:700;letter-spacing:.05em;margin-bottom:8px;">
            ▸ IAndes · Revisión de mejora
        </div>
        <div style="color:#a8cbb8;font-size:10px;line-height:1.5;margin-bottom:8px;">
            Verifica los cambios antes de reemplazar el prompt.
        </div>
        <div style="display:grid;grid-template-columns:1fr;gap:8px;">
            <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:8px;">
                <div style="font-size:10px;color:#8ba99a;margin-bottom:4px;">Vista previa del diff</div>
                <pre style="white-space:pre-wrap;word-break:break-word;margin:0;line-height:1.45;color:#e7fff0;">${escapeHtml(diffPreview || "(sin diferencias detectables)")}</pre>
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;color:#9bc6ae;font-size:10px;">
                <span>Original: <b style="color:#dff5e8;">${Number.isFinite(stats?.originalTokens) ? stats.originalTokens : "n/d"}</b> tok</span>
                <span>Final: <b style="color:#dff5e8;">${finalTokens ?? "n/d"}</b> tok</span>
                <span>Delta: <b style="color:${tokenDelta > 0 ? "#ffd166" : "#00e696"};">${deltaLabel}</b> tok</span>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button id="iandes-review-discard" style="border:1px solid rgba(255,255,255,0.22);background:transparent;color:#d8e8df;border-radius:8px;padding:6px 10px;cursor:pointer;">Descartar</button>
                <button id="iandes-review-apply" style="border:1px solid rgba(0,230,150,0.6);background:rgba(0,230,150,0.12);color:#00e696;border-radius:8px;padding:6px 10px;cursor:pointer;">Aceptar y reemplazar</button>
            </div>
        </div>
    `;

    const applyBtn = panel.querySelector("#iandes-review-apply");
    const discardBtn = panel.querySelector("#iandes-review-discard");

    applyBtn?.addEventListener("click", () => {
        hideImproveReviewPanel();
        injectOptimizedPrompt(improvedText, stats, "improve");
        renderOverlaySuccess("Mejora aplicada. Puedes seguir editando o enviar.");
    });

    discardBtn?.addEventListener("click", () => {
        hideImproveReviewPanel();
        if (window.__iandes) {
            renderOverlay(window.__iandes);
        } else {
            hideOverlay();
        }
    });
}

function isImproveResultMessage(msg) {
    if (msg?.mode === "improve") return true;
    const layers = Array.isArray(msg?.stats?.layers) ? msg.stats.layers : [];
    return layers.includes("layer1m") || layers.includes("layer2m");
}


// ---------------------------------------------------------------------------
// LÓGICA PRINCIPAL: procesamiento del prompt
// ---------------------------------------------------------------------------

/**
 * Función principal que se llama cada vez que el usuario deja de escribir.
 *
 * Flujo:
 *   1. Mostrar estimación local inmediata
 *   2. Refinar conteo con Worker (si disponible)
 *   3. Clasificar el prompt (Capa 0)
 *   4. Analizar filtro léxico (Capa 1) y sugerir optimización
 *   5. Solo si el usuario confirma, aplicar cambios y delegar Capas 2/3
 * 
 * [FASE 4] Leer el modo una sola vez y enviarlo con el request al background.
 */
async function processPrompt(text, options = {}) {
    const autoApply = options.autoApply === true;
    const force = options.force === true;
    const sourceElement = options.sourceElement || null;

    if (!text || !text.trim()) {
        hideOverlay();
        hideImproveReviewPanel();
        hideOptimizeHint();
        return;
    }

    hideImproveReviewPanel();

    // Evitar procesar varias veces el mismo texto en una ventana corta.
    const normalizedText = text.trim();
    if (dismissedHintForText && dismissedHintForText !== normalizePromptKey(normalizedText)) {
        dismissedHintForText = "";
    }
    const now = Date.now();
    if (!force && normalizedText === lastProcessedPrompt && now - lastProcessedAt < 1200) {
        return;
    }
    lastProcessedPrompt = normalizedText;
    lastProcessedAt = now;

    // --- PASO 1: Mostrar estimación inmediata mientras el servidor responde ---
    const estimatedTokens = estimateTokensLocally(text);
    // Calcular métricas locales definitivas (sin servidor)
    const impact = computeEnvironmentalImpactLocal(estimatedTokens, PROVIDER.model);
    renderOverlay({
        tokens:   estimatedTokens,
        source:   CONFIG.localOnlyMode ? 'local_only' : 'local_estimate',
        provider: PROVIDER.id,
        completion_est: impact.completion_est,
        tokens_total:   impact.tokens_total,
        water_ml:    impact.water_ml,
        water_drops: impact.water_drops,
        co2_g:       impact.co2_g,
        co2_steps:   impact.co2_steps,
    });

    // Guardar en window para que el popup y devtools puedan acceder
    try {
        window.__iandes = {
            ...(window.__iandes || {}),
            ...impact,
            text,
            provider: PROVIDER.id,
            model: PROVIDER.model,
            tokens: estimatedTokens,
            source: CONFIG.localOnlyMode ? 'local_only' : 'local_estimate',
        };
    } catch {}

    // Si no estamos en modo localOnly, pedir al Worker un conteo más preciso
    if (!CONFIG.localOnlyMode) {
        try {
            countTokensWithWorker(text, PROVIDER.model).then(({ tokens: workerTokens, source }) => {
                if (typeof workerTokens === 'number' && workerTokens >= 0) {
                    const impact2 = computeEnvironmentalImpactLocal(workerTokens, PROVIDER.model);
                    renderOverlay({
                        tokens: workerTokens,
                        source: source || 'worker',
                        provider: PROVIDER.id,
                        completion_est: impact2.completion_est,
                        tokens_total:   impact2.tokens_total,
                        water_ml:    impact2.water_ml,
                        water_drops: impact2.water_drops,
                        co2_g:       impact2.co2_g,
                        co2_steps:   impact2.co2_steps,
                    });
                    try {
                        window.__iandes = {
                            ...(window.__iandes || {}),
                            ...impact2,
                            text,
                            provider: PROVIDER.id,
                            model: PROVIDER.model,
                            tokens: workerTokens,
                            source: source || 'worker',
                        };
                    } catch {}
                }
            }).catch(() => {});
        } catch {}
    }

    // --- PASO 3: Clasificar el prompt (Capa 0) ---
    const classification = classifyPrompt(text);
    console.log(`[IAndes] Perfil: ${classification.profile} → capas: ${classification.layers}`);

    // [FASE 4] Leer el modo de almacenamiento y ajustar el pipeline sin cambiarlo a mitad del proceso.
    let finalLayers = classification.layers;
    let mode = 'compress';
    try {
        // [FIX-CONTEXT] Verificar que el contexto de extensión siga activo.
        if (!chrome.runtime?.id) {
            throw new Error('Extension context invalidated');
        }

        const storage = await new Promise((resolve, reject) => {
            chrome.storage.local.get(['mode'], (result) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(result || {});
                }
            });
        });
        mode = storage.mode || 'compress';

        if (mode === 'improve') {
            finalLayers = finalLayers.filter(layer => layer !== 1);
            if (!finalLayers.includes(3)) {
                finalLayers = [...finalLayers, 3];
            }
        } else if (classification.layers.length === 0) {
            // Si el prompt ya es óptimo y modo es 'compress', no hacer nada.
            hideOptimizeHint();
            console.log("[IAndes] Prompt ya óptimo, sin transformación");
            return;
        }
    } catch (err) {
        const message = String(err?.message || err || '');
        if (message.toLowerCase().includes('invalidated')) {
            console.warn('[IAndes] Extension recargada — por favor recarga la página para usar IAndes');
            showContextInvalidatedOverlay();
            return;
        }
        console.warn("[IAndes] No se pudo leer modo desde storage:", err);
    }

    // Si el prompt ya es óptimo y modo es 'compress', no hacer nada
    if (finalLayers.length === 0) {
        hideOptimizeHint();
        console.log("[IAndes] Prompt ya óptimo, sin transformación");
        return;
    }

    // --- PASO 4: Aplicar Capa 1 (filtro léxico) si está en el pipeline ---
    let optimizedText = text;
    let layer1Details = {
        text,
        savedTokens: 0,
        matchedRules: [],
        matchedFragments: [],
    };

    if (mode !== 'improve' && finalLayers.includes(1)) {
        layer1Details = applyLayer1Detailed(text);
        optimizedText = layer1Details.text;
        // NUEVO: si Capa 1 dejó el texto vacío, no hacer nada
        if (!optimizedText.trim()) {
            hideOptimizeHint();
            console.log("[IAndes] Capa 1 dejó el texto vacío — abortando optimización");
            return;
        }
        if (layer1Details.savedTokens > 0) {
            const labels = layer1Details.matchedRules.map(r => r.label).slice(0, 3).join(", ");
            console.log(`[IAndes] Capa 1: eliminadas ~${layer1Details.savedTokens} tokens | reglas: ${labels || "n/d"}`);
        }
    }

    try {
        window.__iandes = {
            ...(window.__iandes || {}),
            layer1_debug: {
                saved_tokens: layer1Details.savedTokens,
                matched_rules: layer1Details.matchedRules,
                matched_fragments: layer1Details.matchedFragments,
                rules_catalog: getLayer1RulesCatalog(),
            },
        };
    } catch {}

    // Modo no invasivo: al tipear solo sugerimos, no reemplazamos automáticamente.
    if (!autoApply) {
        // Umbral: mostrar hint si hay ahorro de al menos 3 tokens (1 palabra de cortesía)
        // o si el modo es 'improve' (siempre sugerir mejora)
        if (mode === 'improve' || layer1Details.savedTokens >= 3) {
            showOptimizeHint({
                text,
                mode,
                sourceElement,
            });
        } else {
            hideOptimizeHint();
        }
        return;
    }

    hideOptimizeHint();

    // En ejecución manual, aplicar Capa 1 de inmediato para que el usuario vea el cambio.
    if (mode !== 'improve' && finalLayers.includes(1) && optimizedText.trim() !== text.trim()) {
        injectOptimizedPrompt(optimizedText, null, mode);
    }

    // --- PASO 5: Delegar Capas 2+3 al Service Worker ---
    const shouldDelegate = finalLayers.includes(2) || finalLayers.includes(3);
    if (shouldDelegate) {
        if (CONFIG.localOnlyMode) {
            console.info('[IAndes] localOnlyMode: no delegando Capas 2+3 al Service Worker');
        } else {
            try {
                // [FIX-CONTEXT] Verificar que el contexto siga activo antes de enviar mensaje.
                if (!chrome.runtime?.id) {
                    throw new Error('Extension context invalidated');
                }

                renderOverlayInfo("Procesando optimización con IA avanzada... ⏳");

                // Actualizar classification.layers con el valor final
                const updatedClassification = { ...classification, layers: finalLayers };
                
                clearTimeout(optimizationTimeoutId);
                optimizationTimeoutId = setTimeout(() => {
                    optimizationTimeoutId = null;
                    renderOverlayError("Pipeline sin respuesta. Revisa si Ollama está activo.");
                }, 20000);

                chrome.runtime.sendMessage(
                    {
                        type:           "OPTIMIZE_PROMPT",
                        text:           optimizedText,
                        originalText:   text,
                        classification: updatedClassification,
                        mode,
                        provider:       PROVIDER.id,  // El SW también necesita saber el proveedor
                        layer1Stats:    layer1Details.savedTokens > 0 ? {
                            savedTokens: layer1Details.savedTokens,
                            matchedRules: layer1Details.matchedRules
                        } : null
                    },
                    () => {
                        if (chrome.runtime.lastError) {
                            const msg = chrome.runtime.lastError.message || '';
                            if (msg.toLowerCase().includes('invalidated')) {
                                console.warn('[IAndes] Extension recargada — recarga la página para continuar');
                                showContextInvalidatedOverlay();
                                return;
                            }
                            console.info('[IAndes] Service Worker no disponible para Capas 2+3:', msg);
                        }
                    }
                );
            } catch (e) {
                const message = String(e?.message || e || '');
                if (message.toLowerCase().includes('invalidated')) {
                    console.warn('[IAndes] Extension recargada — recarga la página para continuar');
                    showContextInvalidatedOverlay();
                    return;
                }
                console.warn("[IAndes] Service Worker no disponible para Capas 2+3", e);
            }
        }
    }
}


// ---------------------------------------------------------------------------
// GESTIÓN DE LISTENERS SOBRE CAMPOS DE TEXTO
// ---------------------------------------------------------------------------

/** Selectores CSS para encontrar el campo de texto del chat */
const INPUT_SELECTOR = [
    "textarea",
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
].join(", ");

/** Retorna todos los campos de texto visibles en la página */
function getChatInputs() {
    const all = Array.from(document.querySelectorAll(INPUT_SELECTOR));
    return all.filter(el => {
        try {
            const rect = el.getBoundingClientRect();
            // Filtrar elementos muy pequeños o fuera de viewport
            return rect.width > 80 && rect.height > 24 && rect.top < window.innerHeight;
        } catch {
            return false;
        }
    });
}

/**
 * Adjunta los listeners de eventos a un campo de texto.
 *
 * Usa el flag __iandes_attached para no adjuntar dos veces al mismo elemento.
 *
 * Los eventos que escuchamos:
 *   - input:  cuando el usuario escribe
 *   - paste:  cuando pega texto
 *   - cut:    cuando corta texto
 *   - drop:   cuando arrastra texto
 *   - keyup:  para capturar backspace/delete rápido
 *   - blur:   cuando el campo pierde el foco (guardado inmediato)
 */
function attachListener(el) {
    if (!el || el.__iandes_attached) return;
    el.__iandes_attached = true;

    // Función auxiliar para leer el valor del campo
    // (puede ser .value en textarea, o .innerText en div contenteditable)
    function readValue() {
        return el.value !== undefined
            ? el.value
            : (el.innerText || el.textContent || "");
    }

    // Timer para el debounce (esperar antes de procesar)
    let debounceTimer = null;

    // [FIX-CONTEXT] Ejecutar processPrompt solo si el contexto de extensión sigue vivo.
    function runProcessPromptSafely(options = { autoApply: false }) {
        if (!chrome.runtime?.id) {
            showContextInvalidatedOverlay();
            return;
        }

        textoTemporal = readValue();
        Promise.resolve(processPrompt(textoTemporal, {
            ...options,
            sourceElement: el,
        })).catch((err) => {
            const message = String(err?.message || err || '');
            if (message.toLowerCase().includes('invalidated')) {
                console.warn('[IAndes] Extension recargada — recarga la página para continuar');
                showContextInvalidatedOverlay();
                return;
            }
            console.warn('[IAndes] processPrompt falló:', err);
        });
    }

    function scheduleProcess(delayMs = CONFIG.debounceMs) {
        if (suppressNextScheduledProcess) {
            suppressNextScheduledProcess = false;
            return;
        }

        // Cancelar cualquier procesamiento pendiente
        clearTimeout(debounceTimer);
        // Programar uno nuevo
        debounceTimer = setTimeout(() => {
            runProcessPromptSafely({ autoApply: false });
        }, delayMs);
    }

    // Eventos estándar de escritura
    el.addEventListener("input",  ()  => scheduleProcess());
    el.addEventListener("paste",  ()  => setTimeout(() => scheduleProcess(), 50));
    el.addEventListener("cut",    ()  => setTimeout(() => scheduleProcess(), 50));
    el.addEventListener("drop",   ()  => setTimeout(() => scheduleProcess(), 50));

    // Borrar con Backspace/Delete → procesamos rápido para actualizar métricas
    el.addEventListener("keyup", (e) => {
        if (e.key === "Backspace" || e.key === "Delete") {
            scheduleProcess(80);
        }
    });

    // Al perder el foco → procesar solo si el texto cambió desde el último procesamiento
    el.addEventListener("blur", (event) => {
        if (Date.now() < ignoreInputBlurUntil) return;
        if (isIAndesUiElement(event.relatedTarget)) return;
        const currentVal = readValue().trim();
        // Evitar re-procesar si el texto no cambió desde el último ciclo
        if (currentVal === lastProcessedPrompt) return;
        clearTimeout(debounceTimer);
        runProcessPromptSafely({ autoApply: false });
    });
}


// ---------------------------------------------------------------------------
// ESCUCHAR MENSAJES DEL SERVICE WORKER (resultado de Capas 2+3)
// ---------------------------------------------------------------------------

/**
 * Cuando el Service Worker termina de optimizar el prompt (Capas 2 y/o 3),
 * nos manda el texto optimizado para inyectarlo de vuelta en el campo.
 * 
 * MODIFICADO: Corregir GET_METRICS para usar sendResponse en MV3.
 * El uso de 'return' directamente no funciona en Chrome MV3 messaging.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "OPTIMIZED_PROMPT") {
        clearTimeout(optimizationTimeoutId);
        optimizationTimeoutId = null;
        hideOptimizeHint();
        if (isImproveResultMessage(msg)) {
            renderImproveReviewPanel(msg.originalText || textoTemporal || "", msg.text, msg.stats || {});
        } else {
            injectOptimizedPrompt(msg.text, msg.stats, msg.mode || "compress");
        }
        return;
    }

    if (msg.type === "OPTIMIZATION_INFO") {
        clearTimeout(optimizationTimeoutId);
        optimizationTimeoutId = null;
        hideOptimizeHint();
        renderOverlayInfo(msg.message || "No se aplicaron cambios.");
        return;
    }

    if (msg.type === "OPTIMIZATION_ERROR") {
        clearTimeout(optimizationTimeoutId);
        optimizationTimeoutId = null;
        hideOptimizeHint();
        renderOverlayError(msg.message || "Modo Mejorar requiere Ollama. Ver popup →");
        return;
    }

    if (msg.type === "OPTIMIZATION_COMPLETE") {
        clearTimeout(optimizationTimeoutId);
        optimizationTimeoutId = null;
        hideOptimizeHint();
        const label = msg.stats?.savedTokens > 0
            ? `-${msg.stats.savedTokens} tokens ahorrados`
            : "Prompt limpiado";
        renderOverlaySuccess(`✓ ${label}`);
        setTimeout(() => {
            if (window.__iandes) renderOverlay(window.__iandes);
        }, 3500);
        return;
    }

    // El popup puede pedirle las métricas actuales al content script
    // MODIFICADO: usar sendResponse() en lugar de return
    if (msg.type === "GET_METRICS") {
        sendResponse(window.__iandes || null);
        return true; // Indica que la respuesta es asíncrona
    }
});

/**
 * Inyecta el texto optimizado de vuelta en el campo de texto del chat.
 *
 * @param {string} newText - El texto optimizado por las Capas 2+3
 * @param {object} stats   - Estadísticas de ahorro (opcional)
 */
function injectOptimizedPrompt(newText, stats, mode = "compress") {
    hideOptimizeHint();
    dismissedHintForText = "";

    const inputs = getChatInputs();
    const targetEl = inputs.find(el => el === document.activeElement) || inputs[0];
    
    if (targetEl) {
        const currentText = targetEl.value !== undefined
            ? targetEl.value
            : (targetEl.innerText || targetEl.textContent || "");

        if ((currentText || "").trim() !== (newText || "").trim()) {
            suppressNextScheduledProcess = true;
            if (targetEl.value !== undefined) {
                targetEl.value = newText;
                targetEl.dispatchEvent(new Event("input", { bubbles: true }));
            } else {
                targetEl.innerText = newText;
                targetEl.dispatchEvent(new InputEvent("input", { bubbles: true }));
            }
        }
    }

    // SIEMPRE actualizar el overlay, haya o no inyección
    if (stats) {
        const savedLabel = (stats.savedTokens > 0)
            ? `-${stats.savedTokens} tokens ahorrados`
            : "Prompt limpiado";
        console.log(`[IAndes] ✓ Optimización: ${savedLabel}`);
        persistSessionStats(stats, mode);
        renderOverlaySuccess(`✓ ${savedLabel}`);
        setTimeout(() => {
            if (window.__iandes) renderOverlay(window.__iandes);
        }, 3500);
    }
}


// ---------------------------------------------------------------------------
// INICIALIZACIÓN Y OBSERVADOR DE DOM
// ---------------------------------------------------------------------------

// Adjuntar listeners a los campos que ya están en la página al cargar
getChatInputs().forEach(attachListener);

/**
 * MutationObserver: observa cambios en el DOM para adjuntar listeners
 * a campos de texto que se añadan dinámicamente.
 *
 * Los chats modernos (ChatGPT, Claude, Gemini) son Single Page Applications:
 * el DOM cambia mucho sin recargar la página. Sin esto, perderíamos el campo
 * de texto cuando el usuario inicia una nueva conversación.
 */
const domObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        if (mutation.type !== "childList") continue;
        mutation.addedNodes.forEach(node => {
            if (!node || node.nodeType !== 1) return; // Solo nodos elemento
            try {
                // ¿El nodo mismo es un campo de texto?
                if (node.matches?.(INPUT_SELECTOR)) attachListener(node);
                // ¿Contiene campos de texto dentro?
                node.querySelectorAll?.(INPUT_SELECTOR).forEach(attachListener);
            } catch {
                // Algunos iframes o nodos de shadow DOM pueden lanzar errores
            }
        });
    }
});

// Observar todo el body, incluyendo subárboles (subtree: true)
domObserver.observe(document.body, { childList: true, subtree: true });

try {
    window.__iandes_rulebook = getLayer1RulesCatalog();
    console.info("[IAndes] Reglas Capa 1 cargadas:", window.__iandes_rulebook);
} catch {}

console.log(`[IAndes] Content Script v3.0 iniciado · Proveedor: ${PROVIDER.name}`);