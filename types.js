// types.js
// Schema definitions for IAndes v5 data contracts

/**
 * @typedef {Object} PromptAnalysis
 * @property {string} original         - Texto original sin modificar
 * @property {string} intent           - 'code'|'qa'|'creative'|'general'|'long_context'
 * @property {number} confidence       - Confianza del intent classifier (0-1)
 * @property {string} language         - Idioma detectado: 'es'|'en'|'unknown'
 * @property {Object} segments         - Segmentos semánticos del prompt
 * @property {string[]} layers         - Capas a activar (v5: siempre ['server'])
 * @property {string} profile          - Perfil (deshabilitado en v5 — se usa preflight en SW)
 * @property {boolean} hasCode         - ¿El texto contiene código?
 * @property {boolean} hasCourtesy     - ¿El texto contiene cortesía?
 * @property {number} wordCount        - Palabras en el texto original
 */

/**
 * @typedef {Object} ProviderInfo
 * @property {string} id    - Identificador interno: "chatgpt", "claude", "gemini"
 * @property {string} name  - Nombre legible para el usuario
 * @property {string} model - Modelo predeterminado de esa plataforma
 */

/**
 * @typedef {Object} EnvironmentalImpact
 * @property {number} completion_est  - Tokens de completación estimados
 * @property {number} tokens_total    - Total de tokens (prompt + completion)
 * @property {number} water_ml        - Agua en ml (Li et al. 2023: 0.50ml/token)
 * @property {number} water_drops     - Agua en gotas (0.05ml por gota)
 * @property {number} co2_g           - CO2 en gramos (Patterson et al. 2021: 0.0023g/token)
 * @property {number} model_scale     - Factor de escala del modelo
 */

/**
 * @typedef {Object} Layer1Result
 * @property {string} text              - Texto después de aplicar Capa 1
 * @property {number} savedTokens       - Tokens ahorrados
 * @property {Array<{id: string, label: string, scope: string}>} matchedRules - Reglas aplicadas
 * @property {string[]} matchedFragments - Fragmentos eliminados
 * @property {boolean} rollback          - Si hubo rollback por seguridad
 * @property {string} [rollbackReason]  - Razón del rollback si ocurrió
 */

/**
 * @typedef {Object} OptimizationStats
 * @property {number} originalTokens    - Tokens originales
 * @property {number} optimizedTokens   - Tokens optimizados
 * @property {string[]} layers          - Capas activadas (v5: ['server'])
 * @property {number} [savedTokens]     - Tokens ahorrados
 * @property {number} [savedPct]        - Porcentaje de ahorro
 * @property {number} [similarityScore] - Similitud semántica (0-1)
 * @property {boolean} [qualityWarning] - Si la calidad está por debajo del umbral
 * @property {Array} [segments]         - Segmentos con anotaciones
 * @property {Object} [savings]          - Ahorro ambiental {co2_grams_saved, water_ml_saved}
 */

// Export for Node.js testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PromptAnalysis, ProviderInfo, EnvironmentalImpact, Layer1Result, OptimizationStats };
}
