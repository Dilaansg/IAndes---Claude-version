// content-pipeline.js
// v5: Envía prompt al Service Worker para clasificación y optimización en servidor
// Sin lógica local de clasificación ni capas — todo se procesa server-side

/**
 * Lee el modo de operación desde chrome.storage.local.
 * @returns {Promise<string>} Modo ('compress' por defecto)
 */
function getMode() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['mode'], (res) => {
            resolve(res?.mode || 'compress');
        });
    });
}

/**
 * Procesa el prompt: muestra métricas locales y envía al Service Worker.
 * v5: Sin classifyPrompt, sin applyLayer1, sin showOptimizeHint.
 * @param {string} text - Texto del prompt
 * @param {Element} el - Campo de texto
 */
async function processPrompt(text, el) {
    if (!text.trim()) return;
    setTextoTemporal(text);
    await updateMetricsOnly(el);

    const mode = await getMode();

    const requestId = String(incrementOptimizationReqId());
    const msg = {
        type: 'OPTIMIZE_PROMPT',
        requestId,
        text: text,
        originalText: text,
        mode: mode,
        provider: PROVIDER.id,
    };

    getPendingOptimizations().set(requestId, { timestamp: Date.now(), mode: mode });
    setOptimizationTimeoutId(setTimeout(() => {
        getPendingOptimizations().delete(requestId);
    }, 30000));

    if (!isContextValid()) return;
    chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
            clearTimeout(getOptimizationTimeoutId());
            getPendingOptimizations().delete(requestId);
        }
    });
}

/**
 * Verifica si un mensaje de respuesta es válido y no está obsoleto.
 * @param {object} msg - Mensaje recibido
 * @returns {boolean} True si es válido
 */
function isValidOptimizationResponse(msg) {
    if (!msg.requestId) return true;
    const pending = getPendingOptimizations().get(msg.requestId);
    if (!pending) {
        console.warn(`[IAndes] Received stale response for requestId: ${msg.requestId}`);
        return false;
    }
    getPendingOptimizations().delete(msg.requestId);
    const age = Date.now() - pending.timestamp;
    if (age > 30000) {
        console.warn(`[IAndes] Received very old response (${age}ms) for requestId: ${msg.requestId}`);
        return false;
    }
    return true;
}

/**
 * Determina si el mensaje es de modo mejorar.
 * @param {object} msg - Mensaje recibido
 * @returns {boolean} True si es modo mejorar
 */
function isImproveResultMessage(msg) {
    return msg.mode === 'improve' || (msg.stats && msg.stats.improveMode);
}

/**
 * Persiste estadísticas de la sesión.
 * @param {object} stats - Estadísticas
 * @param {string} [mode='compress'] - Modo de operación
 */
function persistSessionStats(stats, mode = 'compress') {
    try {
        chrome.storage.local.get(['iandesSession'], (res) => {
            if (chrome.runtime.lastError) return;
            const existing = res.iandesSession || { savedTokensTotal: 0, optimizations: 0, avgPct: 0, _history: [] };
            existing.optimizations++;
            existing.savedTokensTotal += (stats?.savedTokens || 0);
            if (stats?.savedPct && stats.savedPct > 0) {
                existing._history = existing._history || [];
                existing._history.push(stats.savedPct);
                if (existing._history.length > 20) existing._history.shift();
                const sum = existing._history.reduce((a, b) => a + b, 0);
                existing.avgPct = Math.round(sum / existing._history.length);
            }
            existing.lastUpdated = new Date().toISOString();
            chrome.storage.local.set({ iandesSession: existing });
        });
    } catch (e) { console.warn('[IAndes] No se pudieron persistir estadísticas:', e); }
}

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        processPrompt,
        isValidOptimizationResponse,
        isImproveResultMessage,
        persistSessionStats,
        getMode,
    };
}