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
 *   3. ENVIAR el texto al servidor local (contar_tokens_server.py) para
 *      obtener el conteo preciso Y el impacto ambiental
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
    serverUrl:       "http://127.0.0.1:5000",
    serverTimeoutMs: 3000,    // Si el servidor no responde en 3s, usar estimación local
    overlayId:       "iandes-overlay",
};

// Variable global que guarda el último texto del campo de prompt
let textoTemporal = "";

// ---------------------------------------------------------------------------
// WEB WORKER: conteo de tokens (tiktoken en worker o heurística)
// ---------------------------------------------------------------------------
let tokenWorker = null;
let workerReady = false;
const workerPending = new Map();
let workerReqId = 1;

(async function initTokenWorker() {
    const workerUrl = chrome.runtime.getURL('token_worker.js');
    try {
        // Intento directo (funciona en la mayoría de navegadores).
        // Evitamos el fallback fetch+Blob porque muchos CSP bloquean blob: y scripts inline.
        tokenWorker = new Worker(workerUrl);
    } catch (e) {
        console.warn('[IAndes] No se pudo crear token worker (posible CSP):', e);
        tokenWorker = null;
    }

    if (!tokenWorker) return;

    tokenWorker.addEventListener('message', (ev) => {
        const msg = ev.data || {};
        if (msg.type === 'WORKER_READY') {
            workerReady = true;
            return;
        }
        if (msg.type === 'WORKER_ERROR') {
            console.error('[IAndes] Token worker error:', msg.message, msg.stack || '');
            return;
        }
        if (msg.type === 'COUNT_RESULT' && msg.id) {
            const resolver = workerPending.get(msg.id);
            if (resolver) {
                workerPending.delete(msg.id);
                resolver(msg);
            }
            return;
        }
        // LOAD_RESULT and other events can be handled if needed
    });
})();

function countTokensWithWorker(text, model) {
    if (!tokenWorker) return Promise.resolve({ tokens: estimateTokensLocally(text), source: 'no_worker' });
    return new Promise((resolve) => {
        const id = String(workerReqId++);
        const timeout = setTimeout(() => {
            if (workerPending.has(id)) {
                workerPending.delete(id);
                resolve({ tokens: estimateTokensLocally(text), source: 'worker_timeout' });
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
            resolve({ tokens: estimateTokensLocally(text), source: 'worker_error' });
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
// COMUNICACIÓN CON EL SERVIDOR LOCAL
// ---------------------------------------------------------------------------

/**
 * Envía el texto al servidor Python local para obtener:
 *   - Conteo EXACTO de tokens (usando el método correcto del proveedor)
 *   - Impacto ambiental (agua, CO2)
 *
 * Si el servidor no está disponible (apagado, timeout), retorna null
 * y seguimos usando la estimación local.
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
// CAPA 1 — Filtro léxico determinista
// ---------------------------------------------------------------------------
// Esta capa elimina "ruido conversacional" del prompt: saludos, despedidas,
// frases de cortesía, etc. Se ejecuta localmente (sin servidor, sin internet).

/** Reglas de la Capa 1 */
const LAYER1_RULES = {
    // Categoría A: patrones de ruego/cortesía que pueden aparecer en cualquier posición
    structural: [
        /(quisiera|me\s+gustaría|podrías?)\s+(pedirte|solicitarte|preguntarte|que)/gi,
        /(necesito|quiero)\s+que\s+me\s+(ayudes|expliques|digas|cuentes)/gi,
        /de\s+forma\s+(muy\s+)?(detallada|exhaustiva|completa|clara\s+y\s+sencilla)/gi,
        /\bpor\s+favor\b/gi,
        /\bte\s+pido\s+que\b/gi,
        /\bsi\s+no\s+es\s+molestia\b/gi,
        /\bme\s+harías\s+el\s+favor\s+de\b/gi,
        /\bmuchas\s+gracias\b/gi,
        /\bgracias\s+de\s+antemano\b/gi,
        /\bte\s+lo\s+agradezco\b/gi,
    ],
    // Categoría B: saludos y despedidas al inicio/fin del mensaje
    positional: {
        // Saludos: solo se eliminan si están al INICIO del texto
        start: /^(hola|buenos?\s+días?|buenas?\s+tardes?|espero\s+que\s+estés?\s+bien)[,.]?\s*/i,
        // Despedidas: solo se eliminan si están al FINAL del texto
        end:   /\s*(muchas\s+gracias|gracias\s+de\s+antemano|te\s+lo\s+agradezco)[.!]?\s*$/i,
    },
};

/**
 * Aplica el filtro léxico (Capa 1) al texto.
 *
 * IMPORTANTE: "Un falso negativo (dejar basura) es tolerable.
 *              Un falso positivo (borrar contenido útil) es el error que importa."
 * Cuando haya duda, NO eliminar.
 */
function applyLayer1(text) {
    let result = text;

    // Primero: eliminar saludos y despedidas posicionales
    result = result.replace(LAYER1_RULES.positional.start, "");
    result = result.replace(LAYER1_RULES.positional.end, "");

    // Luego: eliminar patrones estructurales de cortesía
    for (const regex of LAYER1_RULES.structural) {
        result = result.replace(regex, "");
    }

    // Limpiar espacios múltiples y líneas vacías extra
    result = result.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    return result;
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

    if (wordCount < 15 && !hasCourtesy) {
        // Prompt corto y directo → solo necesita reformulación (Capa 3)
        return { profile: "short_vague", layers: [3] };
    }
    if (wordCount >= 15 && hasCourtesy && functionalRatio > 0.25) {
        // Prompt largo con relleno → pipeline completo
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

/**
 * Actualiza el contenido del overlay con los datos de métricas.
 *
 * @param {object} data - Objeto con tokens, water_ml, co2_g, etc.
 */
function renderOverlay(data) {
    const overlay = getOrCreateOverlay();

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
    if (overlay) overlay.style.opacity = "0";
}


// ---------------------------------------------------------------------------
// LÓGICA PRINCIPAL: procesamiento del prompt
// ---------------------------------------------------------------------------

/**
 * Función principal que se llama cada vez que el usuario deja de escribir.
 *
 * Flujo:
 *   1. Mostrar estimación local inmediata (respuesta visual instantánea)
 *   2. Pedir al servidor el conteo exacto con el proveedor correcto
 *   3. Actualizar el overlay con los datos reales
 *   4. Clasificar el prompt (Capa 0)
 *   5. Aplicar filtro léxico si corresponde (Capa 1)
 *   6. Enviar al Service Worker para Capas 2 y 3
 */
async function processPrompt(text) {
    if (!text || !text.trim()) {
        hideOverlay();
        return;
    }

    // --- PASO 1: Mostrar estimación inmediata mientras el servidor responde ---
    const estimatedTokens = estimateTokensLocally(text);
    // Calcular métricas locales definitivas (sin servidor)
    const impact = computeEnvironmentalImpactLocal(estimatedTokens, PROVIDER.model);
    renderOverlay({
        tokens:   estimatedTokens,
        source:   "local_estimate",
        provider: PROVIDER.id,
        completion_est: impact.completion_est,
        tokens_total:   impact.tokens_total,
        water_ml:    impact.water_ml,
        water_drops: impact.water_drops,
        co2_g:       impact.co2_g,
        co2_steps:   impact.co2_steps,
    });

    // Guardar en window para que el popup y devtools puedan acceder
    try { window.__iandes = { ...impact, text, provider: PROVIDER.id, model: PROVIDER.model, tokens: estimatedTokens }; } catch {}

    // Pedir al Web Worker un conteo más preciso (si está disponible)
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
                try { window.__iandes = { ...impact2, text, provider: PROVIDER.id, model: PROVIDER.model, tokens: workerTokens }; } catch {}
            }
        }).catch(() => {});
    } catch {}

    // --- PASO 3: Clasificar el prompt (Capa 0) ---
    const classification = classifyPrompt(text);
    console.log(`[IAndes] Perfil: ${classification.profile} → capas: ${classification.layers}`);

    // Si el prompt ya es óptimo, no hacer nada más
    if (classification.layers.length === 0) {
        console.log("[IAndes] Prompt ya óptimo, sin transformación");
        return;
    }

    // --- PASO 4: Aplicar Capa 1 (filtro léxico) si está en el pipeline ---
    let optimizedText = text;
    if (classification.layers.includes(1)) {
        optimizedText = applyLayer1(text);
        const savedTokens = estimateTokensLocally(text) - estimateTokensLocally(optimizedText);
        if (savedTokens > 0) {
            console.log(`[IAndes] Capa 1: eliminadas ~${savedTokens} tokens de cortesía`);
        }
    }

    // --- PASO 5: Delegar Capas 2+3 al Service Worker ---
    if (classification.layers.includes(2) || classification.layers.includes(3)) {
        try {
            chrome.runtime.sendMessage({
                type:           "OPTIMIZE_PROMPT",
                text:           optimizedText,
                classification,
                provider:       PROVIDER.id,  // El SW también necesita saber el proveedor
            });
        } catch {
            // El Service Worker puede no estar listo aún en primera carga
            console.warn("[IAndes] Service Worker no disponible para Capas 2+3");
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
    return Array.from(document.querySelectorAll(INPUT_SELECTOR));
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

    function scheduleProcess(delayMs = CONFIG.debounceMs) {
        // Cancelar cualquier procesamiento pendiente
        clearTimeout(debounceTimer);
        // Programar uno nuevo
        debounceTimer = setTimeout(() => {
            textoTemporal = readValue();
            processPrompt(textoTemporal);
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

    // Al perder el foco → procesar inmediatamente (sin esperar el debounce)
    el.addEventListener("blur", () => {
        clearTimeout(debounceTimer);
        textoTemporal = readValue();
        processPrompt(textoTemporal);
    });
}


// ---------------------------------------------------------------------------
// ESCUCHAR MENSAJES DEL SERVICE WORKER (resultado de Capas 2+3)
// ---------------------------------------------------------------------------

/**
 * Cuando el Service Worker termina de optimizar el prompt (Capas 2 y/o 3),
 * nos manda el texto optimizado para inyectarlo de vuelta en el campo.
 */
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "OPTIMIZED_PROMPT") {
        injectOptimizedPrompt(msg.text, msg.stats);
    }
    // El popup puede pedirle las métricas actuales al content script
    if (msg.type === "GET_METRICS") {
        return window.__iandes || null;
    }
});

/**
 * Inyecta el texto optimizado de vuelta en el campo de texto del chat.
 *
 * @param {string} newText - El texto optimizado por las Capas 2+3
 * @param {object} stats   - Estadísticas de ahorro (opcional)
 */
function injectOptimizedPrompt(newText, stats) {
    const inputs = getChatInputs();
    // Preferir el campo que tiene el foco; si ninguno, usar el primero
    const targetEl = inputs.find(el => el === document.activeElement) || inputs[0];
    if (!targetEl) return;

    // Inyectar el texto según el tipo de campo
    if (targetEl.value !== undefined) {
        // Es un <textarea>
        targetEl.value = newText;
        targetEl.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
        // Es un div contenteditable
        targetEl.innerText = newText;
        targetEl.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }

    if (stats) {
        console.log(`[IAndes] ✓ Optimización completa: −${stats.savedTokens} tokens (${stats.savedPct}%)`);
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

console.log(`[IAndes] Content Script v3.0 iniciado · Proveedor: ${PROVIDER.name}`);
