"""
IAndes Server — FastAPI entrypoint
v5.0

Endpoints:
  GET  /           — UI del servidor
  GET  /health     — Estado del servidor y modelos
  POST /optimize   — Pipeline de optimización de prompts
"""

import time
import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from schemas.request import PromptAnalysis
from schemas.response import OptimizationResult, Segment, Savings, PipelineMs
from pipeline.verifier import verify_intent
from pipeline.segmenter import segment_prompt
from pipeline.budget import assign_budgets
from pipeline.pruner import prune_segments
from pipeline.validator import validate_coherence
from pipeline.rebuilder import rebuild_result
from impact.calculator import estimate_tokens, calculate_savings
from models.loader import get_models_status

logger = logging.getLogger("iandes-server")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")

app = FastAPI(
    title="IAndes Server",
    version="5.0.0",
    description="Servidor local de procesamiento para IAndes v5",
)

# CORS para extensiones Chrome
app.add_middleware(
    CORSMiddleware,
    allow_origins=["chrome-extension://*", "http://localhost:*"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)

# --- Servir UI ---
UI_DIR = Path(__file__).parent / "ui"


@app.get("/", response_class=HTMLResponse)
async def serve_ui():
    """Sirve la interfaz gráfica del servidor."""
    index_path = UI_DIR / "index.html"
    if index_path.exists():
        return HTMLResponse(content=index_path.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h1>IAndes Server v5.0</h1><p>UI no encontrada</p>")


@app.get("/health")
async def health():
    """Retorna el estado del servidor y los modelos cargados."""
    models = get_models_status()
    return {
        "status": "ready",
        "version": "5.0.0",
        "models_loaded": models["spacy_ready"] and models["sentence_model_ready"],
        "spacy_ready": models["spacy_ready"],
        "sentence_model_ready": models["sentence_model_ready"],
    }


@app.post("/optimize", response_model=OptimizationResult)
async def optimize(payload: PromptAnalysis):
    """
    Pipeline de optimización de prompts.

    Recibe PromptAnalysis v2.0, procesa a través de D1-D6,
    retorna OptimizationResult.
    """
    start_total = time.time()
    pipeline_ms = {}

    # --- D1: Intent Verifier ---
    start_d1 = time.time()
    verified = verify_intent(payload)
    pipeline_ms["d1_verifier"] = int((time.time() - start_d1) * 1000)

    # --- D2: Semantic Segmenter ---
    start_d2 = time.time()
    segments = segment_prompt(
        text=payload.raw_prompt,
        verified_intent=verified["verified_intent"],
        paragraph_count=payload.preflight.paragraph_count,
    )
    pipeline_ms["d2_segmenter"] = int((time.time() - start_d2) * 1000)

    # --- D3: Budget Controller ---
    start_d3 = time.time()
    segments_with_budget = assign_budgets(
        segments=segments,
        max_output_tokens=payload.constraints.max_output_tokens,
    )
    pipeline_ms["d3_budget"] = int((time.time() - start_d3) * 1000)

    # --- D4: Token Pruner ---
    start_d4 = time.time()
    segments_pruned = prune_segments(
        segments_with_budget,
        preserve_entities=payload.constraints.preserve_entities,
    )
    pipeline_ms["d4_pruner"] = int((time.time() - start_d4) * 1000)

    # --- D5: Coherence Validator ---
    start_d5 = time.time()
    # Reconstruir texto optimizado provisional para validar
    kept_segments = [s for s in segments_pruned if s.get("kept", True)]
    provisional_text = " ".join(
        s.get("text_compressed", s.get("text", "")) for s in kept_segments
    ).strip() or payload.raw_prompt

    validation = validate_coherence(
        original_text=payload.raw_prompt,
        optimized_text=provisional_text,
        quality_floor=payload.constraints.quality_floor,
        segments=segments_pruned,
    )
    # Si hubo rollback, usar los segmentos modificados
    if validation.get("segments"):
        segments_pruned = validation["segments"]
    pipeline_ms["d5_validator"] = int((time.time() - start_d5) * 1000)

    # --- D6: Rebuilder ---
    start_d6 = time.time()
    original_tokens = estimate_tokens(payload.raw_prompt)
    result = rebuild_result(
        original_text=payload.raw_prompt,
        segments=segments_pruned,
        original_tokens=original_tokens,
        pipeline_ms=pipeline_ms,
        request_id=payload.request_id,
    )
    pipeline_ms["d6_rebuilder"] = int((time.time() - start_d6) * 1000)

    # Agregar información de validación
    result["similarity_score"] = validation["similarity_score"]
    result["quality_warning"] = validation["quality_warning"]

    pipeline_ms["total"] = int((time.time() - start_total) * 1000)
    result["pipeline_ms"] = pipeline_ms

    logger.info(
        f"Optimize: {payload.request_id[:8]}... | "
        f"intent={verified['verified_intent']}({verified['verification_source']}) | "
        f"tokens={original_tokens}→{result['optimized_tokens']} | "
        f"total={pipeline_ms['total']}ms"
    )

    return OptimizationResult(**result)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Manejo global de errores."""
    logger.error(f"Error no manejado: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "type": type(exc).__name__},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)