/**
 * preflight/signal-extractor.js
 * Extracción de señales estructurales del prompt
 *
 * Extrae: has_code_blocks, paragraph_count, estimated_tokens
 */

/**
 * Detecta si el prompt contiene bloques de código.
 * @param {string} text - Texto del prompt
 * @returns {boolean} True si contiene bloques de código
 */
function hasCodeBlocks(text) {
    if (!text || typeof text !== 'string') return false;
    // Backticks (```), o palabras reservadas de código
    return /```/.test(text) || /\b(function|const|let|var|class |def |import |SELECT |FROM |WHERE )\b/i.test(text);
}

/**
 * Cuenta el número de párrafos del prompt.
 * @param {string} text - Texto del prompt
 * @returns {number} Número de párrafos (mínimo 1)
 */
function countParagraphs(text) {
    if (!text || typeof text !== 'string') return 1;
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);
    return Math.max(1, paragraphs.length);
}

/**
 * Extrae señales estructurales del prompt.
 * @param {string} text - Texto del prompt
 * @param {number} estimatedTokens - Tokens estimados (de Zona A)
 * @returns {{has_code_blocks: boolean, paragraph_count: number, estimated_tokens: number}}
 */
function extractSignals(text, estimatedTokens) {
    return {
        has_code_blocks: hasCodeBlocks(text),
        paragraph_count: countParagraphs(text),
        estimated_tokens: estimatedTokens || 0,
    };
}

// Export for Service Worker context
if (typeof self !== 'undefined') {
    self.extractSignals = extractSignals;
}

// Export for Node.js testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { hasCodeBlocks, countParagraphs, extractSignals };
}