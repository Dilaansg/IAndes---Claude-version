/**
 * =============================================================================
 * IAndes – Content Script v5.0 (Modularizado)
 * =============================================================================
 *
 * Módulos:
 *   - content-provider.js: detección del proveedor y selectores de input
 *   - content-state.js: estado centralizado
 *   - content-metrics.js: cálculo de impacto ambiental y render de métricas
 *   - content-pipeline.js: clasificación y pipeline de optimización
 *   - content-overlay.js: overlay y UI
 *   - content-panels.js: paneles de revisión antes/después
 *
 * v5: Arquitectura servidor local — sin Ollama/ONNX
 * =============================================================================
 */

// ---------------------------------------------------------------------------
// UTILIDADES DE ERROR (Contrato unificado)
// ---------------------------------------------------------------------------
const ErrorUtils = (typeof self !== 'undefined' ? self : window).IAndesErrors || {};

// ---------------------------------------------------------------------------
// GUARDA CONTRA CONTEXTO INVALIDADO
// Cuando la extensión se recarga, los content scripts inyectados pierden
// su contexto. Esta función detecta eso y evita errores.
// ---------------------------------------------------------------------------
function isContextValid() {
    try {
        // Si chrome.runtime.id ya no existe, el contexto fue invalidado
        return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
        return false;
    }
}

/**
 * Envuelve chrome.runtime.sendMessage con protección contra contexto invalidado.
 * Si el contexto fue invalidado (extensión recargada), retorna null silenciosamente.
 */
function safeSendMessage(msg, callback) {
    if (!isContextValid()) return;
    try {
        chrome.runtime.sendMessage(msg, (response) => {
            // Ignorar errores de contexto invalidado
            if (chrome.runtime.lastError) return;
            if (callback) callback(response);
        });
    } catch (e) {
        // Contexto invalidado — silenciar
    }
}

// ---------------------------------------------------------------------------
// TOKEN COUNTING: v5 usa estimación local — conteo exacto viene del servidor
// ---------------------------------------------------------------------------

/**
 * Cuenta tokens usando estimación local.
 * v5: El conteo exacto se hace en el servidor (localhost:8000).
 * Esta función solo proporciona una estimación rápida para métricas locales.
 * @param {string} text - Texto a estimar
 * @param {string} model - Nombre del modelo (ignorado, para compatibilidad)
 * @returns {Promise<{tokens: number, source: string}>}
 */
function countTokensWithWorker(text, model) {
    return new Promise((resolve) => {
        setTimeout(() => {
            const tokens = estimateTokens(text);
            resolve({ tokens, source: 'local_estimate' });
        }, 0);
    });
}

// ---------------------------------------------------------------------------
// LISTENERS DE MENSAJES DEL SERVICE WORKER Y POPUP
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Ignorar mensajes si el contexto fue invalidado
    if (!isContextValid()) return;
    if (msg.type === "OPTIMIZED_PROMPT") {
        if (!isValidOptimizationResponse(msg)) return;
        clearTimeout(getOptimizationTimeoutId());
        setOptimizationTimeoutId(null);
        hideOptimizeHint();
        if (isImproveResultMessage(msg)) {
            renderImproveReviewPanel(msg.originalText || getTextoTemporal() || "", msg.text, msg.stats || {});
        } else {
            const spinner = document.getElementById('iandes-panel-spinner');
            if (spinner) spinner.remove();
            renderCompressReviewPanel(msg.originalText || getTextoTemporal() || "", msg.text, {
                ...(msg.stats || {}),
                segments: msg.segments || [],
                savings: msg.savings || null,
                layer: msg.stats?.layer || 'server',
                pending: false
            });
        }
        return;
    }

    if (msg.type === "OPTIMIZATION_INFO") {
        if (!isValidOptimizationResponse(msg)) return;
        clearTimeout(getOptimizationTimeoutId());
        setOptimizationTimeoutId(null);
        hideOptimizeHint();
        renderOverlayInfo(msg.message || "No se aplicaron cambios.");
        return;
    }

    if (msg.type === "OPTIMIZATION_ERROR") {
        if (!isValidOptimizationResponse(msg)) return;
        clearTimeout(getOptimizationTimeoutId());
        setOptimizationTimeoutId(null);
        hideOptimizeHint();
        renderOverlayError(msg.message || "Error al optimizar. Verifica que el servidor IAndes esté activo.");
        return;
    }

    if (msg.type === "OPTIMIZATION_COMPLETE") {
        if (!isValidOptimizationResponse(msg)) return;
        clearTimeout(getOptimizationTimeoutId());
        setOptimizationTimeoutId(null);
        hideOptimizeHint();

        const existingPanel = document.getElementById('iandes-compress-panel');
        const spinner = document.getElementById('iandes-panel-spinner');
        if (spinner) spinner.remove();

        if (existingPanel) {
            // No hacer nada más
        } else {
            if (msg.stats?.qualityWarning) {
                renderOverlayInfo(msg.message || "Optimización aplicada con advertencia de calidad.");
            } else {
                const label = msg.stats?.savedTokens > 0
                    ? `-${msg.stats.savedTokens} tokens ahorrados` : "Sin cambios necesarios";
                renderOverlaySuccess(`✓ ${label}`);
            }
        }
        return;
    }

    if (msg.type === "SET_ENABLED") {
        setExtensionEnabled(msg.enabled);
        if (isContextValid()) {
            chrome.storage.local.set({ extensionEnabled: msg.enabled });
        }
        const toggle = document.getElementById("iandes-toggle");
        if (toggle) toggle.checked = msg.enabled;
    }

    // El popup puede pedirle las métricas actuales al content script
    if (msg.type === "GET_METRICS") {
        const state = window.__iandes;
        const metrics = state?.metrics;
        sendResponse({
            tokens: metrics?.tokens ?? null,
            water_ml: metrics?.env?.water_ml ?? metrics?.env?.water_drops ?? null,
            co2_g: metrics?.env?.co2_g ?? null,
            source: state?.source || 'local_estimate',
            provider: state?.provider || PROVIDER.name
        });
        return true;
    }
});

// ---------------------------------------------------------------------------
// ATTACH LISTENER A CAMPO DE TEXTO
// ---------------------------------------------------------------------------
function attachListener(el) {
    if (!el || !el.addEventListener) return;
    let debounceTimer = null;
    const handler = () => {
        if (getDismissedHintForText() === el.value) return;
        if (!getExtensionEnabled()) { updateMetricsOnly(el); return; }
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            if (getSuppressNextScheduledProcess()) { setSuppressNextScheduledProcess(false); return; }
            const text = el.value !== undefined ? el.value : (el.innerText || el.textContent || '');
            setTextoTemporal(text);
            if (!text.trim()) { hideOptimizeHint(); const overlay = document.getElementById(CONFIG.overlayId); if (overlay) overlay.style.opacity = '0'; return; }
            await processPrompt(text, el);
        }, CONFIG.debounceMs);
    };
    el.addEventListener('input', handler);
    el.addEventListener('focus', () => { updateMetricsOnly(el); });
    el.addEventListener('blur', () => { clearTimeout(debounceTimer); });
}

// ---------------------------------------------------------------------------
// INICIALIZACIÓN Y OBSERVADOR DE DOM
// ---------------------------------------------------------------------------
getChatInputs().forEach(attachListener);
getOrCreateOverlay();

const domObserver = new MutationObserver((mutations) => {
    if (!isContextValid()) {
        domObserver.disconnect();
        return;
    }
    for (const mutation of mutations) {
        if (mutation.type !== "childList") continue;
        mutation.addedNodes.forEach(node => {
            if (!node || node.nodeType !== 1) return;
            try {
                if (node.matches?.(INPUT_SELECTOR)) attachListener(node);
                node.querySelectorAll?.(INPUT_SELECTOR).forEach(attachListener);
            } catch {
                // Algunos iframes o nodos de shadow DOM pueden lanzar errores
            }
        });
    }
});

domObserver.observe(document.body, { childList: true, subtree: true });

// ---------------------------------------------------------------------------
// v5: Verificar estado del servidor periódicamente y actualizar indicador
// ---------------------------------------------------------------------------
function checkServerStatusForOverlay() {
    if (!isContextValid()) return;
    safeSendMessage({ type: "GET_STATUS" }, (status) => {
        if (!status) return;
        updateServerStatusIndicator(status.serverAvailable, status.serverVersion);
    });
}

// Verificar al inicio y cada 10 segundos (detener si contexto invalidado)
checkServerStatusForOverlay();
const serverStatusInterval = setInterval(() => {
    if (!isContextValid()) {
        clearInterval(serverStatusInterval);
        return;
    }
    checkServerStatusForOverlay();
}, 10000);

try {
    window.__iandes_rulebook = getLayer1RulesCatalog();
    console.info("[IAndes] Reglas Capa 1 cargadas:", window.__iandes_rulebook);
} catch (e) {
    console.warn('[IAndes] Error al cargar reglas Capa 1:', e);
}

console.log(`[IAndes] Content Script v5.0 iniciado · Proveedor: ${PROVIDER.name}`);
