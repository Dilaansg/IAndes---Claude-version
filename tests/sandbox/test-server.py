"""
IAndes v5 — Sandbox Mock Server
===============================

Minimal FastAPI server that mimics the IAndes optimization backend.
Returns mock OptimizationResult responses matching the v2.0 schema.

Usage:
    pip install fastapi uvicorn
    python test-server.py

    Server starts at http://localhost:8000
"""

import uuid
import time
import re
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Schemas — match iandes-server/schemas/ exactly
# ---------------------------------------------------------------------------

class ModeEnum(str):
    compress = "compress"
    enhance = "enhance"


class IntentEnum(str):
    code = "code"
    qa = "qa"
    creative = "creative"
    general = "general"


class PreflightInfo(BaseModel):
    intent: str = Field(default="general", description="Intent detectado")
    confidence: float = Field(default=0.50, ge=0.0, le=1.0)
    estimated_tokens: int = Field(default=0, ge=0)
    language: str = Field(default="unknown")
    has_code_blocks: bool = Field(default=False)
    paragraph_count: int = Field(default=1, ge=1)


class Constraints(BaseModel):
    max_output_tokens: Optional[int] = Field(default=None)
    preserve_entities: bool = Field(default=True)
    quality_floor: float = Field(default=0.85, ge=0.0, le=1.0)


class Metadata(BaseModel):
    source: str = Field(default="unknown")
    timestamp: int = Field(default=0)


class PromptAnalysis(BaseModel):
    """PromptAnalysis v2.0 — matches the server's request schema."""
    version: str = Field(default="2.0")
    request_id: str
    raw_prompt: str = Field(min_length=1, max_length=8000)
    mode: str = Field(default="compress")
    preflight: PreflightInfo = Field(default_factory=PreflightInfo)
    constraints: Constraints = Field(default_factory=Constraints)
    metadata: Metadata = Field(default_factory=Metadata)


class Segment(BaseModel):
    text: str = Field(description="Texto original del segmento")
    label: str = Field(description="Tipo: intent, constraint, context_high, context_low, filler")
    kept: bool = Field(description="Si el segmento se mantiene")
    compression_ratio: float = Field(ge=0.0, le=1.0, description="Ratio de compresión")


class Savings(BaseModel):
    tokens_saved: int = Field(description="Tokens ahorrados")
    co2_grams_saved: float = Field(description="CO₂ ahorrado en gramos")
    water_ml_saved: float = Field(description="Agua ahorrada en ml")
    methodology_ref: str = Field(description="Referencia académica")


class PipelineMs(BaseModel):
    d1_verifier: int = Field(description="ms en D1 Intent Verifier")
    d2_segmenter: int = Field(description="ms en D2 Semantic Segmenter")
    d3_budget: int = Field(description="ms en D3 Budget Controller")
    d4_pruner: int = Field(description="ms en D4 Token Pruner")
    d5_validator: int = Field(description="ms en D5 Coherence Validator")
    d6_rebuilder: int = Field(description="ms en D6 Rebuilder")
    total: int = Field(description="ms total del pipeline")


class OptimizationResult(BaseModel):
    """OptimizationResult — matches iandes-server/schemas/response.py exactly."""
    request_id: str = Field(description="UUID v4 de la request original")
    server_version: str = Field(description="Versión del servidor")
    optimized_prompt: str = Field(description="Prompt optimizado, listo para reinyectar")
    original_tokens: int = Field(description="Tokens del prompt original")
    optimized_tokens: int = Field(description="Tokens del prompt optimizado")
    similarity_score: float = Field(ge=0.0, le=1.0, description="Similitud coseno")
    segments: list[Segment] = Field(default_factory=list)
    savings: Savings = Field(description="Métricas de ahorro ambiental")
    pipeline_ms: PipelineMs = Field(description="Tiempos de ejecución del pipeline")
    quality_warning: bool = Field(default=False, description="True si quality_floor no se alcanzó")


# ---------------------------------------------------------------------------
# Mock optimization logic
# ---------------------------------------------------------------------------

# Courtesy patterns (Spanish)
GREETING_PATTERNS = [
    (r'^(?:hola[,\s]*)', 'Hola '),
    (r'^(?:buenos\s+d[ií]as[,\s]*)', ''),
    (r'^(?:buenas\s+tardes[,\s]*)', ''),
    (r'^(?:buenas\s+noches[,\s]*)', ''),
    (r'^(?:hey[,\s]*)', ''),
    (r'^(?:saludos[,\s]*)', ''),
]

FILLER_PATTERNS = [
    (r'\b(?:por\s+favor|porfa)\b', ''),
    (r'\b(?:podr[ií]as?\s+ayudarme\s+(?:con|en|a))\b', ''),
    (r'\b(?:me\s+podr[ií]as?\s+ayudar\s+(?:con|en|a))\b', ''),
    (r'\b(?:me\s+ayudas\s+(?:con|en|a))\b', ''),
    (r'\b(?:quisiera\s+que)\b', ''),
    (r'\b(?:te\s+agradecer[ií]a)\b', ''),
    (r'\b(?:de\s+forma\s+(?:muy\s+)?(?:detallada|exhaustiva|completa))\b', ''),
    (r'\b(?:paso\s+a\s+paso)\b', ''),
    (r'\b(?:y\s+con\s+ejemplos)\b', ''),
    (r',\s*gracias\.?$', '.'),
    (r'\s*gracias\s*$', ''),
]

ENHANCE_PATTERNS = [
    (r'^(.+)$', r'Estructura tu respuesta sobre: \1\n\nConsidera: claridad, precisión, y completitud.'),
]


def estimate_tokens(text: str) -> int:
    """Rough token estimation: ~3.8 chars per token for Spanish."""
    if not text:
        return 0
    return max(1, round(len(text) / 3.8))


def mock_optimize(prompt: str, mode: str = "compress") -> dict:
    """
    Apply mock optimization rules to simulate the server pipeline.
    Returns a dict matching OptimizationResult schema.
    """
    original = prompt.strip()
    original_tokens = estimate_tokens(original)

    if mode == "enhance":
        # Enhance mode: restructure and add clarity directives
        enhanced = original

        # Remove courtesy at start
        for pattern, replacement in GREETING_PATTERNS:
            enhanced = re.sub(pattern, replacement, enhanced, flags=re.IGNORECASE)

        # Add structure directive
        if not enhanced.startswith('Estructura'):
            enhanced = f"Estructura tu respuesta sobre: {enhanced.lstrip()}\n\nConsidera: claridad, precisión, y completitud."

        optimized = enhanced.strip()
        optimized_tokens = estimate_tokens(optimized)

        # Build segments for enhance mode
        segments = [
            Segment(text=original, label="intent", kept=True, compression_ratio=1.0),
        ]

        # Simulate pipeline timing
        d1 = 12
        d2 = 45
        d3 = 8
        d4 = 15
        d5 = 22
        d6 = 18
        total = d1 + d2 + d3 + d4 + d5 + d6

        tokens_saved = max(0, original_tokens - optimized_tokens) if optimized_tokens < original_tokens else 0

        return {
            "request_id": str(uuid.uuid4()),
            "server_version": "5.0.0-sandbox",
            "optimized_prompt": optimized,
            "original_tokens": original_tokens,
            "optimized_tokens": optimized_tokens,
            "similarity_score": 0.92,
            "segments": segments,
            "savings": {
                "tokens_saved": tokens_saved,
                "co2_grams_saved": round(tokens_saved * 0.0023, 4),
                "water_ml_saved": round(tokens_saved * 0.50, 2),
                "methodology_ref": "Patterson et al. (2021) · Li et al. (2023)",
            },
            "pipeline_ms": {
                "d1_verifier": d1,
                "d2_segmenter": d2,
                "d3_budget": d3,
                "d4_pruner": d4,
                "d5_validator": d5,
                "d6_rebuilder": d6,
                "total": total,
            },
            "quality_warning": False,
        }

    # --- Compress mode ---
    result = original
    segments = []

    # Detect segments (simplified mock)
    # 1. Greeting detection
    greeting_match = re.match(r'^(?:hola|buenos\s+d[ií]as|buenas\s+(?:tardes|noches)|hey|saludos)[,\s]*', result, re.IGNORECASE)
    if greeting_match:
        greeting_text = greeting_match.group(0).strip()
        segments.append(Segment(
            text=greeting_text,
            label="filler",
            kept=False,
            compression_ratio=0.0,
        ))
        result = re.sub(r'^(?:hola|buenos\s+d[ií]as|buenas\s+(?:tardes|noches)|hey|saludos)[,\s]*', '', result, flags=re.IGNORECASE)

    # 2. Courtesy/filler detection
    courtesy_patterns = [
        (r'\b(?:por\s+favor|porfa)\b', 'filler'),
        (r'\b(?:podr[ií]as?\s+ayudarme)\b', 'filler'),
        (r'\b(?:me\s+podr[ií]as?\s+ayudar)\b', 'filler'),
        (r'\b(?:me\s+ayudas)\b', 'filler'),
        (r'\b(?:quisiera\s+que)\b', 'filler'),
        (r'\b(?:te\s+agradecer[ií]a)\b', 'filler'),
        (r'\b(?:de\s+forma\s+(?:muy\s+)?(?:detallada|exhaustiva|completa))\b', 'filler'),
        (r'\b(?:paso\s+a\s+paso)\b', 'filler'),
        (r'\b(?:y\s+con\s+ejemplos)\b', 'filler'),
    ]

    for pattern, label in courtesy_patterns:
        match = re.search(pattern, result, re.IGNORECASE)
        if match:
            segments.append(Segment(
                text=match.group(0),
                label=label,
                kept=False,
                compression_ratio=0.0,
            ))
            result = re.sub(pattern, '', result, flags=re.IGNORECASE)

    # 3. Question marks → constraint
    if '?' in result:
        question_part = re.search(r'[^.!?]*\?', result)
        if question_part:
            segments.append(Segment(
                text=question_part.group(0).strip(),
                label="constraint",
                kept=True,
                compression_ratio=1.0,
            ))

    # 4. Core intent → intent segment
    core_text = result.strip().rstrip('.,;:!?').strip()
    if core_text:
        segments.append(Segment(
            text=core_text,
            label="intent",
            kept=True,
            compression_ratio=1.0,
        ))

    # Clean up result
    result = re.sub(r'\s+', ' ', result).strip()
    result = re.sub(r'^[,\s]+', '', result)
    result = re.sub(r'[,\s]+$', '', result)
    result = result.strip()

    # Safety: if result is too short, keep original
    if len(result.split()) < 3 and len(original.split()) > 5:
        result = original
        segments = [Segment(text=original, label="intent", kept=True, compression_ratio=1.0)]

    # If result is empty, keep original
    if not result.strip():
        result = original
        segments = [Segment(text=original, label="intent", kept=True, compression_ratio=1.0)]

    optimized_tokens = estimate_tokens(result)
    tokens_saved = max(0, original_tokens - optimized_tokens)

    # Calculate similarity (mock: higher when more tokens kept)
    similarity = 0.95 if tokens_saved < original_tokens * 0.3 else (0.88 if tokens_saved < original_tokens * 0.5 else 0.82)

    # Simulate pipeline timing
    d1 = 8 + len(original) // 50
    d2 = 25 + len(original) // 20
    d3 = 5 + len(original) // 100
    d4 = 12 + len(original) // 30
    d5 = 18 + len(original) // 40
    d6 = 10 + len(original) // 60
    total = d1 + d2 + d3 + d4 + d5 + d6

    quality_warning = similarity < 0.85

    return {
        "request_id": str(uuid.uuid4()),
        "server_version": "5.0.0-sandbox",
        "optimized_prompt": result,
        "original_tokens": original_tokens,
        "optimized_tokens": optimized_tokens,
        "similarity_score": similarity,
        "segments": segments,
        "savings": {
            "tokens_saved": tokens_saved,
            "co2_grams_saved": round(tokens_saved * 0.0023, 4),
            "water_ml_saved": round(tokens_saved * 0.50, 2),
            "methodology_ref": "Patterson et al. (2021) · Li et al. (2023)",
        },
        "pipeline_ms": {
            "d1_verifier": d1,
            "d2_segmenter": d2,
            "d3_budget": d3,
            "d4_pruner": d4,
            "d5_validator": d5,
            "d6_rebuilder": d6,
            "total": total,
        },
        "quality_warning": quality_warning,
    }


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="IAndes v5 Sandbox Mock Server",
    version="5.0.0-sandbox",
    description="Mock server for testing the IAndes Chrome extension v5",
)

# CORS — allow chrome-extension:// and localhost origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "chrome-extension://*",
        "http://localhost:*",
        "http://127.0.0.1:*",
        "http://localhost:8000",
        "http://localhost:3000",
        "http://localhost:5500",
        "null",  # file:// protocol
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    """Health check endpoint — matches the server's /health response."""
    return {
        "status": "ready",
        "version": "5.0.0",
        "models_loaded": True,
        "spacy_ready": True,
        "sentence_model_ready": True,
    }


@app.post("/optimize")
async def optimize_prompt(payload: PromptAnalysis):
    """
    Optimize a prompt — returns OptimizationResult matching the v2.0 schema.
    Simulates the full pipeline with mock logic.
    """
    # Validate prompt length
    if len(payload.raw_prompt) > 8000:
        raise HTTPException(status_code=413, detail="Prompt demasiado largo (máximo 8000 caracteres)")

    if not payload.raw_prompt.strip():
        raise HTTPException(status_code=400, detail="raw_prompt no puede estar vacío")

    # Simulate processing delay (50-200ms)
    import random
    time.sleep(random.uniform(0.05, 0.2))

    result = mock_optimize(payload.raw_prompt, payload.mode)

    # Override request_id with the one from the payload
    result["request_id"] = payload.request_id

    return result


@app.get("/")
async def root():
    """Root endpoint with server info."""
    return {
        "name": "IAndes v5 Sandbox Mock Server",
        "version": "5.0.0-sandbox",
        "endpoints": {
            "GET /health": "Health check",
            "POST /optimize": "Optimize a prompt (PromptAnalysis v2.0 → OptimizationResult)",
        },
    }


# ---------------------------------------------------------------------------
# Run server
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    print("=" * 60)
    print("  IAndes v5 — Sandbox Mock Server")
    print("  Starting at http://localhost:8000")
    print("=" * 60)
    uvicorn.run(app, host="0.0.0.0", port=8000)