# IAndes v5 — Sandbox Test Environment

Sandbox environment for testing the IAndes Chrome extension v5 without needing the full server or a browser extension context.

## Quick Start

### 1. Start the Mock Server

```bash
# Install dependencies (first time only)
pip install fastapi uvicorn

# Start the mock server
cd tests/sandbox
python test-server.py
```

The server starts at **http://localhost:8000** and provides:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check → `{status, version, models_loaded, spacy_ready, sentence_model_ready}` |
| `/optimize` | POST | Optimize a prompt → `OptimizationResult` (matches v2.0 schema) |
| `/` | GET | Server info |

### 2. Open the Test Page

Open `test-page.html` in a browser (Chrome recommended):

```bash
# Option A: Direct file open
start test-page.html

# Option B: Simple HTTP server
python -m http.server 8080
# Then open http://localhost:8080/test-page.html
```

### 3. Run Automated Tests

```bash
# Node.js (requires fetch — Node 18+)
node test-cases.js

# Or in the browser console:
IANDES_RUN_ALL_TESTS()
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  test-page.html                                             │
│  ┌─────────────────────┐  ┌──────────────────────────────┐ │
│  │  Chat Simulation     │  │  Results Panel                │ │
│  │  ┌─────────────────┐ │  │  ┌──────────────────────────┐ │ │
│  │  │ prompt-textarea │ │  │  │ Before/After comparison  │ │ │
│  │  └─────────────────┘ │  │  │ Segment annotations      │ │ │
│  │  [Comprimir][Mejorar]│  │  │ Savings metrics          │ │ │
│  │  [Optimizar]         │  │  │ Pipeline timing          │ │ │
│  │  Test case buttons   │  │  └──────────────────────────┘ │ │
│  └─────────────────────┘  └──────────────────────────────┘ │
│                                                             │
│  Mock Chrome APIs: chrome.storage.local, chrome.runtime.*    │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP POST /optimize
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  test-server.py (FastAPI)                                   │
│                                                             │
│  GET  /health → {"status":"ready","version":"5.0.0",...}   │
│  POST /optimize → OptimizationResult (mock)                 │
│                                                             │
│  Mock logic:                                                │
│   - Removes Spanish greetings/fillers (compress mode)       │
│   - Restructures prompts (enhance mode)                     │
│   - Generates segment annotations                           │
│   - Calculates token savings & environmental impact          │
│   - Simulates pipeline timing                               │
└─────────────────────────────────────────────────────────────┘
```

## Test Cases

| ID | Name | Input | Mode | What it tests |
|----|------|-------|------|----------------|
| TC-01 | Cortesía + pregunta sustancial | "Hola, me podrías ayudar haciendo un resumen..." | compress | Filler removal, intent preservation |
| TC-02 | Cortesía + solicitud vaga | "Hola buenas noches, me ayudas con un trabajo..." | compress | Greeting removal, courtesy cleanup |
| TC-03 | Código con backticks | `` ```python ... ``` Explícame... `` | compress | Code preservation, filler removal |
| TC-04 | Prompt corto | "Qué es Python?" | compress | Short prompt handling (minimal changes) |
| TC-05 | Preguntas múltiples | "¿Cuáles son las causas...? ¿Qué impacto...?" | compress | Multi-question, courtesy removal |
| TC-06 | Servidor no disponible | (any) | compress | Error handling when server is down |
| TC-07 | Comprimir vs Mejorar | "Hola, me podrías hacer un análisis detallado..." | compress + enhance | Mode comparison |

## Schema Reference

### Request: PromptAnalysis v2.0

```json
{
  "version": "2.0",
  "request_id": "uuid-v4",
  "raw_prompt": "string (1-8000 chars)",
  "mode": "compress | enhance",
  "preflight": {
    "intent": "code | qa | creative | general",
    "confidence": 0.0-1.0,
    "estimated_tokens": 0,
    "language": "es | en | unknown",
    "has_code_blocks": false,
    "paragraph_count": 1
  },
  "constraints": {
    "max_output_tokens": null,
    "preserve_entities": true,
    "quality_floor": 0.85
  },
  "metadata": {
    "source": "chatgpt | claude | gemini | unknown",
    "timestamp": 0
  }
}
```

### Response: OptimizationResult

```json
{
  "request_id": "uuid-v4",
  "server_version": "5.0.0-sandbox",
  "optimized_prompt": "string",
  "original_tokens": 0,
  "optimized_tokens": 0,
  "similarity_score": 0.0-1.0,
  "segments": [
    {
      "text": "string",
      "label": "intent | constraint | context_high | context_low | filler",
      "kept": true,
      "compression_ratio": 0.0-1.0
    }
  ],
  "savings": {
    "tokens_saved": 0,
    "co2_grams_saved": 0.0,
    "water_ml_saved": 0.0,
    "methodology_ref": "Patterson et al. (2021) · Li et al. (2023)"
  },
  "pipeline_ms": {
    "d1_verifier": 0,
    "d2_segmenter": 0,
    "d3_budget": 0,
    "d4_pruner": 0,
    "d5_validator": 0,
    "d6_rebuilder": 0,
    "total": 0
  },
  "quality_warning": false
}
```

## Mock Chrome APIs

The test page mocks the following Chrome extension APIs that the content scripts depend on:

- **`chrome.storage.local`** — Backed by `localStorage` for persistence across page reloads
- **`chrome.runtime.sendMessage`** — Routes messages to the sandbox handler which communicates with the mock server
- **`chrome.runtime.onMessage`** — Dispatches responses back to content script listeners
- **`chrome.runtime.id`** — Set to `'iandes-sandbox-mock'`
- **`chrome.tabs.sendMessage`** — Routes messages to content script listeners

## Simulating Server Errors

### Method 1: Test Case Button

Click the **"Servidor caído"** test case button. This temporarily overrides the server communication to simulate an unavailable server for 30 seconds.

### Method 2: Stop the Server

Simply stop the mock server (`Ctrl+C`) and try to optimize a prompt. The test page will show an error message.

### Method 3: Programmatic

```javascript
// In browser console:
simulateServerError();  // Overrides for 30 seconds
```

## CORS Configuration

The mock server allows requests from:

- `chrome-extension://*` — Chrome extension context
- `http://localhost:*` — Local development
- `http://127.0.0.1:*` — Alternative localhost
- `null` — `file://` protocol (direct file open)

## Files

| File | Purpose |
|------|---------|
| `test-page.html` | Browser-based test UI with mock Chrome APIs |
| `test-server.py` | FastAPI mock server matching OptimizationResult schema |
| `test-cases.js` | 7 test scenarios with assertions (Node.js + browser) |
| `README.md` | This file |