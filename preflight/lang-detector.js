/**
 * preflight/lang-detector.js
 * Detección de idioma por trigramas de caracteres
 *
 * Solo distingue: es (español), en (inglés), unknown
 * Sin librerías externas. Tabla de trigramas en memoria.
 */

// Trigramas más comunes en español
const ES_TRIGRAMS = new Set([
    'que', 'de ', ' la', 'ent', 'ció', 'ión', 'con', 'aci', 'par', 'los',
    'las', 'ent', 'por', 'un ', 'ado', 'est', 'ien', 's d', 'a l', 'o d',
    'ent', 'ent', 'ici', 's y', 'ent', 'ble', 'dad', 'ent', 'nte', 'men',
    'tra', 'com', 'pod', 'nec', 'exp', 'res', 'per', 'hab', 'alg', 'sin',
]);

// Trigramas más comunes en inglés
const EN_TRIGRAMS = new Set([
    ' th', 'the', 'he ', 'in ', 'ion', 'tio', 'ent', 'ati', 'for', 'and',
    ' of', 'to ', 'is ', 'ing', ' a ', 'hat', 'her', 'ere', 'ate', 'ave',
    'ith', 'ter', 'ght', 'not', 'out', 'ave', 'ble', 'all', 'ould', 'igh',
    'eas', 'ver', 'ome', 'uld', 'hin', 'ust', 'eas', 'thin', 'more', 'can',
]);

/**
 * Detecta el idioma del texto.
 * @param {string} text - Texto a analizar
 * @returns {'es'|'en'|'unknown'} Idioma detectado
 */
function detectLanguage(text) {
    if (!text || typeof text !== 'string' || text.length < 10) {
        return 'unknown';
    }

    const normalized = text.toLowerCase().replace(/[^a-záéíóúñü ]/g, '');
    const trigrams = extractTrigrams(normalized);

    let esScore = 0;
    let enScore = 0;

    for (const tri of trigrams) {
        if (ES_TRIGRAMS.has(tri)) esScore++;
        if (EN_TRIGRAMS.has(tri)) enScore++;
    }

    if (esScore === 0 && enScore === 0) return 'unknown';
    if (esScore > enScore * 1.2) return 'es';
    if (enScore > esScore * 1.2) return 'en';
    return 'unknown';
}

/**
 * Extrae trigramas de un texto.
 * @param {string} text - Texto normalizado
 * @returns {Set<string>} Conjunto de trigramas
 */
function extractTrigrams(text) {
    const trigrams = new Set();
    for (let i = 0; i <= text.length - 3; i++) {
        trigrams.add(text.substring(i, i + 3));
    }
    return trigrams;
}

// Export for Service Worker context
if (typeof self !== 'undefined') {
    self.detectLanguage = detectLanguage;
}

// Export for Node.js testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { detectLanguage, extractTrigrams, ES_TRIGRAMS, EN_TRIGRAMS };
}