// error_utils.js
// Contrato unificado de errores para IAndes

/**
 * Códigos de error estandarizados
 */
const ErrorCodes = {
    // Errores de infraestructura
    SERVER_ERROR: 'SERVER_ERROR',      // Error en comunicación con servidor local
    WORKER_ERROR: 'WORKER_ERROR',      // Error en worker (deshabilitado en v5)
    MESSAGE_ERROR: 'MESSAGE_ERROR',    // Error en comunicación entre componentes
    
    // Errores de aplicación
    VALIDATION_ERROR: 'VALIDATION_ERROR',    // Error de validación de datos
    NETWORK_ERROR: 'NETWORK_ERROR',          // Error de red/permisos
    SECURITY_ERROR: 'SECURITY_ERROR',        // Error de seguridad/CSP
    UNKNOWN_ERROR: 'UNKNOWN_ERROR',          // Error no clasificado
};

/**
 * Niveles de severidad
 */
const Severity = {
    CRITICAL: 'CRITICAL',    // Fallo que impide funcionamiento
    HIGH: 'HIGH',            // Fallo que degrada funcionalidad
    MEDIUM: 'MEDIUM',        // Fallo con impacto limitado
    LOW: 'LOW',              // Fallo cosmético o informativo
};

/**
 * Crea un objeto de error estructurado
 * @param {string} code - Código de error (de ErrorCodes)
 * @param {string} message - Mensaje descriptivo del error
 * @param {Error|string} originalError - Error original o mensaje
 * @param {string} component - Componente donde ocurrió el error
 * @param {string} severity - Severidad (de Severity)
 * @param {Object} context - Contexto adicional
 * @returns {Object} Error estructurado
 */
function createStructuredError({
    code,
    message,
    originalError,
    component,
    severity = Severity.MEDIUM,
    context = {}
}) {
    const errorObj = {
        code,
        message,
        severity,
        component,
        timestamp: new Date().toISOString(),
        context: {
            ...context,
            originalMessage: originalError?.message || String(originalError || ''),
            stack: originalError?.stack
        }
    };
    
    // Log según severidad
    const logLevel = {
        [Severity.CRITICAL]: console.error,
        [Severity.HIGH]: console.error,
        [Severity.MEDIUM]: console.warn,
        [Severity.LOW]: console.info
    }[severity] || console.warn;
    
    logLevel(`[IAndes] ${code} (${severity}) in ${component}: ${message}`, errorObj);
    
    return errorObj;
}

/**
 * Maneja un error con degradación segura (fail-open)
 * @param {Function} operation - Operación que puede fallar
 * @param {Object} options - Opciones de manejo
 * @param {*} fallbackValue - Valor de fallback a retornar
 * @param {string} component - Componente donde ocurre la operación
 * @param {string} errorCode - Código de error a usar
 * @param {string} severity - Severidad del error
 * @returns {*} Resultado de la operación o fallbackValue
 */
function safeExecute(operation, {
    component = 'unknown',
    errorCode = ErrorCodes.UNKNOWN_ERROR,
    severity = Severity.MEDIUM,
    fallbackValue = null,
    context = {}
} = {}) {
    try {
        return typeof operation === 'function' ? operation() : operation;
    } catch (error) {
        createStructuredError({
            code: errorCode,
            message: `Error en ${component}: ${error?.message || 'Error desconocido'}`,
            originalError: error,
            component,
            severity,
            context
        });
        
        // Degradación segura: retornar valor de fallback
        return fallbackValue;
    }
}

/**
 * Maneja errores en promesas con degradación segura
 * @param {Promise} promise - Promesa a manejar
 * @param {Object} options - Opciones de manejo
 * @returns {Promise} Promesa que siempre resuelve
 */
async function safePromise(promise, {
    component = 'unknown',
    errorCode = ErrorCodes.UNKNOWN_ERROR,
    severity = Severity.MEDIUM,
    fallbackValue = null,
    context = {}
} = {}) {
    try {
        return await promise;
    } catch (error) {
        createStructuredError({
            code: errorCode,
            message: `Error en promesa ${component}: ${error?.message || 'Error desconocido'}`,
            originalError: error,
            component,
            severity,
            context
        });
        
        return fallbackValue;
    }
}

/**
 * Verifica si hay un error de contexto invalidado (extensión recargada)
 * @param {Error|string} error - Error a verificar
 * @returns {boolean} True si es error de contexto invalidado
 */
function isContextInvalidatedError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('invalidated') || 
           message.includes('context') ||
           message.includes('extension context');
}

// Exportar para uso en otros módulos
if (typeof module !== 'undefined' && module.exports) {
    // Node.js/CommonJS
    module.exports = {
        ErrorCodes,
        Severity,
        createStructuredError,
        safeExecute,
        safePromise,
        isContextInvalidatedError
    };
} else {
    // Browser/Extension (incluyendo Service Workers)
    self.IAndesErrors = {
        ErrorCodes,
        Severity,
        createStructuredError,
        safeExecute,
        safePromise,
        isContextInvalidatedError
    };
}