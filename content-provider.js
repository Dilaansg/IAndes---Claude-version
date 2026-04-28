// content-provider.js
// Detección del proveedor de chat y selectores de input
// ~100 líneas

/**
 * Lee la URL actual y determina en qué plataforma de chat está el usuario.
 *
 * @returns {ProviderInfo} Objeto con id, name, model del proveedor
 */
function detectProvider() {
    const url = window.location.hostname;

    if (url.includes("chat.openai.com") || url.includes("chatgpt.com")) {
        return { id: "chatgpt", name: "ChatGPT",   model: "gpt-4o" };
    }
    if (url.includes("claude.ai")) {
        return { id: "claude",  name: "Claude",    model: "claude-sonnet-4-6" };
    }
    if (url.includes("gemini.google.com")) {
        return { id: "gemini",  name: "Gemini",    model: "gemini-2.0-flash" };
    }

    // Si no reconocemos la URL, usamos ChatGPT/tiktoken como fallback
    console.warn("[IAndes] Proveedor no reconocido para:", url, "— usando ChatGPT como fallback");
    return { id: "chatgpt", name: "Chat desconocido", model: "gpt-4o" };
}

// INPUT_SELECTOR: selectores CSS para campos de chat
const INPUT_SELECTOR = [
    'textarea[data-id="root"]',
    'textarea[placeholder*="mensaje"]',
    'div[contenteditable="true"]',
    'textarea[data-clk]',
    'textarea[name="prompt"]',
    'textarea[aria-label*="prompt"]',
    'textarea',
    'div[contenteditable="true"]',
    'input[type="text"][contenteditable]',
].join(',');

/**
 * Detecta todos los campos de texto de chat en la página.
 * @returns {Element[]} Array de elementos input/textarea/contenteditable
 */
function getChatInputs() {
    try {
        return Array.from(document.querySelectorAll(INPUT_SELECTOR)).filter(el => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' &&
                   style.visibility !== 'hidden' &&
                   !el.disabled &&
                   el.offsetParent !== null;
        });
    } catch (e) {
        return [];
    }
}

// Detectar el proveedor una sola vez al cargar la página
const PROVIDER = detectProvider();
console.log(`[IAndes] Proveedor detectado: ${PROVIDER.name} (${PROVIDER.id})`);

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { detectProvider, INPUT_SELECTOR, getChatInputs, PROVIDER };
}
