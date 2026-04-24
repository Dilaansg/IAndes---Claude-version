// [FIX-CSP] Script extraido desde popup.html para cumplir CSP en MV3.
// =============================================================================
// LÓGICA DEL POPUP
// =============================================================================

/**
 * Estado del popup.
 * Se inicializa con los valores guardados en chrome.storage.
 */
let currentMode = "compress";
const compressBtn = document.getElementById("btn-compress");
const improveBtn = document.getElementById("btn-improve");
const improveCard = document.getElementById("improve-card");
let recommendedOllamaModel = "qwen3.5:2b";

// ---------------------------------------------------------------------------
// Selector de modo
// ---------------------------------------------------------------------------

compressBtn?.addEventListener("click", () => setMode("compress"));
improveBtn?.addEventListener("click", () => setMode("improve"));

function setMode(mode) {
    currentMode = mode;
    compressBtn?.classList.toggle("active", mode === "compress");
    improveBtn?.classList.toggle("active", mode === "improve");
    if (improveBtn) {
        improveBtn.textContent = mode === "improve" ? "✦ Mejorar prompt" : "✦ Mejorar";
    }
    improveCard?.classList.toggle("hidden", mode !== "improve");

    // Persistir en popup para evitar perder estado si el SW está dormido.
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
// Copiar el comando de Ollama
// ---------------------------------------------------------------------------

document.getElementById("copy-cmd")?.addEventListener("click", async () => {
    const copyHint = document.getElementById("copy-hint");
    try {
        await navigator.clipboard.writeText(`ollama pull ${recommendedOllamaModel}`);
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

    // Pedir las métricas al Content Script que está corriendo en esa pestaña
    chrome.tabs.sendMessage(tab.id, { type: "GET_METRICS" }, (data) => {
        if (chrome.runtime.lastError || !data) return;

        const tokensEl = document.getElementById("val-tokens");
        const waterEl = document.getElementById("val-water");
        const co2El = document.getElementById("val-co2");
        if (data.tokens != null && tokensEl) tokensEl.textContent = data.tokens + " tok";
        if (data.water_ml != null && waterEl) waterEl.textContent = data.water_ml + " ml";
        if (data.co2_g != null && co2El) co2El.textContent = data.co2_g + " g";

        // Mostrar la fuente del conteo (tiktoken, API de Anthropic, etc.)
        const sourceEl = document.getElementById("val-source");
        const sourceText = data.source || "–";
        const providerText = data.provider ? ` (${data.provider})` : "";
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
// Verificar el estado del sistema (desde el Service Worker)
// ---------------------------------------------------------------------------

async function refreshSystemStatus() {
    // El proyecto actual usa estimaciones locales; no requiere servidor Python.
    const dotServer = document.getElementById("dot-server");
    const labelServer = document.getElementById("label-server");
    if (dotServer) dotServer.className = "dot ok";
    if (labelServer) labelServer.textContent = "Métricas locales activas (sin servidor)";

    // Verificar Ollama y modelo ONNX desde el Service Worker
    chrome.runtime.sendMessage({ type: "GET_STATUS" }, (status) => {
        if (chrome.runtime.lastError || !status) return;
        recommendedOllamaModel = status.recommendedModel || "qwen3.5:2b";

        const commandLabel = document.querySelector("#copy-cmd span:first-child");
        if (commandLabel) {
            commandLabel.textContent = `ollama pull ${recommendedOllamaModel}`;
        }

        // ONNX
        const dotOnnx  = document.getElementById("dot-onnx");
        const lblOnnx  = document.getElementById("label-onnx");
        if (!dotOnnx || !lblOnnx) return;

        if (!status.onnxRuntimeAvailable) {
            dotOnnx.className  = "dot error";
            lblOnnx.textContent = "ONNX Runtime no disponible (falta lib/ort.min.js)";
        } else if (status.onnxCached) {
            dotOnnx.className  = "dot ok";
            lblOnnx.textContent = "Modelo ONNX en caché ✓";
        } else {
            dotOnnx.className  = "dot warn";
            lblOnnx.textContent = "Modelo ONNX no descargado";
        }

        // Ollama
        const dotOllama = document.getElementById("dot-ollama");
        const lblOllama = document.getElementById("label-ollama");
        const banner    = document.getElementById("banner-ollama");
        if (!dotOllama || !lblOllama || !banner) return;
        const sameAsRecommended = (status.ollamaModel || "").toLowerCase() === recommendedOllamaModel.toLowerCase();

        if (status.ollamaAvailable && status.ollamaModel) {
            dotOllama.className  = "dot ok";
            lblOllama.textContent = sameAsRecommended
                ? `Ollama: ${status.ollamaModel} ✓`
                : `Ollama: ${status.ollamaModel} ✓ · recomendado: ${recommendedOllamaModel}`;

            // Si hay modelo pero no es el recomendado, mostrar guía opcional.
            if (!sameAsRecommended) {
                const bannerTitleEl = document.querySelector("#banner-ollama .banner-title");
                const bannerTextEl = document.querySelector("#banner-ollama .banner-text");
                if (bannerTitleEl) bannerTitleEl.textContent = "Modelo alternativo detectado";
                if (bannerTextEl) {
                    bannerTextEl.textContent =
                        `Tu modelo ${status.ollamaModel} funciona. Recomendado para la mayoría de usuarios: ${recommendedOllamaModel}.`;
                }
                banner.classList.add("visible");
            } else {
                banner.classList.remove("visible");
            }
        } else {
            dotOllama.className  = "dot warn";
            lblOllama.textContent = "Ollama no detectado";
                    const bannerTitleEl = document.querySelector("#banner-ollama .banner-title");
                    const bannerTextEl = document.querySelector("#banner-ollama .banner-text");
                    if (bannerTitleEl) {
                        bannerTitleEl.textContent = currentMode === "improve" ? "Modo Mejorar requiere Ollama" : "Modo básico activo";
                    }
                    if (bannerTextEl) {
                        bannerTextEl.textContent = currentMode === "improve"
                            ? `Para reescribir prompts con rol, contexto y formato de salida claros, instala Ollama y descarga ${recommendedOllamaModel}:`
                            : `Para activar la compresión avanzada (Capa 3), instala Ollama y descarga ${recommendedOllamaModel}:`;
                    }
            banner.classList.add("visible");     // Mostrar el banner con instrucciones
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

