/**
 * =============================================================================
 * IAndes – Service Worker (background.js) v5.0
 * =============================================================================
 *
 * Arquitectura v5: El Service Worker ya no procesa el prompt.
 * Construye el payload (Zona B) y lo envía al servidor local vía HTTP.
 * Recibe el OptimizationResult y lo reenvía al content script.
 *
 * Módulos:
 *   - bg-server-client.js: Cliente HTTP para servidor local
 *   - preflight/classifier.js: Intent Classifier
 *   - preflight/lang-detector.js: Detección de idioma
 *   - preflight/signal-extractor.js: Extracción de señales
 *   - preflight/payload-builder.js: Construcción de PromptAnalysis v2.0
 *
 * =============================================================================
 */

// ---------------------------------------------------------------------------
// IMPORTAR MÓDULOS
// ---------------------------------------------------------------------------
importScripts('error_utils.js');
importScripts('config.js');
importScripts('token_utils.js');
importScripts('bg-server-client.js');
importScripts('preflight/classifier.js');
importScripts('preflight/lang-detector.js');
importScripts('preflight/signal-extractor.js');
importScripts('preflight/payload-builder.js');

// Acceder a utilidades de error
const ErrorUtils = self.IAndesErrors || {};

// ---------------------------------------------------------------------------
// ESTADO DEL SERVICE WORKER
// ---------------------------------------------------------------------------
let serverStatus = { available: false, version: "", modelsLoaded: false };

// ---------------------------------------------------------------------------
// INICIALIZAR HEALTH CHECK
// ---------------------------------------------------------------------------
startHealthCheck((available) => {
    serverStatus.available = available;
    if (available) {
        console.log("[IAndes BG] Servidor IAndes v5 disponible");
    } else {
        console.log("[IAndes BG] Servidor IAndes v5 no disponible — modo degradado");
    }
});

// ---------------------------------------------------------------------------
// MENSAJERÍA CON EL CONTENT SCRIPT
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

    if (msg.type === "PING") {
        sendResponse({ ok: true, version: "5.0" });
        return false;
    }

    if (msg.type === "OPTIMIZE_PROMPT") {
        sendResponse({ ok: true });
        handleOptimizationV5(msg, sender)
            .catch(err => {
                console.error("[IAndes BG] Error en pipeline v5:", err);
                if (sender.tab?.id) {
                    chrome.tabs.sendMessage(sender.tab.id, {
                        type: "OPTIMIZATION_ERROR",
                        mode: msg.mode || "compress",
                        message: "Error al procesar la optimización.",
                        requestId: msg.requestId,
                    });
                }
            });
        return false;
    }

    if (msg.type === "GET_STATUS") {
        sendResponse({
            ok: true,
            serverAvailable: serverStatus.available,
            serverVersion: getServerVersion(),
            modelsLoaded: serverStatus.modelsLoaded,
        });
        return false;
    }

    if (msg.type === "SET_MODE") {
        chrome.storage.local.set({ mode: msg.mode });
        sendResponse({ ok: true });
        return false;
    }

    if (msg.type === "CHECK_SERVER") {
        checkServerHealth().then(status => {
            serverStatus = status;
            sendResponse(status);
        });
        return true; // async response
    }
});

// ---------------------------------------------------------------------------
// PIPELINE V5 — ORQUESTACIÓN
// ---------------------------------------------------------------------------

/**
 * Maneja una solicitud de optimización usando el servidor v5.
 *
 * Flujo:
 * 1. Verificar que el servidor está disponible
 * 2. Ejecutar Zona B (pre-flight classifier)
 * 3. Construir payload PromptAnalysis v2.0
 * 4. Enviar al servidor vía bg-server-client.js
 * 5. Recibir OptimizationResult
 * 6. Enviar al content script
 *
 * @param {object} msg - Mensaje del content script
 * @param {object} sender - Info del remitente
 */
async function handleOptimizationV5(msg, sender) {
    const tabId = sender.tab?.id;
    const requestId = msg.requestId || String(Date.now());
    const mode = msg.mode || "compress";
    const text = msg.text || msg.originalText || "";

    if (!text.trim()) {
        console.warn("[IAndes BG] Texto vacío, ignorando");
        return;
    }

    // 1. Verificar servidor disponible
    if (!isServerAvailable()) {
        console.warn("[IAndes BG] Servidor no disponible");
        if (tabId) {
            chrome.tabs.sendMessage(tabId, {
                type: "OPTIMIZATION_ERROR",
                mode,
                message: "Servidor IAndes no disponible. Inicia el servidor para optimizar prompts.",
                requestId,
            });
        }
        return;
    }

    // 2. Ejecutar Zona B — Pre-flight classification
    const estimatedTokens = estimateTokens(text);
    const intentResult = classifyIntent(text, estimatedTokens);
    const language = detectLanguage(text);
    const signals = extractSignals(text, estimatedTokens);

    // 3. Construir payload
    const provider = msg.provider || "unknown";
    const payload = buildPayload({
        text,
        mode,
        intent: intentResult.intent,
        confidence: intentResult.confidence,
        language,
        signals,
        provider,
    });

    console.log(`[IAndes BG] Enviando al servidor: intent=${intentResult.intent} (${intentResult.confidence}) | lang=${language} | tokens≈${estimatedTokens}`);

    // 4. Enviar al servidor
    const result = await sendToServer(payload);

    // 5. Procesar respuesta
    if (!result.ok) {
        console.error("[IAndes BG] Error del servidor:", result.error);
        if (tabId) {
            let errorMessage = "Error al comunicarse con el servidor.";
            if (result.errorCode === "TIMEOUT") {
                errorMessage = "El servidor tardó demasiado. Intenta de nuevo.";
            } else if (result.errorCode === "PAYLOAD_TOO_LARGE") {
                errorMessage = "Prompt demasiado largo (máximo 8000 caracteres).";
            } else if (result.errorCode === "SERVER_UNAVAILABLE") {
                errorMessage = "Servidor IAndes no disponible. Inicia el servidor para optimizar prompts.";
            }
            chrome.tabs.sendMessage(tabId, {
                type: "OPTIMIZATION_ERROR",
                mode,
                message: errorMessage,
                requestId,
            });
        }
        return;
    }

    const optimizationResult = result.data;

    // 6. Enviar al content script
    if (tabId) {
        // Verificar si hubo cambios significativos
        const tokensSaved = optimizationResult.savings?.tokens_saved || 0;

        if (tokensSaved > 0 || mode === "enhance") {
            chrome.tabs.sendMessage(tabId, {
                type: "OPTIMIZED_PROMPT",
                text: optimizationResult.optimized_prompt,
                originalText: text,
                mode,
                requestId,
                stats: {
                    originalTokens: optimizationResult.original_tokens,
                    optimizedTokens: optimizationResult.optimized_tokens,
                    savedTokens: tokensSaved,
                    savedPct: optimizationResult.original_tokens > 0
                        ? Math.round((tokensSaved / optimizationResult.original_tokens) * 100)
                        : 0,
                    layers: ["server"],
                    similarityScore: optimizationResult.similarity_score,
                    qualityWarning: optimizationResult.quality_warning || false,
                    pipelineMs: optimizationResult.pipeline_ms,
                },
                segments: optimizationResult.segments || [],
                savings: optimizationResult.savings,
                serverVersion: optimizationResult.server_version,
            });
        } else {
            // Sin cambios significativos
            chrome.tabs.sendMessage(tabId, {
                type: "OPTIMIZATION_COMPLETE",
                mode,
                requestId,
                stats: {
                    originalTokens: optimizationResult.original_tokens,
                    optimizedTokens: optimizationResult.optimized_tokens,
                    savedTokens: 0,
                    savedPct: 0,
                    layers: ["server"],
                    similarityScore: optimizationResult.similarity_score,
                    pipelineMs: optimizationResult.pipeline_ms,
                },
                message: "El prompt ya está optimizado. No se aplicaron cambios.",
            });
        }
    }
}

console.log("[IAndes BG] Service Worker v5.0 inicializado — Arquitectura servidor");