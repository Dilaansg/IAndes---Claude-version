"""
Tests para D3 — Budget Controller
"""

import pytest
from pipeline.budget import assign_budgets, BUDGET_TABLE, _estimate_output_tokens


class TestBudgetTable:
    """Tests para la tabla de presupuestos."""

    def test_intent_is_untouchable(self):
        assert BUDGET_TABLE["intent"] == 0.0

    def test_constraint_is_untouchable(self):
        assert BUDGET_TABLE["constraint"] == 0.0

    def test_context_high_has_low_compression(self):
        assert BUDGET_TABLE["context_high"] == 0.20

    def test_context_low_has_moderate_compression(self):
        assert BUDGET_TABLE["context_low"] == 0.60

    def test_filler_is_fully_removable(self):
        assert BUDGET_TABLE["filler"] == 1.0


class TestAssignBudgets:
    """Tests para assign_budgets sin límite de tokens."""

    def test_simple_segments(self):
        segments = [
            {"text": "Explica la fotosíntesis", "label": "intent"},
            {"text": "Hola, espero que estés bien", "label": "filler"},
            {"text": "No uses ejemplos de fibonacci", "label": "constraint"},
        ]
        result = assign_budgets(segments)
        assert result[0]["max_compression"] == 0.0  # intent
        assert result[1]["max_compression"] == 1.0  # filler
        assert result[2]["max_compression"] == 0.0  # constraint

    def test_unknown_label_gets_zero_compression(self):
        segments = [
            {"text": "algo de texto", "label": "unknown"},
        ]
        result = assign_budgets(segments)
        assert result[0]["max_compression"] == 0.0

    def test_all_segment_types(self):
        segments = [
            {"text": "Explica la fotosíntesis", "label": "intent"},
            {"text": "Que sea simple por favor", "label": "constraint"},
            {"text": "El contexto es que esto es parte de un sistema de pagos", "label": "context_high"},
            {"text": "La verdad es que llevo varios días intentando entender esto", "label": "context_low"},
            {"text": "Hola, espero que estés bien", "label": "filler"},
        ]
        result = assign_budgets(segments)
        assert result[0]["max_compression"] == 0.0   # intent
        assert result[1]["max_compression"] == 0.0   # constraint
        assert result[2]["max_compression"] == 0.20  # context_high
        assert result[3]["max_compression"] == 0.60  # context_low
        assert result[4]["max_compression"] == 1.0   # filler

    def test_no_max_output_tokens(self):
        """Sin límite de tokens, los presupuestos son los de la tabla."""
        segments = [
            {"text": "Explica la fotosíntesis", "label": "intent"},
            {"text": "Hola", "label": "filler"},
        ]
        result = assign_budgets(segments, max_output_tokens=None)
        assert result[0]["max_compression"] == 0.0
        assert result[1]["max_compression"] == 1.0


class TestAssignBudgetsWithLimit:
    """Tests para assign_budgets con límite de tokens."""

    def test_within_limit_no_redistribution(self):
        """Si el output ya cabe en el límite, no se redistribuye."""
        segments = [
            {"text": "Explica la fotosíntesis", "label": "intent"},
            {"text": "Hola", "label": "filler"},
        ]
        # Con un límite generoso, no debería cambiar nada
        result = assign_budgets(segments, max_output_tokens=100)
        assert result[0]["max_compression"] == 0.0  # intent sigue intocable
        assert result[1]["max_compression"] == 1.0  # filler sigue eliminable

    def test_intent_never_compressed(self):
        """Intent y constraint nunca se comprimen, incluso con límite estricto."""
        segments = [
            {"text": "Explica la fotosíntesis de forma detallada", "label": "intent"},
            {"text": "No uses ejemplos de fibonacci", "label": "constraint"},
        ]
        result = assign_budgets(segments, max_output_tokens=1)
        # Intent y constraint siempre tienen max_compression == 0.0
        assert result[0]["max_compression"] == 0.0
        assert result[1]["max_compression"] == 0.0


class TestEstimateOutputTokens:
    """Tests para la estimación de tokens del output."""

    def test_all_untouchable(self):
        segments = [
            {"text": "Explica la fotosíntesis", "label": "intent", "max_compression": 0.0},
        ]
        tokens = _estimate_output_tokens(segments)
        assert tokens > 0

    def test_all_filler(self):
        segments = [
            {"text": "Hola", "label": "filler", "max_compression": 1.0},
        ]
        tokens = _estimate_output_tokens(segments)
        assert tokens == 1  # max(1, 0) = 1

    def test_mixed(self):
        segments = [
            {"text": "Explica la fotosíntesis", "label": "intent", "max_compression": 0.0},
            {"text": "Hola", "label": "filler", "max_compression": 1.0},
        ]
        tokens = _estimate_output_tokens(segments)
        # Solo el intent cuenta (filler eliminado)
        assert tokens > 0