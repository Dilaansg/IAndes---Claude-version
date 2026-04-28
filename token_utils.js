// token_utils.js
/**
 * Estima el número de tokens de un texto usando una heurística simple.
 *
 * Divide el texto en palabras y signos de puntuación y los cuenta.
 * NO es el conteo exacto de ningún modelo, pero sirve para dar una
 * respuesta INMEDIATA mientras esperamos al servidor.
 *
 * Error típico: ±15% respecto al conteo real.
 *
 * v5: El servidor hace su propio conteo exacto. Esta función se usa
 * solo para métricas locales en el overlay ANTES de enviar al servidor.
 * Las métricas DESPUÉS de optimizar vienen del servidor.
 */
function estimateTokens(text) {
    if (!text) return 0;
    try {
        const chars = text.length;
        const letters = (text.match(/\p{L}/gu) || []).length;
        const digits = (text.match(/\d/g) || []).length;
        const symbols = (text.match(/[^\p{L}\d\s]/gu) || []).length;
        const lines = text.split(/\r?\n/).length;
        const avgLineLen = chars / Math.max(1, lines);

        const looksLikeJSON = /\{\s*\".+\"\s*:/s.test(text) || /\"[^\"]+\"\s*:\s*/.test(text);
        const codeIndicators = /\b(function|const|let|var|class|def|import|return)\b/.test(text) || /[{};<>=]/.test(text) || avgLineLen > 80;
        const accented = (text.match(/[\u00C0-\u017F]/g) || []).length;
        const accentedRatio = letters ? accented / letters : 0;

        let factor = 4.0;
        if (looksLikeJSON) factor = 3.0;
        else if (codeIndicators) factor = 3.2;
        else if (accentedRatio > 0.02) factor = 3.8;
        else if (letters / chars > 0.9) factor = 4.2;

        let tokens = chars / factor;
        const numSeq = (text.match(/\d+/g) || []).length;
        tokens += numSeq * 1.2;
        tokens += symbols * 0.6;
        if (avgLineLen < 20 && lines > 6) tokens *= 1.08;

        return Math.max(1, Math.round(tokens));
    } catch (e) {
        return Math.max(1, text.split(/\s+/).filter(Boolean).length);
    }
}
