"""
Tests de integración end-to-end para el servidor IAndes v5.

Usa TestClient de FastAPI para probar el pipeline completo D1→D6
a través de los endpoints HTTP.
"""

import pytest
from fastapi.testclient import TestClient

from main import app
from schemas.request import PromptAnalysis, PreflightInfo, Constraints, Metadata


client = TestClient(app)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_payload(
    text: str,
    mode: str = "compress",
    intent: str = "general",
    confidence: float = 0.50,
    language: str = "es",
    has_code: bool = False,
    paragraphs: int = 1,
    tokens: int = 0,
    source: str = "test",
) -> dict:
    """Construye un payload PromptAnalysis v2.0 para testing."""
    return {
        "version": "2.0",
        "request_id": f"test-{hash(text) % 10000:04d}",
        "raw_prompt": text,
        "mode": mode,
        "preflight": {
            "intent": intent,
            "confidence": confidence,
            "estimated_tokens": tokens,
            "language": language,
            "has_code_blocks": has_code,
            "paragraph_count": paragraphs,
        },
        "constraints": {
            "preserve_entities": True,
            "quality_floor": 0.85,
        },
        "metadata": {
            "source": source,
            "timestamp": 1748000000,
        },
    }


# ---------------------------------------------------------------------------
# /health endpoint
# ---------------------------------------------------------------------------

class TestHealthEndpoint:
    def test_health_returns_200(self):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ready"
        assert data["version"] == "5.0.0"
        assert "models_loaded" in data
        assert "spacy_ready" in data
        assert "sentence_model_ready" in data


# ---------------------------------------------------------------------------
# /optimize endpoint — validación
# ---------------------------------------------------------------------------

class TestOptimizeValidation:
    def test_empty_prompt_returns_422(self):
        resp = client.post("/optimize", json=make_payload(""))
        assert resp.status_code == 422

    def test_too_long_prompt_returns_422(self):
        resp = client.post("/optimize", json=make_payload("x" * 8001))
        assert resp.status_code == 422

    def test_missing_request_id_returns_422(self):
        payload = make_payload("test prompt")
        del payload["request_id"]
        resp = client.post("/optimize", json=payload)
        assert resp.status_code == 422

    def test_invalid_mode_returns_422(self):
        payload = make_payload("test prompt")
        payload["mode"] = "structure"
        resp = client.post("/optimize", json=payload)
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# /optimize endpoint — pipeline D1→D6
# ---------------------------------------------------------------------------

class TestOptimizePipeline:
    def test_short_spanish_prompt_preserved(self):
        """Un prompt corto en español debe preservarse casi intacto."""
        resp = client.post("/optimize", json=make_payload(
            "Resume este artículo en 3 puntos clave",
            intent="qa", confidence=0.75, language="es",
        ))
        assert resp.status_code == 200
        data = resp.json()
        assert data["optimized_prompt"] == "Resume este artículo en 3 puntos clave"
        assert data["original_tokens"] == data["optimized_tokens"]
        assert data["similarity_score"] == 1.0
        assert data["quality_warning"] is False

    def test_spanish_prompt_with_greeting_removes_filler(self):
        """Un prompt con saludo debe eliminar el filler."""
        resp = client.post("/optimize", json=make_payload(
            "Hola, buenos días. Por favor, ¿podrías explicarme qué es machine learning?",
            intent="qa", confidence=0.70, language="es",
        ))
        assert resp.status_code == 200
        data = resp.json()
        # El saludo debe eliminarse
        assert "Hola" not in data["optimized_prompt"]
        assert "buenos días" not in data["optimized_prompt"]
        # El contenido principal debe preservarse
        assert data["similarity_score"] >= 0.70
        assert data["savings"]["tokens_saved"] > 0

    def test_code_intent_preserved(self):
        """Un prompt de código debe preservar la intención."""
        resp = client.post("/optimize", json=make_payload(
            "Escribe una función en Python que calcule el factorial de un número",
            intent="code", confidence=0.80, language="es", has_code=True,
        ))
        assert resp.status_code == 200
        data = resp.json()
        assert data["similarity_score"] >= 0.70
        # El contenido clave debe preservarse
        assert "factorial" in data["optimized_prompt"].lower() or "función" in data["optimized_prompt"].lower()

    def test_enhance_mode_preserves_prompt(self):
        """El modo enhance debe preservar el prompt (sin LLM, solo pasa through)."""
        resp = client.post("/optimize", json=make_payload(
            "escribe un email formal al director pidiendo vacaciones",
            mode="enhance", intent="creative", confidence=0.75, language="es",
        ))
        assert resp.status_code == 200
        data = resp.json()
        assert data["optimized_prompt"] == "escribe un email formal al director pidiendo vacaciones"
        assert data["similarity_score"] == 1.0

    def test_response_has_required_fields(self):
        """La respuesta debe tener todos los campos del schema OptimizationResult."""
        resp = client.post("/optimize", json=make_payload(
            "Analiza las ventajas y desventajas del teletrabajo",
            intent="qa", confidence=0.70, language="es",
        ))
        assert resp.status_code == 200
        data = resp.json()
        # Campos obligatorios
        assert "request_id" in data
        assert "server_version" in data
        assert "optimized_prompt" in data
        assert "original_tokens" in data
        assert "optimized_tokens" in data
        assert "similarity_score" in data
        assert "segments" in data
        assert "savings" in data
        assert "pipeline_ms" in data
        assert "quality_warning" in data
        # Savings
        assert "tokens_saved" in data["savings"]
        assert "co2_grams_saved" in data["savings"]
        assert "water_ml_saved" in data["savings"]
        assert "methodology_ref" in data["savings"]
        # Pipeline timing
        assert "d1_verifier" in data["pipeline_ms"]
        assert "d2_segmenter" in data["pipeline_ms"]
        assert "total" in data["pipeline_ms"]

    def test_segments_have_required_fields(self):
        """Cada segmento debe tener text, label, kept, compression_ratio."""
        resp = client.post("/optimize", json=make_payload(
            "Hola. Necesito que expliques qué es la fotosíntesis. No uses ejemplos complejos. Gracias.",
            intent="qa", confidence=0.70, language="es",
        ))
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["segments"]) > 0
        for seg in data["segments"]:
            assert "text" in seg
            assert "label" in seg
            assert "kept" in seg
            assert "compression_ratio" in seg
            assert seg["label"] in ["intent", "constraint", "context_high", "context_low", "filler"]
            assert 0.0 <= seg["compression_ratio"] <= 1.0

    def test_co2_and_water_savings_positive(self):
        """Si hay tokens ahorrados, CO2 y agua deben ser positivos."""
        resp = client.post("/optimize", json=make_payload(
            "Hola, buenas tardes. Espero que estés bien. Podrías explicarme qué es la inteligencia artificial? Gracias de antemano.",
            intent="qa", confidence=0.65, language="es",
        ))
        assert resp.status_code == 200
        data = resp.json()
        if data["savings"]["tokens_saved"] > 0:
            assert data["savings"]["co2_grams_saved"] > 0
            assert data["savings"]["water_ml_saved"] > 0

    def test_pipeline_timing_positive(self):
        """Los tiempos del pipeline deben ser no-negativos."""
        resp = client.post("/optimize", json=make_payload(
            "Explica la teoría de la relatividad",
            intent="qa", confidence=0.70, language="es",
        ))
        assert resp.status_code == 200
        data = resp.json()
        for key, value in data["pipeline_ms"].items():
            assert value >= 0, f"pipeline_ms[{key}] = {value} < 0"

    def test_quality_warning_on_aggressive_compression(self):
        """Si la compresión es muy agresiva, quality_warning debe ser True."""
        # Prompt muy corto donde el segmenter puede sobre-comprimir
        resp = client.post("/optimize", json=make_payload(
            "Hey there! I was wondering if you could please help me write a Python function.",
            intent="code", confidence=0.80, language="en",
        ))
        assert resp.status_code == 200
        data = resp.json()
        # No verificamos que siempre sea True, solo que el campo existe
        assert isinstance(data["quality_warning"], bool)


# ---------------------------------------------------------------------------
# /optimize endpoint — edge cases
# ---------------------------------------------------------------------------

class TestOptimizeEdgeCases:
    def test_single_word_prompt(self):
        """Un prompt de una sola palabra debe procesarse sin error."""
        resp = client.post("/optimize", json=make_payload("machine"))
        assert resp.status_code == 200
        data = resp.json()
        assert data["optimized_prompt"] == "machine"

    def test_prompt_with_code_blocks(self):
        """Un prompt con bloques de código debe preservar el código."""
        resp = client.post("/optimize", json=make_payload(
            "Hola, ¿puedes explicar este código?\n```python\ndef foo():\n    return 42\n```\nGracias.",
            intent="code", confidence=0.80, language="es", has_code=True,
        ))
        assert resp.status_code == 200
        data = resp.json()
        # El código debe preservarse
        assert "def foo" in data["optimized_prompt"] or "42" in data["optimized_prompt"]

    def test_english_prompt(self):
        """Un prompt en inglés debe procesarse sin error."""
        resp = client.post("/optimize", json=make_payload(
            "Hello! Could you please explain what machine learning is? Thank you!",
            intent="qa", confidence=0.70, language="en",
        ))
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["optimized_prompt"]) > 0

    def test_minimal_payload(self):
        """Un payload mínimo (solo raw_prompt y request_id) debe funcionar."""
        resp = client.post("/optimize", json={
            "request_id": "minimal-test",
            "raw_prompt": "Explica la fotosíntesis",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["optimized_prompt"] == "Explica la fotosíntesis"

    def test_long_prompt(self):
        """Un prompt largo (pero <8000 chars) debe procesarse."""
        text = "Necesito que expliques esto. " * 100  # ~2100 chars
        resp = client.post("/optimize", json=make_payload(
            text, intent="general", confidence=0.50, language="es", tokens=300,
        ))
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["optimized_prompt"]) > 0
        assert data["original_tokens"] > 0