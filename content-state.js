// content-state.js
// Estado centralizado para content scripts
// ~80 líneas

// Estado de la extensión
let extensionEnabled = true;
chrome.storage.local.get(["extensionEnabled"], (res) => {
    if (chrome.runtime.lastError) return;
    if (typeof res?.extensionEnabled === "boolean") extensionEnabled = res.extensionEnabled;
});

// Historial de prompts para revertir
const promptHistory = [];
const MAX_HISTORY = 5;

// Variables de tracking
let textoTemporal = "";
let lastProcessedPrompt = "";
let lastProcessedAt = 0;
let suppressNextScheduledProcess = false;
let dismissedHintForText = "";
let pendingOptimizeContext = null;
let ignoreInputBlurUntil = 0;
let optimizationTimeoutId = null;
let optimizationReqId = 1;
const pendingOptimizations = new Map();

// Getters y setters para el estado
function getExtensionEnabled() { return extensionEnabled; }
function setExtensionEnabled(v) { extensionEnabled = v; }

function getTextoTemporal() { return textoTemporal; }
function setTextoTemporal(v) { textoTemporal = v; }

function getPromptHistory() { return promptHistory; }
function getMAX_HISTORY() { return MAX_HISTORY; }

function getSuppressNextScheduledProcess() { return suppressNextScheduledProcess; }
function setSuppressNextScheduledProcess(v) { suppressNextScheduledProcess = v; }

function getDismissedHintForText() { return dismissedHintForText; }
function setDismissedHintForText(v) { dismissedHintForText = v; }

function getOptimizationTimeoutId() { return optimizationTimeoutId; }
function setOptimizationTimeoutId(v) { optimizationTimeoutId = v; }

function getOptimizationReqId() { return optimizationReqId; }
function incrementOptimizationReqId() { return optimizationReqId++; }

function getPendingOptimizations() { return pendingOptimizations; }

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getExtensionEnabled, setExtensionEnabled,
        getTextoTemporal, setTextoTemporal,
        getPromptHistory, getMAX_HISTORY,
        getSuppressNextScheduledProcess, setSuppressNextScheduledProcess,
        getDismissedHintForText, setDismissedHintForText,
        getOptimizationTimeoutId, setOptimizationTimeoutId,
        getOptimizationReqId, incrementOptimizationReqId,
        getPendingOptimizations
    };
}
