/**
 * IAndes Server UI — Client-side logic
 * v5.0
 */

const API_BASE = `http://localhost:${window.location.port || 8000}`;

// --- Status Check ---
async function checkHealth() {
    const statusEl = document.getElementById('server-status');
    const spacyEl = document.getElementById('spacy-status');
    const minilmEl = document.getElementById('minilm-status');

    try {
        const resp = await fetch(`${API_BASE}/health`);
        const data = await resp.json();

        statusEl.textContent = data.status === 'ready' ? 'Activo' : 'Iniciando';
        statusEl.className = `status-value ${data.status === 'ready' ? 'ready' : 'checking'}`;

        spacyEl.textContent = data.spacy_ready ? '✓ Cargado' : '✗ No cargado';
        spacyEl.className = `status-value ${data.spacy_ready ? 'ready' : 'error'}`;

        minilmEl.textContent = data.sentence_model_ready ? '✓ Cargado' : '✗ No cargado';
        minilmEl.className = `status-value ${data.sentence_model_ready ? 'ready' : 'error'}`;
    } catch (e) {
        statusEl.textContent = 'No disponible';
        statusEl.className = 'status-value error';
        spacyEl.textContent = '—';
        spacyEl.className = 'status-value error';
        minilmEl.textContent = '—';
        minilmEl.className = 'status-value error';
    }
}

// --- Warmup Models ---
async function warmupModels() {
    const btn = document.getElementById('btn-warmup');
    btn.textContent = 'Cargando...';
    btn.disabled = true;

    try {
        // Send a simple request to trigger model loading
        const resp = await fetch(`${API_BASE}/health`);
        const data = await resp.json();

        if (data.models_loaded) {
            addLogEntry('SYSTEM', 'Modelos cargados correctamente', 's200');
        } else {
            addLogEntry('SYSTEM', 'Modelos aún cargándose...', 's4xx');
        }
    } catch (e) {
        addLogEntry('SYSTEM', `Error: ${e.message}`, 's5xx');
    }

    btn.textContent = 'Warmup Modelos';
    btn.disabled = false;
    checkHealth();
}

// --- Test Pipeline ---
async function testPipeline() {
    const btn = document.getElementById('btn-test');
    btn.textContent = 'Probando...';
    btn.disabled = true;

    const testPayload = {
        version: '2.0',
        request_id: crypto.randomUUID(),
        raw_prompt: 'Hola, por favor explícame cómo funciona la fotosíntesis de forma muy detallada. Muchas gracias.',
        mode: 'compress',
        preflight: {
            intent: 'qa',
            confidence: 0.75,
            estimated_tokens: 25,
            language: 'es',
            has_code_blocks: false,
            paragraph_count: 1,
        },
        constraints: {
            max_output_tokens: null,
            preserve_entities: true,
            quality_floor: 0.85,
        },
        metadata: {
            source: 'test-harness',
            timestamp: Math.floor(Date.now() / 1000),
        },
    };

    try {
        const startTime = performance.now();
        const resp = await fetch(`${API_BASE}/optimize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testPayload),
        });
        const elapsed = Math.round(performance.now() - startTime);

        const data = await resp.json();
        const statusClass = resp.ok ? 's200' : 's5xx';

        addLogEntry('POST', '/optimize', statusClass, elapsed, data);

        if (resp.ok) {
            addLogEntry('RESULT', `Tokens: ${data.original_tokens} → ${data.optimized_tokens} (${data.savings?.tokens_saved || 0} ahorrados)`, 's200');
        }
    } catch (e) {
        addLogEntry('ERROR', e.message, 's5xx');
    }

    btn.textContent = 'Test Pipeline';
    btn.disabled = false;
}

// --- Log ---
function addLogEntry(method, path, statusClass, ms, data) {
    const logContainer = document.getElementById('request-log');
    const emptyMsg = logContainer.querySelector('.log-empty');
    if (emptyMsg) emptyMsg.remove();

    const entry = document.createElement('div');
    entry.className = 'log-entry';

    const time = new Date().toLocaleTimeString('es-ES', { hour12: false });
    const methodClass = method === 'POST' ? 'POST' : method === 'GET' ? 'GET' : '';

    let html = `<span class="log-time">${time}</span>`;
    html += `<span class="log-method ${methodClass}">${method}</span>`;
    html += `<span class="log-path">${path}</span>`;

    if (statusClass) {
        html += `<span class="log-status ${statusClass}">${statusClass === 's200' ? '✓' : statusClass === 's4xx' ? '⚠' : '✗'}</span>`;
    }

    if (ms) {
        html += `<span class="log-ms">${ms}ms</span>`;
    }

    entry.innerHTML = html;
    logContainer.prepend(entry);

    // Keep only last 20 entries
    while (logContainer.children.length > 20) {
        logContainer.removeChild(logContainer.lastChild);
    }
}

// --- Init ---
document.getElementById('btn-warmup').addEventListener('click', warmupModels);
document.getElementById('btn-test').addEventListener('click', testPipeline);

// Check health every 5 seconds
checkHealth();
setInterval(checkHealth, 5000);