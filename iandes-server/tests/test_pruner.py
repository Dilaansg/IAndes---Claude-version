"""
Tests para D4 — Token Pruner
"""

import pytest
from pipeline.pruner import prune_segments, _tokenize, _find_protected_words, _compress_text


class TestTokenize:
    """Tests para la tokenización."""

    def test_simple_text(self):
        tokens = _tokenize("Hola, explícame la fotosíntesis")
        assert "hola" in tokens
        assert "explícame" in tokens
        assert "fotosíntesis" in tokens

    def test_empty_text(self):
        assert _tokenize("") == []

    def test_numbers_preserved(self):
        tokens = _tokenize("El resultado es 42")
        assert "42" in tokens

    def test_accents_preserved(self):
        tokens = _tokenize("explicación evaluación")
        assert "explicación" in tokens
        assert "evaluación" in tokens


class TestProtectedWords:
    """Tests para la protección de entidades."""

    def test_url_protected(self):
        protected = _find_protected_words("Visita https://ejemplo.com para más info")
        assert "ejemplo" in protected or "https" in protected

    def test_numbers_protected(self):
        protected = _find_protected_words("El resultado es 42")
        assert "42" in protected

    def test_date_protected(self):
        protected = _find_protected_words("El 12/04/2026 fue importante")
        # La fecha como patrón debe estar protegida
        assert len(protected) > 0

    def test_code_block_protected(self):
        protected = _find_protected_words("Usa ```python\nprint('hello')\n```")
        assert len(protected) > 0


class TestPruneSegments:
    """Tests para prune_segments."""

    def test_filler_eliminated(self):
        segments = [
            {"text": "Hola, espero que estés bien", "label": "filler", "max_compression": 1.0},
        ]
        result = prune_segments(segments)
        assert result[0]["text_compressed"] == ""
        assert result[0]["kept"] is False
        assert result[0]["compression_ratio"] == 0.0

    def test_intent_preserved(self):
        segments = [
            {"text": "Explica la fotosíntesis de forma detallada", "label": "intent", "max_compression": 0.0},
        ]
        result = prune_segments(segments)
        assert result[0]["text_compressed"] == "Explica la fotosíntesis de forma detallada"
        assert result[0]["kept"] is True
        assert result[0]["compression_ratio"] == 1.0

    def test_constraint_preserved(self):
        segments = [
            {"text": "No uses ejemplos de fibonacci", "label": "constraint", "max_compression": 0.0},
        ]
        result = prune_segments(segments)
        assert result[0]["text_compressed"] == "No uses ejemplos de fibonacci"
        assert result[0]["kept"] is True

    def test_mixed_segments(self):
        """Test con segmentos de diferentes tipos."""
        segments = [
            {"text": "Explica la fotosíntesis", "label": "intent", "max_compression": 0.0},
            {"text": "Hola, espero que estés bien", "label": "filler", "max_compression": 1.0},
            {"text": "No uses ejemplos de fibonacci", "label": "constraint", "max_compression": 0.0},
        ]
        result = prune_segments(segments)
        # Intent preservado
        assert result[0]["text_compressed"] == "Explica la fotosíntesis"
        assert result[0]["kept"] is True
        # Filler eliminado
        assert result[1]["text_compressed"] == ""
        assert result[1]["kept"] is False
        # Constraint preservado
        assert result[2]["text_compressed"] == "No uses ejemplos de fibonacci"
        assert result[2]["kept"] is True

    def test_context_high_partial_compression(self):
        """context_high tiene max_compression=0.20, se comprime un poco."""
        segments = [
            {"text": "El contexto es que esto es parte de un sistema de pagos muy importante", "label": "context_high", "max_compression": 0.20},
        ]
        result = prune_segments(segments)
        assert result[0]["kept"] is True
        # El texto comprimido debe ser más corto o igual
        assert len(result[0]["text_compressed"]) <= len(segments[0]["text"])

    def test_context_low_moderate_compression(self):
        """context_low tiene max_compression=0.60, se comprime moderadamente."""
        segments = [
            {"text": "La verdad es que llevo varios días intentando entender este concepto y no he podido", "label": "context_low", "max_compression": 0.60},
        ]
        result = prune_segments(segments)
        assert result[0]["kept"] is True
        # El texto comprimido debe ser más corto
        assert len(result[0]["text_compressed"]) <= len(segments[0]["text"])

    def test_empty_text(self):
        segments = [
            {"text": "", "label": "filler", "max_compression": 1.0},
        ]
        result = prune_segments(segments)
        assert result[0]["text_compressed"] == ""

    def test_preserve_entities_default(self):
        """Con preserve_entities=True (default), las URLs no se eliminan."""
        segments = [
            {"text": "Necesito analizar los datos de https://ejemplo.com/dataset", "label": "context_low", "max_compression": 0.60},
        ]
        result = prune_segments(segments, preserve_entities=True)
        # La URL debe estar presente en el resultado
        assert "ejemplo" in result[0]["text_compressed"].lower() or "https" in result[0]["text_compressed"].lower()

    def test_no_preserve_entities(self):
        """Con preserve_entities=False, las URLs pueden eliminarse."""
        segments = [
            {"text": "Necesito analizar los datos de https://ejemplo.com/dataset", "label": "context_low", "max_compression": 0.60},
        ]
        result = prune_segments(segments, preserve_entities=False)
        # Sin protección, el resultado puede ser más corto
        assert len(result[0]["text_compressed"]) <= len(segments[0]["text"])


class TestCompressText:
    """Tests para _compress_text."""

    def test_no_compression(self):
        """max_compression=0.0 significa intocable, no se comprime nada."""
        result = _compress_text("Hola mundo", max_compression=0.0, corpus=["Hola mundo"])
        assert result == "Hola mundo"

    def test_full_compression(self):
        """max_compression=1.0 significa eliminar completamente."""
        result = _compress_text("Hola mundo", max_compression=1.0, corpus=["Hola mundo"])
        assert result == ""

    def test_partial_compression(self):
        text = "Hola, por favor explícame cómo funciona la fotosíntesis de forma muy detallada"
        result = _compress_text(text, max_compression=0.5, corpus=[text])
        # El resultado debe ser más corto que el original
        assert len(result) <= len(text)

    def test_preserves_verbs(self):
        """Los verbos principales no deben eliminarse."""
        text = "Necesito explicar la fotosíntesis"
        result = _compress_text(text, max_compression=0.5, corpus=[text])
        # "explicar" o "necesito" deben estar presentes
        assert "explic" in result.lower() or "necesit" in result.lower()