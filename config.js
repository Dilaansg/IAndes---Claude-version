// config.js
// Configuración crítica centralizada para IAndes v5
// NOTA: Usa self.X en lugar de export para compatibilidad con importScripts()
//
// CAMBIOS v5:
// - Eliminada config de Ollama, ONNX, Transformers.js (movido al servidor)
// - Agregada config del servidor local
// - Actualizadas fórmulas de impacto ambiental (Patterson/Li)

/**
 * Configuración del servidor local IAndes v5
 */
self.IANDES_SERVER_BASE = "http://localhost:8000";
self.IANDES_SERVER_TIMEOUT_MS = 2000;      // Timeout para requests al servidor
self.IANDES_SERVER_HEALTH_INTERVAL_MS = 5000; // Health check cada 5s
self.IANDES_SERVER_MAX_RETRIES = 3;         // Reintentos con backoff exponencial
self.IANDES_SERVER_INITIAL_BACKOFF_MS = 500; // Backoff inicial entre reintentos

/**
 * Configuración de content.js
 */
self.CONTENT_CONFIG = {
    debounceMs:      1500,    // Esperar 1.5s después de que el usuario deja de escribir
    overlayId:       "iandes-overlay",
    localOnlyMode:    false,   // Si true: solo métricas locales, sin servidor
};

// Alias global para acceso directo
self.CONFIG = self.CONTENT_CONFIG;

// ID del hint de optimización
self.OPTIMIZE_HINT_ID = "iandes-optimize-hint";

/**
 * Constantes de estimación ambiental local
 * Fuentes actualizadas (v5):
 *   CO₂: Patterson et al. (2021) "Carbon Footprint of Machine Learning"
 *   Agua: Li et al. (2023) "Making AI Less Thirsty"
 */
self.WATER_ML_PER_TOKEN = 0.50;     // ml por token (Li et al. 2023)
self.CO2_G_PER_TOKEN    = 0.0023;   // gramos por token (Patterson et al. 2021)

self.MODEL_ENV_SCALE = {
    "gpt-4o":               1.0,
    "gpt-4":                1.8,
    "gpt-3.5-turbo":        0.4,
    "claude-opus-4-6":      1.8,
    "claude-sonnet-4-6":     1.0,
    "claude-haiku-4-5":      0.3,
    "gemini-2.0-flash":     0.4,
    "gemini-1.5-pro":        1.2,
    "gemini-1.5-flash":      0.4,
};

/**
 * Referencias académicas para las fórmulas de impacto ambiental
 * Se incluyen en el response del servidor y se pueden mostrar en la UI
 */
self.ENV_METHODOLOGY = {
    co2: "Patterson et al. (2021) - Carbon Footprint of Machine Learning",
    water: "Li et al. (2023) - Making AI Less Thirsty",
};

/**
 * Modos soportados por la extensión v5
 * Nota: "structure" queda reservado para v5.1+
 */
self.SUPPORTED_MODES = ["compress", "enhance"];