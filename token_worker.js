// Token Worker for IAndes
// Provides a lightweight token counting API to the content script.
// - Accepts messages { type: 'COUNT_TOKENS', id, text, model, provider }
// - Replies with { type: 'COUNT_RESULT', id, tokens, source }
// - Accepts optional loader: { type: 'LOAD_TIKTOKEN', scriptUrl, encoderUrl }

let tokenizer = null;
let hasTiktoken = false;

// Improved heuristic fallback (chars-based, detects code/JSON/spanish density)
function heuristicCount(text) {
    if (!text) return 0;
    try {
        const chars = text.length;
        const letters = (text.match(/\p{L}/gu) || []).length;
        const digits = (text.match(/\d/g) || []).length;
        const symbols = (text.match(/[^\p{L}\d\s]/gu) || []).length;
        const lines = text.split(/\r?\n/).length;
        const avgLineLen = chars / Math.max(1, lines);

        // Heurísticas de detección
        const looksLikeJSON = /\{\s*".+"\s*:/s.test(text) || /"[^"]+"\s*:\s*/.test(text);
        const codeIndicators = /\b(function|const|let|var|class|def|import|return)\b/.test(text) || /[{};<>=]/.test(text) || avgLineLen > 80;
        const accented = (text.match(/[\u00C0-\u017F]/g) || []).length;
        const accentedRatio = letters ? accented / letters : 0;

        // Factor base según tipo
        let factor = 4.0; // default: chars/4
        if (looksLikeJSON) factor = 3.0;
        else if (codeIndicators) factor = 3.2;
        else if (accentedRatio > 0.02) factor = 3.8; // likely Spanish-dense
        else if (letters / chars > 0.9) factor = 4.2; // simple prose

        // Conteo base por caracteres
        let tokens = chars / factor;

        // Ajustes: penalizar números (secuencias numéricas) y símbolos
        const numSeq = (text.match(/\d+/g) || []).length;
        tokens += numSeq * 1.2; // cada secuencia numérica suma ~1.2 tokens
        tokens += symbols * 0.6; // símbolos/puntuación suman ~0.6 tokens

        // Ajuste por líneas muy cortas (mucho formato/tablas) → más tokens
        if (avgLineLen < 20 && lines > 6) tokens *= 1.08;

        const guessed = Math.max(1, Math.round(tokens));
        return guessed;
    } catch (e) {
        return Math.max(1, text.split(/\s+/).filter(Boolean).length);
    }
}

async function countWithTiktoken(text, model) {
    try {
        if (!tokenizer) return heuristicCount(text);
        // tokenizer expected to expose encode/decode or encode method returning ints
        if (typeof tokenizer.encode === 'function') {
            const encoded = tokenizer.encode(text);
            return Array.isArray(encoded) ? encoded.length : encoded.length || heuristicCount(text);
        }
        if (typeof tokenizer.encodeInto === 'function') {
            const encoded = tokenizer.encodeInto(text);
            return encoded?.length ?? heuristicCount(text);
        }
        return heuristicCount(text);
    } catch (e) {
        return heuristicCount(text);
    }
}

self.addEventListener('message', async (ev) => {
    const msg = ev.data;
    if (!msg || !msg.type) return;

    if (msg.type === 'COUNT_TOKENS') {
        const { id, text, model } = msg;
        let tokens = 0;
        let source = 'worker_heuristic';
        if (hasTiktoken) {
            tokens = await countWithTiktoken(text, model);
            source = 'tiktoken_worker';
        } else {
            tokens = heuristicCount(text);
        }
        self.postMessage({ type: 'COUNT_RESULT', id, tokens, source });
        return;
    }

    if (msg.type === 'LOAD_TIKTOKEN') {
        // Optional: dynamic loader. Caller should provide a script that sets up `self.tiktoken` or similar.
        // Example: importScripts('tokenizer-shim.js') that sets `tokenizer` global.
        const { scriptUrl } = msg;
        if (!scriptUrl) {
            self.postMessage({ type: 'LOAD_RESULT', ok: false, reason: 'missing_scriptUrl' });
            return;
        }
        try {
            importScripts(scriptUrl);
            // Try to detect common globals
            if (self.tiktoken) {
                tokenizer = self.tiktoken;
                hasTiktoken = true;
            } else if (self.tokenizer) {
                tokenizer = self.tokenizer;
                hasTiktoken = true;
            }
            self.postMessage({ type: 'LOAD_RESULT', ok: !!hasTiktoken });
        } catch (e) {
            self.postMessage({ type: 'LOAD_RESULT', ok: false, reason: String(e) });
        }
        return;
    }
});

// Worker ready signal
// Global error handler to forward exceptions to the content script for debugging
self.addEventListener('error', (err) => {
    try {
        self.postMessage({ type: 'WORKER_ERROR', message: String(err && err.message), stack: err && err.error && err.error.stack });
    } catch (e) {}
});

// Ready
self.postMessage({ type: 'WORKER_READY' });
