/**
 * preflight/payload-builder.js
 * Construcción de PromptAnalysis v2.0
 *
 * Genera el payload completo que se envía al servidor.
 */

/**
 * Genera un UUID v4 simple.
 * @returns {string} UUID v4
 */
function generateRequestId() {
    // crypto.randomUUID() está disponible en Service Workers
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback para contextos sin crypto.randomUUID
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

/**
 * Construye el payload PromptAnalysis v2.0 completo.
 * @param {object} params
 * @param {string} params.text - Texto del prompt
 * @param {string} params.mode - Modo: 'compress' o 'enhance'
 * @param {string} params.intent - Intent detectado por classifier
 * @param {number} params.confidence - Confianza del classifier
 * @param {string} params.language - Idioma detectado
 * @param {object} params.signals - Señales extraídas
 * @param {string} params.provider - Proveedor detectado (chatgpt, claude, gemini)
 * @returns {object} PromptAnalysis v2.0
 */
function buildPayload({ text, mode, intent, confidence, language, signals, provider }) {
    return {
        version: '2.0',
        request_id: generateRequestId(),
        raw_prompt: text.substring(0, 8000), // Límite duro
        mode: mode || 'compress',
        preflight: {
            intent: intent || 'general',
            confidence: confidence || 0.50,
            estimated_tokens: signals?.estimated_tokens || 0,
            language: language || 'unknown',
            has_code_blocks: signals?.has_code_blocks || false,
            paragraph_count: signals?.paragraph_count || 1,
        },
        constraints: {
            max_output_tokens: null,
            preserve_entities: true,
            quality_floor: 0.85,
        },
        metadata: {
            source: provider || 'unknown',
            timestamp: Math.floor(Date.now() / 1000),
        },
    };
}

// Export for Service Worker context
if (typeof self !== 'undefined') {
    self.buildPayload = buildPayload;
    self.generateRequestId = generateRequestId;
}

// Export for Node.js testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildPayload, generateRequestId };
}