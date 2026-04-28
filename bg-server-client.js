/**
 * bg-server-client.js
 * Cliente HTTP para comunicación con el servidor local IAndes v5
 *
 * Responsabilidades:
 * - Health check periódico (cada 5s)
 * - Envío de payloads al servidor con timeout de 2s
 * - Reintentos con backoff exponencial (máximo 3)
 * - Manejo de errores: SERVER_UNAVAILABLE, TIMEOUT, PAYLOAD_TOO_LARGE, SERVER_ERROR
 */

// --- Configuración ---
const SERVER_BASE = "http://localhost:8000";
const HEALTH_CHECK_INTERVAL_MS = 5000;
const REQUEST_TIMEOUT_MS = 2000;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;

// --- Estado ---
let serverAvailable = false;
let serverVersion = "";
let healthCheckTimer = null;

/**
 * Verifica el estado del servidor.
 * @returns {Promise<{available: boolean, version: string, modelsLoaded: boolean}>}
 */
async function checkServerHealth() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        const resp = await fetch(`${SERVER_BASE}/health`, {
            method: "GET",
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!resp.ok) {
            serverAvailable = false;
            return { available: false, version: "", modelsLoaded: false };
        }

        const data = await resp.json();
        serverAvailable = true;
        serverVersion = data.version || "unknown";

        console.log(`[IAndes BG] Servidor disponible. v${serverVersion} | spaCy: ${data.spacy_ready ? "✓" : "✗"} | MiniLM: ${data.sentence_model_ready ? "✓" : "✗"}`);

        return {
            available: true,
            version: serverVersion,
            modelsLoaded: data.models_loaded || false,
            spacyReady: data.spacy_ready || false,
            sentenceModelReady: data.sentence_model_ready || false,
        };
    } catch (e) {
        if (serverAvailable) {
            console.warn("[IAndes BG] Servidor no disponible:", e.message);
        }
        serverAvailable = false;
        return { available: false, version: "", modelsLoaded: false };
    }
}

/**
 * Envía un payload al servidor con reintentos y backoff exponencial.
 * @param {object} payload - PromptAnalysis v2.0
 * @returns {Promise<{ok: boolean, data?: object, error?: string, errorCode?: string}>}
 */
async function sendToServer(payload) {
    let lastError = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        if (attempt > 0) {
            const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
            console.log(`[IAndes BG] Reintento ${attempt + 1}/${MAX_RETRIES} en ${backoff}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoff));
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

            const resp = await fetch(`${SERVER_BASE}/optimize`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (resp.status === 413) {
                return {
                    ok: false,
                    error: "Prompt demasiado largo (máximo 8000 caracteres)",
                    errorCode: "PAYLOAD_TOO_LARGE",
                };
            }

            if (resp.status === 500) {
                let errorDetail = "Error interno del servidor";
                try {
                    const errorData = await resp.json();
                    errorDetail = errorData.detail || errorDetail;
                } catch (e) {
                    // No se pudo parsear el error
                }
                lastError = { error: errorDetail, errorCode: "SERVER_ERROR" };
                continue; // Reintentar en error 500
            }

            if (!resp.ok) {
                return {
                    ok: false,
                    error: `Error HTTP ${resp.status}`,
                    errorCode: "SERVER_ERROR",
                };
            }

            const data = await resp.json();
            serverAvailable = true;
            return { ok: true, data };

        } catch (e) {
            if (e.name === "AbortError") {
                lastError = { error: "El servidor tardó demasiado", errorCode: "TIMEOUT" };
            } else {
                lastError = { error: `Error de conexión: ${e.message}`, errorCode: "SERVER_UNAVAILABLE" };
            }
        }
    }

    // Todos los reintentos fallaron
    serverAvailable = false;
    return {
        ok: false,
        error: lastError?.error || "Servidor no disponible",
        errorCode: lastError?.errorCode || "SERVER_UNAVAILABLE",
    };
}

/**
 * Inicia el health check periódico.
 * @param {function} [onStatusChange] - Callback(available: boolean) cuando cambia el estado
 */
function startHealthCheck(onStatusChange) {
    if (healthCheckTimer) clearInterval(healthCheckTimer);

    checkServerHealth().then(status => {
        if (onStatusChange) onStatusChange(status.available);
    });

    healthCheckTimer = setInterval(async () => {
        const status = await checkServerHealth();
        if (onStatusChange) onStatusChange(status.available);
    }, HEALTH_CHECK_INTERVAL_MS);
}

/**
 * Detiene el health check periódico.
 */
function stopHealthCheck() {
    if (healthCheckTimer) {
        clearInterval(healthCheckTimer);
        healthCheckTimer = null;
    }
}

/**
 * Retorna si el servidor está disponible.
 * @returns {boolean}
 */
function isServerAvailable() {
    return serverAvailable;
}

/**
 * Retorna la versión del servidor.
 * @returns {string}
 */
function getServerVersion() {
    return serverVersion;
}

// --- Exportar para Service Worker ---
if (typeof self !== "undefined") {
    self.checkServerHealth = checkServerHealth;
    self.sendToServer = sendToServer;
    self.startHealthCheck = startHealthCheck;
    self.stopHealthCheck = stopHealthCheck;
    self.isServerAvailable = isServerAvailable;
    self.getServerVersion = getServerVersion;
    self.SERVER_BASE = SERVER_BASE;
}

// --- Exportar para Node.js testing ---
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        checkServerHealth,
        sendToServer,
        startHealthCheck,
        stopHealthCheck,
        isServerAvailable,
        getServerVersion,
        SERVER_BASE,
    };
}