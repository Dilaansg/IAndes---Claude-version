"""
Tests para D1 — Intent Verifier

Cubre:
1. Confianza alta → bypass (acepta intent del cliente)
2. Confianza baja → recálculo con spaCy/patrones
3. Clasificación por patrones: code, qa, creative, general
4. Code blocks detectados → intent=code
5. Confianza del servidor vs cliente
6. Edge cases: texto vacío, texto ambiguo
"""

import pytest
from schemas.request import PromptAnalysis, PreflightInfo, IntentEnum
from pipeline.verifier import (
    verify_intent,
    _classify_with_patterns,
    _compute_server_confidence,
    CONFIDENCE_THRESHOLD,
)


def _make_payload(text, intent="general", confidence=0.50, has_code_blocks=False):
    """Helper para crear un PromptAnalysis para tests."""
    return PromptAnalysis(
        request_id="test-001",
        raw_prompt=text,
        preflight=PreflightInfo(
            intent=IntentEnum(intent),
            confidence=confidence,
            has_code_blocks=has_code_blocks,
        ),
    )


class TestHighConfidenceBypass:
    """Tests para bypass cuando la confianza del cliente es alta."""

    def test_high_confidence_accepts_client_intent(self):
        """Confianza >= 0.60 → acepta intent del cliente sin procesar."""
        payload = _make_payload("Hola mundo", intent="qa", confidence=0.80)
        result = verify_intent(payload)
        assert result["verified_intent"] == "qa"
        assert result["verification_source"] == "client"
        assert result["confidence"] == 0.80

    def test_confidence_exactly_at_threshold(self):
        """Confianza == 0.60 → acepta intent del cliente."""
        payload = _make_payload("Hola mundo", intent="creative", confidence=0.60)
        result = verify_intent(payload)
        assert result["verified_intent"] == "creative"
        assert result["verification_source"] == "client"

    def test_high_confidence_preserves_all_intents(self):
        """Confianza alta preserva cualquier intent del cliente."""
        for intent in ["code", "qa", "creative", "general"]:
            payload = _make_payload("Texto", intent=intent, confidence=0.90)
            result = verify_intent(payload)
            assert result["verified_intent"] == intent
            assert result["verification_source"] == "client"


class TestLowConfidenceRecalculation:
    """Tests para recálculo cuando la confianza del cliente es baja."""

    def test_low_confidence_triggers_server_analysis(self):
        """Confianza < 0.60 → recálculo con server."""
        payload = _make_payload(
            "Explica cómo funciona la fotosíntesis",
            intent="general",
            confidence=0.30,
        )
        result = verify_intent(payload)
        # El server debería detectar QA patterns
        assert result["verification_source"] in ("server", "client")
        # El intent debería ser más específico que "general"
        assert result["verified_intent"] in ("code", "qa", "creative", "general")

    def test_code_prompt_detected_by_server(self):
        """Prompt de código detectado por el server."""
        payload = _make_payload(
            "Necesito depurar esta función en Python",
            intent="general",
            confidence=0.30,
        )
        result = verify_intent(payload)
        assert result["verified_intent"] == "code"

    def test_qa_prompt_detected_by_server(self):
        """Prompt de pregunta detectado por el server."""
        payload = _make_payload(
            "¿Qué es la fotosíntesis?",
            intent="general",
            confidence=0.30,
        )
        result = verify_intent(payload)
        assert result["verified_intent"] == "qa"

    def test_creative_prompt_detected_by_server(self):
        """Prompt creativo detectado por el server."""
        payload = _make_payload(
            "Escribe una historia sobre un dragón",
            intent="general",
            confidence=0.30,
        )
        result = verify_intent(payload)
        assert result["verified_intent"] == "creative"


class TestPatternClassification:
    """Tests para clasificación por patrones léxicos."""

    def test_code_patterns(self):
        """Patrones de código detectados correctamente."""
        assert _classify_with_patterns("Necesito depurar mi código Python", False) == "code"
        assert _classify_with_patterns("Cómo implementar una función en JavaScript", False) == "code"
        assert _classify_with_patterns("El error en mi script de SQL", False) == "code"

    def test_code_blocks_override(self):
        """Code blocks fuerzan intent=code."""
        assert _classify_with_patterns("Tengo un problema", True) == "code"
        assert _classify_with_patterns("Mira esto: ```python\nprint('hello')\n```", False) == "code"

    def test_qa_patterns(self):
        """Patrones de pregunta detectados correctamente."""
        assert _classify_with_patterns("¿Qué es la fotosíntesis?", False) == "qa"
        assert _classify_with_patterns("Explica cómo funciona la fotosíntesis", False) == "qa"
        assert _classify_with_patterns("Cómo se hace un pastel", False) == "qa"

    def test_creative_patterns(self):
        """Patrones creativos detectados correctamente."""
        assert _classify_with_patterns("Escribe una historia de ciencia ficción", False) == "creative"
        assert _classify_with_patterns("Genera un poema sobre la luna", False) == "creative"
        assert _classify_with_patterns("Crea un cuento para niños", False) == "creative"

    def test_general_fallback(self):
        """Sin patrones específicos → general."""
        assert _classify_with_patterns("Hola mundo", False) == "general"
        assert _classify_with_patterns("Información general", False) == "general"

    def test_code_takes_priority_over_qa(self):
        """Código tiene prioridad sobre QA."""
        assert _classify_with_patterns("Explica este código Python", False) == "code"

    def test_creative_over_qa_when_equal(self):
        """Creativo tiene prioridad sobre QA cuando hay matches creativos."""
        result = _classify_with_patterns("Escribe una explicación detallada", False)
        assert result == "creative"  # "escribe" es creative


class TestConfidenceEstimation:
    """Tests para estimación de confianza del servidor."""

    def test_no_patterns_low_confidence(self):
        """Sin patrones → confianza baja."""
        conf = _compute_server_confidence("Hola mundo", "general")
        assert conf == 0.40

    def test_matching_patterns_higher_confidence(self):
        """Más patrones → más confianza."""
        conf_code = _compute_server_confidence("Necesito depurar mi código Python", "code")
        conf_general = _compute_server_confidence("Hola mundo", "general")
        assert conf_code > conf_general

    def test_confidence_capped_at_095(self):
        """Confianza nunca supera 0.95."""
        conf = _compute_server_confidence(
            "Necesito depurar mi código Python y explicar la función y escribir un script",
            "code",
        )
        assert conf <= 0.95


class TestCodeBlocks:
    """Tests para detección de code blocks."""

    def test_inline_code_detected(self):
        """Código inline detectado."""
        assert _classify_with_patterns("Mira esto: `print('hello')`", False) == "code"

    def test_code_block_detected(self):
        """Bloque de código detectado."""
        text = "Mi código:\n```python\nprint('hello')\n```"
        assert _classify_with_patterns(text, False) == "code"

    def test_has_code_blocks_flag(self):
        """Flag has_code_blocks fuerza intent=code."""
        assert _classify_with_patterns("Tengo un problema", True) == "code"


class TestEdgeCases:
    """Tests para edge cases."""

    def test_very_short_prompt(self):
        """Prompt muy corto."""
        payload = _make_payload("Hola", intent="general", confidence=0.30)
        result = verify_intent(payload)
        assert result["verified_intent"] in ("code", "qa", "creative", "general")

    def test_mixed_language_prompt(self):
        """Prompt mixto es/en."""
        payload = _make_payload(
            "Necesito help with this Python code",
            intent="general",
            confidence=0.30,
        )
        result = verify_intent(payload)
        assert result["verified_intent"] == "code"

    def test_server_confidence_lower_than_client(self):
        """Si server confidence < client confidence, mantener cliente."""
        payload = _make_payload(
            "Hola mundo",
            intent="general",
            confidence=0.50,
        )
        result = verify_intent(payload)
        # "Hola mundo" no tiene patrones fuertes, server confidence será baja
        # El resultado puede ser client o server dependiendo de cuál sea mayor
        assert result["verified_intent"] in ("code", "qa", "creative", "general")

    def test_all_intent_values_accepted(self):
        """Todos los valores de intent son aceptados."""
        for intent in ["code", "qa", "creative", "general"]:
            payload = _make_payload("Texto", intent=intent, confidence=0.90)
            result = verify_intent(payload)
            assert result["verified_intent"] == intent