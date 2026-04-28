/**
 * preflight/classifier.js
 * Intent Classifier determinista para Zona B
 *
 * Evalúa el texto contra grupos de señales léxicas en orden de prioridad.
 * La primera coincidencia con ≥2 señales del mismo grupo gana.
 *
 * Grupos: code, qa, creative, general
 * Condición especial: long_context (tokens > 800) → confianza 0.90
 */

const INTENT_GROUPS = {
    code: {
        signals: [
            /```/,
            /\b(function|const|let|var|class |def |import |SELECT |FROM |WHERE )\b/i,
            /\b(bug|error|exception|refactor)\b/i,
            /[{};\[\]]/,
        ],
        minSignals: 2,
        confidence: 0.75,
    },
    qa: {
        signals: [
            /^(qué|que|cómo|como|cuál|cuándo|por qué|what|how|why|when)\b/i,
            /\b(explica|explain|define|describe|resume|summarize)\b/i,
            /\?/,
        ],
        minSignals: 2,
        confidence: 0.75,
    },
    creative: {
        signals: [
            /\b(escribe|redacta|genera|crea|elabora|write|generate|create|draft|compose)\b/i,
            /\b(historia|cuento|poema|ensayo|carta|email|story|poem|essay)\b/i,
        ],
        minSignals: 2,
        confidence: 0.75,
    },
};

const LONG_CONTEXT_TOKEN_THRESHOLD = 800;
const LONG_CONTEXT_CONFIDENCE = 0.90;
const SINGLE_SIGNAL_CONFIDENCE = 0.60;
const FALLBACK_CONFIDENCE = 0.50;

/**
 * Clasifica el intent del prompt.
 * @param {string} text - Texto del prompt
 * @param {number} estimatedTokens - Tokens estimados
 * @returns {{intent: string, confidence: number}}
 */
function classifyIntent(text, estimatedTokens) {
    if (!text || typeof text !== 'string') {
        return { intent: 'general', confidence: FALLBACK_CONFIDENCE };
    }

    // Condición especial: long_context
    if (estimatedTokens > LONG_CONTEXT_TOKEN_THRESHOLD) {
        return { intent: 'general', confidence: LONG_CONTEXT_CONFIDENCE };
    }

    // Evaluar grupos en orden de prioridad
    for (const [intent, group] of Object.entries(INTENT_GROUPS)) {
        let matchCount = 0;
        for (const pattern of group.signals) {
            if (pattern.test(text)) {
                matchCount++;
            }
        }

        if (matchCount >= group.minSignals) {
            return { intent, confidence: group.confidence };
        }

        if (matchCount === 1) {
            return { intent, confidence: SINGLE_SIGNAL_CONFIDENCE };
        }
    }

    // Fallback
    return { intent: 'general', confidence: FALLBACK_CONFIDENCE };
}

// Export for Service Worker context
if (typeof self !== 'undefined') {
    self.classifyIntent = classifyIntent;
}

// Export for Node.js testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { classifyIntent, INTENT_GROUPS };
}