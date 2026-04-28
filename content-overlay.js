// content-overlay.js
// Funciones de UI para el overlay (getOrCreateOverlay, renderOverlay*, inject)
// v5: Arquitectura servidor local — sin Ollama/ONNX
// ~280 líneas

// CONFIG ya está disponible globalmente desde config.js
// OPTIMIZE_HINT_ID se define más abajo o se usa desde content-panels.js

/**
 * Obtiene o crea el elemento overlay para mostrar información.
 * @param {Element} [inputEl] - Elemento input para posicionamiento adaptativo
 * @returns {HTMLDivElement} El overlay
 */
function getOrCreateOverlay(inputEl = null) {
    let overlay = document.getElementById(CONFIG.overlayId);
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = CONFIG.overlayId;
        overlay.style.cssText = `
            position: fixed; bottom: 80px; right: 20px;
            background: rgba(10, 12, 20, 0.95); backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px;
            padding: 12px 16px; color: #d8e8df;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 12px;
            z-index: 2147483647; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
            max-width: 300px; pointer-events: auto; opacity: 1; transition: opacity 0.3s;
        `;
        overlay.innerHTML = `
            <div id="iandes-toggle-row" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;pointer-events:auto;">
                <span style="color:#00e696;font-weight:700;font-size:11px;">▸ IAndes</span>
                <label style="position:relative;display:inline-block;width:36px;height:18px;cursor:pointer;">
                    <input type="checkbox" id="iandes-toggle" ${getExtensionEnabled() ? 'checked' : ''} style="opacity:0;width:0;height:0;">
                    <span style="position:absolute;top:0;left:0;right:0;bottom:0;background:${getExtensionEnabled() ? '#00e696' : '#555'};border-radius:9px;transition:.3s;"></span>
                </label>
            </div>
            <div id="iandes-mode-buttons" style="display:flex;gap:6px;margin-bottom:8px;">
                <button id="iandes-btn-compress" style="flex:1;padding:4px 6px;background:rgba(0,230,150,0.15);color:#00e696;border:1px solid rgba(0,230,150,0.3);border-radius:6px;cursor:pointer;font-size:10px;font-weight:600;font-family:inherit;pointer-events:auto;">⬇ Comprimir</button>
                <button id="iandes-btn-improve" style="flex:1;padding:4px 6px;background:transparent;color:#6b8a78;border:1px solid #333;border-radius:6px;cursor:pointer;font-size:10px;font-weight:600;font-family:inherit;pointer-events:auto;">✦ Mejorar</button>
            </div>
            <div id="iandes-server-status" style="display:flex;align-items:center;gap:5px;margin-bottom:6px;font-size:9px;color:#6b8a78;">
                <span id="iandes-server-dot" style="width:6px;height:6px;border-radius:50%;background:#6b8a78;"></span>
                <span id="iandes-server-label">Verificando servidor…</span>
            </div>
        `;
        const toggle = overlay.querySelector('#iandes-toggle');
        if (toggle) {
            toggle.addEventListener('change', (e) => {
                setExtensionEnabled(e.target.checked);
                if (isContextValid()) {
                    chrome.storage.local.set({ extensionEnabled: e.target.checked });
                }
                const span = toggle.nextElementSibling;
                if (span) span.style.background = e.target.checked ? '#00e696' : '#555';
            });
        }
        if (isContextValid()) {
            chrome.storage.local.get(['mode'], (res) => {
                if (chrome.runtime.lastError) return;
                const currentMode = res?.mode || 'compress';
                updateModeButtons(currentMode);
            });
        }
        overlay.querySelector('#iandes-btn-compress')?.addEventListener('click', () => setOverlayMode('compress'));
        overlay.querySelector('#iandes-btn-improve')?.addEventListener('click', () => setOverlayMode('improve'));
        document.body.appendChild(overlay);
    }
    if (inputEl) {
        positionOverlayAdaptive(overlay, inputEl);
    }
    return overlay;
}

/**
 * Actualiza el estilo de los botones de modo en el overlay.
 * @param {string} mode - Modo: 'compress' o 'improve'
 */
function updateModeButtons(mode) {
    const overlay = document.getElementById(CONFIG.overlayId);
    if (!overlay) return;
    const compressBtn = overlay.querySelector('#iandes-btn-compress');
    const improveBtn = overlay.querySelector('#iandes-btn-improve');
    if (compressBtn && improveBtn) {
        if (mode === 'compress') {
            compressBtn.style.background = 'rgba(0,230,150,0.15)';
            compressBtn.style.color = '#00e696';
            compressBtn.style.borderColor = 'rgba(0,230,150,0.3)';
            improveBtn.style.background = 'transparent';
            improveBtn.style.color = '#6b8a78';
            improveBtn.style.borderColor = '#333';
        } else {
            improveBtn.style.background = 'rgba(0,230,150,0.15)';
            improveBtn.style.color = '#00e696';
            improveBtn.style.borderColor = 'rgba(0,230,150,0.3)';
            compressBtn.style.background = 'transparent';
            compressBtn.style.color = '#6b8a78';
            compressBtn.style.borderColor = '#333';
        }
    }
}

/**
 * Actualiza el indicador de estado del servidor en el overlay.
 * @param {boolean} available - Si el servidor está disponible
 * @param {string} [version] - Versión del servidor
 */
function updateServerStatusIndicator(available, version) {
    const dot = document.getElementById('iandes-server-dot');
    const label = document.getElementById('iandes-server-label');
    if (!dot || !label) return;

    if (available) {
        dot.style.background = '#00e696';
        dot.style.boxShadow = '0 0 6px #00e696';
        label.textContent = version ? `Servidor v${version} ✓` : 'Servidor conectado ✓';
        label.style.color = '#00e696';
    } else {
        dot.style.background = '#ff4d6d';
        dot.style.boxShadow = '0 0 6px #ff4d6d';
        label.textContent = 'Servidor no disponible';
        label.style.color = '#ff4d6d';
    }
}

/**
 * Establece el modo y procesa el prompt actual.
 * @param {string} mode - Modo: 'compress' o 'improve'
 */
function setOverlayMode(mode) {
    if (!isContextValid()) return;
    chrome.storage.local.set({ mode });
    updateModeButtons(mode);
    safeSendMessage({ type: "SET_MODE", mode });
    // v5: Re-process current prompt with new mode via Service Worker
    if (getTextoTemporal()) {
        const inputs = getChatInputs();
        const el = inputs.find(e => e === document.activeElement) || inputs[0];
        if (el) {
            setSuppressNextScheduledProcess(true);
            setDismissedHintForText(getTextoTemporal());
            processPrompt(getTextoTemporal(), el);
        }
    }
}

/**
 * Posicionamiento adaptativo del overlay basado en la posición del input.
 * @param {HTMLDivElement} overlay - El overlay
 * @param {Element} inputEl - El campo de texto
 */
function positionOverlayAdaptive(overlay, inputEl) {
    try {
        const inputRect = inputEl.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;

        if (inputRect.top > viewportHeight / 2) {
            let top = inputRect.top - overlayRect.height - 15;
            if (top < 10) top = 10;
            overlay.style.top = top + 'px';
            overlay.style.bottom = 'auto';
        } else {
            overlay.style.bottom = '80px';
            overlay.style.top = 'auto';
        }

        let left = inputRect.left;
        const overlayWidth = overlayRect.width || 300;
        if (left + overlayWidth > viewportWidth - 20) {
            left = viewportWidth - overlayWidth - 20;
        }
        if (left < 10) left = 10;
        overlay.style.left = left + 'px';
        overlay.style.right = 'auto';
    } catch (e) {
        overlay.style.top = 'auto';
        overlay.style.bottom = '80px';
        overlay.style.left = 'auto';
        overlay.style.right = '20px';
    }
}

function renderOverlayInfo(message) {
    const overlay = getOrCreateOverlay();
    [...overlay.childNodes].forEach(n => { if (n.id !== 'iandes-toggle-row' && n.id !== 'iandes-mode-buttons' && n.id !== 'iandes-server-status') n.remove(); });
    const msgDiv = document.createElement('div');
    msgDiv.style.cssText = 'color:#f0d78c;font-size:11px;margin-top:4px;';
    msgDiv.textContent = message;
    overlay.appendChild(msgDiv);
    overlay.style.opacity = '1';
}

function renderOverlayError(message) {
    const overlay = getOrCreateOverlay();
    [...overlay.childNodes].forEach(n => { if (n.id !== 'iandes-toggle-row' && n.id !== 'iandes-mode-buttons' && n.id !== 'iandes-server-status') n.remove(); });
    const msgDiv = document.createElement('div');
    msgDiv.style.cssText = 'color:#ff6b6b;font-size:11px;margin-top:4px;';
    msgDiv.textContent = message;
    overlay.appendChild(msgDiv);
    overlay.style.opacity = '1';
}

function renderOverlaySuccess(message) {
    const overlay = getOrCreateOverlay();
    [...overlay.childNodes].forEach(n => { if (n.id !== 'iandes-toggle-row' && n.id !== 'iandes-mode-buttons' && n.id !== 'iandes-server-status') n.remove(); });
    const msgDiv = document.createElement('div');
    msgDiv.style.cssText = 'color:#00e696;font-size:11px;margin-top:4px;';
    msgDiv.textContent = message;
    overlay.appendChild(msgDiv);
    overlay.style.opacity = '1';
}

function renderOverlay(data) {
    if (!data || !data.metrics) return;
    const overlay = getOrCreateOverlay();
    [...overlay.childNodes].forEach(n => { if (n.id !== 'iandes-toggle-row' && n.id !== 'iandes-mode-buttons' && n.id !== 'iandes-server-status') n.remove(); });
    const { tokens, env } = data.metrics;
    const content = document.createElement('div');
    content.style.cssText = 'margin-top:8px;';
    if (tokens !== undefined) {
        const tokenLine = document.createElement('div');
        tokenLine.style.cssText = 'color:#9d9d9d;font-size:10px;';
        tokenLine.textContent = `${tokens} tokens (est.)`;
        content.appendChild(tokenLine);
    }
    if (env) {
        const envLine = document.createElement('div');
        envLine.style.cssText = 'color:#6b8f71;font-size:10px;';
        envLine.textContent = `💧 ${env.water_drops || 0} gotas · 🌍 ${env.co2_g || 0}g CO₂ (est.)`;
        content.appendChild(envLine);
    }
    // v5: Show similarity score if available (from server — exact)
    if (data.similarityScore != null) {
        const simPct = Math.round(data.similarityScore * 100);
        const simColor = simPct >= 85 ? '#00e696' : simPct >= 70 ? '#ffc107' : '#ff6b6b';
        const simLine = document.createElement('div');
        simLine.style.cssText = `color:${simColor};font-size:9px;margin-top:2px;`;
        simLine.textContent = `Similitud: ${simPct}%`;
        content.appendChild(simLine);
    }
    // v5: Clarify that local metrics are estimated
    const estHint = document.createElement('div');
    estHint.style.cssText = 'color:#6b8a78;font-size:8px;margin-top:2px;font-style:italic;';
    estHint.textContent = 'Métricas locales · estimación ±15%';
    content.appendChild(estHint);
    overlay.appendChild(content);
    overlay.style.opacity = '1';
}

/**
 * Inyecta el texto optimizado de vuelta en el campo de texto del chat.
 * @param {string} newText - El texto optimizado
 * @param {object} stats - Estadísticas de ahorro
 * @param {string} [mode="compress"] - Modo de operación
 */
function injectOptimizedPrompt(newText, stats, mode = "compress") {
    hideOptimizeHint();
    setDismissedHintForText('');

    const inputs = getChatInputs();
    const targetEl = inputs.find(el => el === document.activeElement) || inputs[0];

    if (targetEl) {
        const currentText = targetEl.value !== undefined
            ? targetEl.value
            : (targetEl.innerText || targetEl.textContent || "");

        if (currentText && currentText.trim() !== newText.trim()) {
            getPromptHistory().push({ text: currentText, timestamp: Date.now() });
            if (getPromptHistory().length > getMAX_HISTORY()) getPromptHistory().shift();
        }

        if ((currentText || "").trim() !== (newText || "").trim()) {
            setSuppressNextScheduledProcess(true);
            if (targetEl.value !== undefined) {
                targetEl.value = newText;
                targetEl.dispatchEvent(new Event("input", { bubbles: true }));
            } else {
                targetEl.innerText = newText;
                targetEl.dispatchEvent(new InputEvent("input", { bubbles: true }));
            }
        }
    }

    if (stats) {
        const savedLabel = (stats.savedTokens > 0)
            ? `-${stats.savedTokens} tokens ahorrados`
            : "Prompt limpiado";
        console.log(`[IAndes] ✓ Optimización: ${savedLabel}`);
        persistSessionStats(stats, mode);

        const canRevert = getPromptHistory().length > 0;
        const overlay = getOrCreateOverlay(targetEl);
        [...overlay.childNodes].forEach(n => {
            if (n.id !== "iandes-toggle-row" && n.id !== "iandes-mode-buttons" && n.id !== "iandes-server-status") n.remove();
        });
        const msgDiv = document.createElement("div");
        msgDiv.innerHTML = `
            <div style="color:#00e696;font-size:10px;margin-bottom:4px;">✓ ${escapeHtml(savedLabel)}</div>
            ${canRevert ? `<button id="iandes-revert-btn" style="margin-top:4px;border:1px solid rgba(255,255,255,0.25);background:transparent;color:#d8e8df;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:10px;pointer-events:auto;">&#8634; Revertir</button>` : ""}
        `;
        overlay.appendChild(msgDiv);
        overlay.style.opacity = "1";

        const revertBtn = document.getElementById("iandes-revert-btn");
        if (revertBtn) {
            revertBtn.addEventListener("click", () => {
                const prev = getPromptHistory().pop();
                if (!prev) return;
                const inputs2 = getChatInputs();
                const el = inputs2.find(e => e === document.activeElement) || inputs2[0];
                if (el) {
                    setSuppressNextScheduledProcess(true);
                    if (el.value !== undefined) {
                        el.value = prev.text;
                        el.dispatchEvent(new Event("input", { bubbles: true }));
                    } else {
                        el.innerText = prev.text;
                        el.dispatchEvent(new InputEvent("input", { bubbles: true }));
                    }
                }
                renderOverlayInfo("Prompt revertido.");
                setTimeout(() => { if (window.__iandes) renderOverlay(window.__iandes); }, 2500);
            });
        }

        setTimeout(() => { if (window.__iandes) renderOverlay(window.__iandes); }, 3500);
    }
}

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

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}