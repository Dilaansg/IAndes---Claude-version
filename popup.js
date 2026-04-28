// popup.js — IAndes v5.0
// =============================================================================
// LÓGICA DEL POPUP
// =============================================================================
// v5: Ya no verifica Ollama/ONNX. Verifica el servidor local IAndes.
// =============================================================================

/**
 * Estado del popup.
 * [BUG-04] currentMode ya no es fuente primaria - storage es la única fuente de verdad.
 */
const compressBtn = document.getElementById("btn-compress");
const improveBtn = document.getElementById("btn-improve");
const improveCard = document.getElementById("improve-card");

// ---------------------------------------------------------------------------
// Selector de modo
// ---------------------------------------------------------------------------

compressBtn?.addEventListener("click", () => setMode("compress"));
improveBtn?.addEventListener("click", () => setMode("improve"));

function setMode(mode) {
    compressBtn?.classList.toggle("active", mode === "compress");
    improveBtn?.classList.toggle("active", mode === "improve");
    if (improveBtn) {
        improveBtn.textContent = mode === "improve" ? "✦ Mejorar prompt" : "✦ Mejorar";
    }
    improveCard?.classList.toggle("hidden", mode !== "improve");

    // Persistir en storage (única fuente de verdad)
    chrome.storage.local.set({ mode });

    // Notificar al Service Worker del cambio de modo
    chrome.runtime.sendMessage({ type: "SET_MODE", mode }, () => {
        void chrome.runtime.lastError;
    });
    refreshSystemStatus();
}

// Recuperar el modo guardado al abrir el popup
chrome.storage.local.get("mode", ({ mode }) => {
    if (mode) setMode(mode);
});

// ---------------------------------------------------------------------------
// Toggle ON/OFF de la extensión
// ---------------------------------------------------------------------------
const extToggle = document.getElementById("ext-toggle");
const extToggleTrack = document.getElementById("ext-toggle-track");

// Cargar estado guardado
chrome.storage.local.get(["extensionEnabled"], ({ extensionEnabled }) => {
    if (extToggle) extToggle.checked = extensionEnabled !== false;
    if (extToggleTrack) extToggleTrack.style.background = extensionEnabled === false ? "#555" : "#00e696";
});

// Escuchar cambios del toggle
extToggle?.addEventListener("change", (e) => {
    const enabled = e.target.checked;
    chrome.storage.local.set({ extensionEnabled: enabled });
    if (extToggleTrack) extToggleTrack.style.background = enabled ? "#00e696" : "#555";
    // Notificar al content script en la pestaña activa
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "SET_ENABLED", enabled });
    });
});

// ---------------------------------------------------------------------------
// Copiar el comando de inicio del servidor
// ---------------------------------------------------------------------------

document.getElementById("copy-cmd")?.addEventListener("click", async () => {
    const copyHint = document.getElementById("copy-hint");
    try {
        await navigator.clipboard.writeText("python -m iandes-server");
        if (copyHint) {
            copyHint.textContent = "✓ Copiado";
            setTimeout(() => {
                copyHint.textContent = "📋 Copiar";
            }, 1800);
        }
    } catch {
        if (copyHint) {
            copyHint.textContent = "No se pudo copiar";
        }
    }
});

// ---------------------------------------------------------------------------
// Detectar el proveedor de la pestaña activa y mostrar el badge
// ---------------------------------------------------------------------------

async function updateProviderBadge() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;

    const url = tab.url;
    let name  = "Chat desconocido";
    let color = "var(--muted)";

    if (url.includes("chat.openai.com") || url.includes("chatgpt.com")) {
        name = "ChatGPT"; color = "#10a37f";
    } else if (url.includes("claude.ai")) {
        name = "Claude";  color = "#d97706";
    } else if (url.includes("gemini.google.com")) {
        name = "Gemini";  color = "#4285f4";
    }

    const badge = document.getElementById("provider-name");
    if (!badge) return;

    badge.textContent = name;
    const badgeContainer = badge.closest(".provider-badge");
    if (!badgeContainer) return;
    badgeContainer.style.color = color;
    badgeContainer.style.borderColor = color + "44";
    badgeContainer.style.background   = color + "18";
}

// ---------------------------------------------------------------------------
// Obtener métricas del prompt activo desde el Content Script
// ---------------------------------------------------------------------------

async function refreshMetrics() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    chrome.tabs.sendMessage(tab.id, { type: "GET_METRICS" }, (data) => {
        if (chrome.runtime.lastError || !data) return;

        const tokensEl = document.getElementById("val-tokens");
        const waterEl = document.getElementById("val-water");
        const co2El = document.getElementById("val-co2");
        if (data.tokens != null && tokensEl) tokensEl.textContent = data.tokens + " tok";
        if (data.water_ml != null && waterEl) waterEl.textContent = data.water_ml + " ml";
        if (data.co2_g != null && co2El) co2El.textContent = data.co2_g + " g";

        // Mostrar la fuente del conteo (v5: siempre estimación local)
        const sourceEl = document.getElementById("val-source");
        const sourceText = data.source === "local_estimate" ? "Estimación local (±15%)" : (data.source || "Estimación local");
        const providerText = data.provider ? ` · ${data.provider}` : "";
        if (sourceEl) {
            sourceEl.textContent = `${sourceText}${providerText}`;
        }
    });
}

function refreshSessionSummary() {
    chrome.storage.local.get(["iandesSession"], ({ iandesSession }) => {
        const tokensEl = document.getElementById("session-tokens");
        const progressEl = document.getElementById("session-progress");
        const labelEl = document.getElementById("session-label");
        if (!tokensEl || !progressEl || !labelEl) return;

        if (!iandesSession) {
            tokensEl.textContent = "0";
            progressEl.style.width = "0%";
            labelEl.textContent = "0% de reducción promedio";
            return;
        }

        const savedTokens = Math.max(0, Number(iandesSession.savedTokensTotal || 0));
        const optimizations = Math.max(0, Number(iandesSession.optimizations || 0));
        const avgPct = Math.max(0, Number(iandesSession.avgPct || 0));
        const clampedPct = Math.min(100, avgPct);

        tokensEl.textContent = String(savedTokens);
        progressEl.style.width = `${clampedPct}%`;
        labelEl.textContent = optimizations > 0
            ? `${clampedPct}% de reducción promedio · ${optimizations} optimizaciones`
            : "0% de reducción promedio";
    });
}

// ---------------------------------------------------------------------------
// Verificar el estado del servidor local IAndes (v5)
// ---------------------------------------------------------------------------

async function refreshSystemStatus() {
    // v5: Verificar estado del servidor local vía Service Worker
    chrome.runtime.sendMessage({ type: "GET_STATUS" }, (status) => {
        if (chrome.runtime.lastError || !status) {
            // No se pudo comunicar con el Service Worker
            const dotServer = document.getElementById("dot-server");
            const labelServer = document.getElementById("label-server");
            if (dotServer) dotServer.className = "dot error";
            if (labelServer) labelServer.textContent = "Error de conexión";
            return;
        }

        const dotServer = document.getElementById("dot-server");
        const labelServer = document.getElementById("label-server");
        const dotModels = document.getElementById("dot-models");
        const labelModels = document.getElementById("label-models");
        const banner = document.getElementById("banner-server");

        // Servidor disponible
        if (status.serverAvailable) {
            if (dotServer) dotServer.className = "dot ok";
            if (labelServer) {
                const version = status.serverVersion ? ` v${status.serverVersion}` : "";
                labelServer.textContent = `Servidor IAndes${version} ✓`;
            }

            // Modelos cargados
            if (status.modelsLoaded) {
                if (dotModels) dotModels.className = "dot ok";
                if (labelModels) labelModels.textContent = "Modelos cargados ✓";
            } else {
                if (dotModels) dotModels.className = "dot warn";
                if (labelModels) labelModels.textContent = "Cargando modelos…";
            }

            // Ocultar banner si el servidor está disponible
            if (banner) banner.classList.remove("visible");
        } else {
            // Servidor no disponible
            if (dotServer) dotServer.className = "dot error";
            if (labelServer) labelServer.textContent = "Servidor no disponible";

            if (dotModels) dotModels.className = "dot loading";
            if (labelModels) labelModels.textContent = "Requiere servidor";

            // Mostrar banner con instrucciones
            if (banner) banner.classList.add("visible");
        }
    });
}

// ---------------------------------------------------------------------------
// Inicialización
// ---------------------------------------------------------------------------

// Al abrir el popup, cargar todo inmediatamente
updateProviderBadge();
refreshMetrics();
refreshSystemStatus();
refreshSessionSummary();

// Refrescar métricas cada 2 segundos (el usuario puede estar escribiendo)
setInterval(refreshMetrics, 2000);
setInterval(refreshSystemStatus, 5000);
setInterval(refreshSessionSummary, 2000);