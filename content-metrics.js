// content-metrics.js
// Cálculo de impacto ambiental local y rendering de métricas en overlay
// ~150 líneas

// Configuración importada desde config.js (v5: Patterson/Li)
// Fallbacks con valores v5 en caso de que config.js no se haya cargado
const WATER_ML_PER_TOKEN = self.WATER_ML_PER_TOKEN ?? 0.50;    // Li et al. 2023
const CO2_G_PER_TOKEN    = self.CO2_G_PER_TOKEN ?? 0.0023;     // Patterson et al. 2021

const MODEL_ENV_SCALE = self.MODEL_ENV_SCALE ?? {
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

/**
 * Infiere el factor de escala ambiental de un modelo.
 * @param {string} model - Nombre del modelo
 * @returns {number} Factor de escala (1.0 = baseline)
 */
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

/**
 * Calcula el impacto ambiental local en base a tokens estimados.
 * @param {number} promptTokens - Tokens del prompt
 * @param {string} model - Nombre del modelo
 * @returns {EnvironmentalImpact} Objeto con métricas ambientales
 */
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

/**
 * Escapa caracteres HTML especiales para prevenir XSS.
 * @param {string} str - Texto a escapar
 * @returns {string} Texto escapado
 */
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

/**
 * Renderiza información simple en el overlay (mensaje informativo).
 * @param {string} message - Mensaje a mostrar
 * @param {Element} [inputEl] - Elemento input para posicionamiento
 */
function renderOverlayInfo(message, inputEl = null) {
    const overlay = getOrCreateOverlay(inputEl);
    [...overlay.childNodes].forEach(n => { if (n.id !== 'iandes-toggle-row' && n.id !== 'iandes-mode-buttons') n.remove(); });
    const msgDiv = document.createElement('div');
    msgDiv.style.cssText = 'color:#f0d78c;font-size:11px;margin-top:4px;';
    msgDiv.textContent = message;
    overlay.appendChild(msgDiv);
    overlay.style.opacity = '1';
}

/**
 * Renderiza mensaje de error en el overlay.
 * @param {string} message - Mensaje de error
 * @param {Element} [inputEl] - Elemento input para posicionamiento
 */
function renderOverlayError(message, inputEl = null) {
    const overlay = getOrCreateOverlay(inputEl);
    [...overlay.childNodes].forEach(n => { if (n.id !== 'iandes-toggle-row' && n.id !== 'iandes-mode-buttons') n.remove(); });
    const msgDiv = document.createElement('div');
    msgDiv.style.cssText = 'color:#ff6b6b;font-size:11px;margin-top:4px;';
    msgDiv.textContent = message;
    overlay.appendChild(msgDiv);
    overlay.style.opacity = '1';
}

/**
 * Renderiza mensaje de éxito en el overlay.
 * @param {string} message - Mensaje de éxito
 * @param {Element} [inputEl] - Elemento input para posicionamiento
 */
function renderOverlaySuccess(message, inputEl = null) {
    const overlay = getOrCreateOverlay(inputEl);
    [...overlay.childNodes].forEach(n => { if (n.id !== 'iandes-toggle-row' && n.id !== 'iandes-mode-buttons') n.remove(); });
    const msgDiv = document.createElement('div');
    msgDiv.style.cssText = 'color:#00e696;font-size:11px;margin-top:4px;';
    msgDiv.textContent = message;
    overlay.appendChild(msgDiv);
    overlay.style.opacity = '1';
}

/**
 * Renderiza métricas completas en el overlay.
 * v5: Las métricas locales son estimadas (±15%). Las métricas exactas
 * vienen del servidor después de optimizar.
 * @param {Object} data - Datos con metrics {tokens, env}
 * @param {Element} [inputEl] - Elemento input para posicionamiento
 */
function renderOverlay(data, inputEl = null) {
    if (!data || !data.metrics) return;
    const overlay = getOrCreateOverlay(inputEl);
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
    const estHint = document.createElement('div');
    estHint.style.cssText = 'color:#6b8a78;font-size:8px;margin-top:2px;font-style:italic;';
    estHint.textContent = 'Métricas locales · estimación ±15%';
    content.appendChild(estHint);
    overlay.appendChild(content);
    overlay.style.opacity = '1';
}

/**
 * Actualiza solo las métricas sin procesar el prompt.
 * @param {Element} el - Campo de texto
 */
async function updateMetricsOnly(el) {
    const text = el.value !== undefined ? el.value : (el.innerText || el.textContent || '');
    if (!text.trim()) { const overlay = document.getElementById(CONFIG?.overlayId || 'iandes-overlay'); if (overlay) overlay.style.opacity = '0'; return; }
    try {
        const { tokens } = await countTokensWithWorker(text, PROVIDER.model);
        const env = computeEnvironmentalImpactLocal(tokens, PROVIDER.model);
        window.__iandes = { metrics: { tokens, env } };
        renderOverlay(window.__iandes, el);
    } catch (e) { console.warn('[IAndes] Error en updateMetricsOnly:', e); }
}

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        inferModelScale,
        computeEnvironmentalImpactLocal,
        escapeHtml,
        renderOverlayInfo,
        renderOverlayError,
        renderOverlaySuccess,
        renderOverlay,
        updateMetricsOnly,
        WATER_ML_PER_TOKEN,
        CO2_G_PER_TOKEN,
        MODEL_ENV_SCALE
    };
}
