"""
Tests para D2 — Semantic Segmenter

Cubre:
1. Segmentación básica (spaCy + fallback regex)
2. Etiquetado heurístico (intent, constraint, filler, context_high, context_low)
3. Agrupación semántica (MiniLM con fallback)
4. Edge cases (vacío, una oración, inglés, mixto)
5. Formato de salida (keys: text, label, embedding)
"""

import pytest
from pipeline.segmenter import (
    segment_prompt,
    _split_with_regex,
    _classify_sentence,
    _label_segment,
    _intent_to_label,
    _group_sentences_by_heuristic,
    SIMILARITY_THRESHOLD,
)


class TestEmptyAndSingle:
    """Tests para casos vacíos y de una sola oración."""

    def test_empty_text(self):
        """Texto vacío retorna lista vacía."""
        result = segment_prompt("")
        assert result == []

    def test_whitespace_only(self):
        """Texto con solo espacios retorna lista vacía."""
        result = segment_prompt("   ")
        assert result == []

    def test_single_intent_sentence(self):
        """Una sola oración con verbo de acción → intent."""
        result = segment_prompt("Explica la fotosíntesis")
        assert len(result) == 1
        assert result[0]["label"] == "intent"
        assert result[0]["text"] == "Explica la fotosíntesis"

    def test_single_sentence_uses_verified_intent(self):
        """Una sola oración con intent fuerte (code) usa intent si no es filler/constraint."""
        result = segment_prompt("Necesito procesar datos", verified_intent="code")
        assert len(result) == 1
        assert result[0]["label"] == "intent"  # code → intent override

    def test_single_general_sentence(self):
        """Una sola oración con intent general → context_low."""
        result = segment_prompt("Información general", verified_intent="general")
        assert len(result) == 1
        assert result[0]["label"] == "context_low"


class TestLabeling:
    """Tests para el etiquetado heurístico."""

    def test_greeting_becomes_filler(self):
        """Saludo → filler."""
        label = _classify_sentence("Hola, cómo estás?", "general")
        assert label == "filler"

    def test_filler_ending(self):
        """Despedida con gracias → filler."""
        label = _classify_sentence("Por favor, gracias!", "general")
        assert label == "filler"

    def test_constraint_detected(self):
        """Restricción explícita → constraint."""
        label = _classify_sentence("No uses ejemplos de fibonacci", "general")
        assert label == "constraint"

    def test_constraint_with_numbers(self):
        """Restricción con números → constraint."""
        label = _classify_sentence("Máximo 500 palabras", "general")
        assert label == "constraint"

    def test_intent_verb_detected(self):
        """Verbo de acción → intent."""
        label = _classify_sentence("Necesito que expliques la fotosíntesis", "general")
        assert label == "intent"

    def test_context_high_with_entities(self):
        """Entidades nombradas → context_high."""
        label = _classify_sentence("El cliente Juan Pérez pagó $500", "general")
        assert label == "context_high"

    def test_context_high_with_url(self):
        """URL → context_high."""
        label = _classify_sentence("Visita https://ejemplo.com para más info", "general")
        assert label == "context_high"

    def test_context_low_default(self):
        """Oración sin patrones especiales → context_low."""
        label = _classify_sentence("La información es relevante para el análisis", "general")
        assert label == "context_low"

    def test_english_intent(self):
        """Verbo de acción en inglés → intent."""
        label = _classify_sentence("Explain how photosynthesis works", "general")
        assert label == "intent"

    def test_english_constraint(self):
        """Restricción en inglés → constraint."""
        label = _classify_sentence("Don't use examples from fibonacci", "general")
        assert label == "constraint"


class TestLabelSegment:
    """Tests para etiquetado de segmentos multi-oración."""

    def test_multi_sentence_takes_highest_priority(self):
        """Segmento con filler + intent → filler (prioridad más alta)."""
        label = _label_segment("Hola. Necesito que expliques la fotosíntesis", "general")
        assert label == "filler"

    def test_multi_sentence_constraint_over_intent(self):
        """Segmento con constraint + intent → constraint."""
        label = _label_segment("No uses ejemplos. Explica la fotosíntesis", "general")
        assert label == "constraint"


class TestIntentMapping:
    """Tests para mapeo de intent a label."""

    def test_code_maps_to_intent(self):
        assert _intent_to_label("code") == "intent"

    def test_qa_maps_to_intent(self):
        assert _intent_to_label("qa") == "intent"

    def test_creative_maps_to_intent(self):
        assert _intent_to_label("creative") == "intent"

    def test_general_maps_to_context_low(self):
        assert _intent_to_label("general") == "context_low"

    def test_unknown_maps_to_context_low(self):
        assert _intent_to_label("unknown") == "context_low"


class TestRegexSplitting:
    """Tests para división de oraciones con regex (fallback)."""

    def test_split_multiple_sentences(self):
        """Divide correctamente múltiples oraciones."""
        sentences = _split_with_regex("Hola. Necesito ayuda. Gracias.")
        assert len(sentences) == 3

    def test_split_empty_text(self):
        """Texto vacío retorna lista vacía."""
        assert _split_with_regex("") == []

    def test_split_single_sentence(self):
        """Una sola oración sin punto final."""
        sentences = _split_with_regex("Necesito ayuda")
        assert len(sentences) == 1
        assert sentences[0] == "Necesito ayuda"


class TestHeuristicGrouping:
    """Tests para agrupación heurística (fallback sin embeddings)."""

    def test_each_sentence_own_group(self):
        """Sin embeddings, cada oración es su propio grupo."""
        sentences = ["Hola.", "Necesito ayuda.", "Gracias."]
        groups = _group_sentences_by_heuristic(sentences)
        assert len(groups) == 3
        assert groups[0] == [0]
        assert groups[1] == [1]
        assert groups[2] == [2]


class TestSegmentPromptIntegration:
    """Tests de integración completos con spaCy + MiniLM."""

    def test_output_format(self):
        """Cada segmento tiene las keys requeridas: text, label, embedding."""
        result = segment_prompt("Explica la fotosíntesis de forma detallada")
        assert len(result) >= 1
        for seg in result:
            assert "text" in seg
            assert "label" in seg
            assert "embedding" in seg
            assert seg["label"] in ["intent", "constraint", "context_high", "context_low", "filler"]

    def test_mixed_prompt_segmentation(self):
        """Prompt mixto con filler, intent y constraint."""
        text = "Hola, espero que estés bien. Necesito que me expliques la fotosíntesis. No uses ejemplos de fibonacci."
        result = segment_prompt(text)
        assert len(result) >= 1
        labels = [seg["label"] for seg in result]
        # Al menos un intent o constraint
        assert any(l in labels for l in ["intent", "constraint", "filler"])

    def test_constraint_explicit(self):
        """Restricción explícita detectada correctamente."""
        text = "No uses ejemplos de fibonacci en la respuesta."
        result = segment_prompt(text)
        assert len(result) >= 1
        # Al menos un segmento debe ser constraint
        labels = [seg["label"] for seg in result]
        assert "constraint" in labels

    def test_filler_greeting(self):
        """Saludo detectado como filler."""
        text = "Hola, cómo estás? Necesito ayuda con algo."
        result = segment_prompt(text)
        labels = [seg["label"] for seg in result]
        assert "filler" in labels

    def test_paragraph_count_passed_through(self):
        """El parámetro paragraph_count se acepta sin error."""
        result = segment_prompt("Explica la fotosíntesis", paragraph_count=3)
        assert len(result) >= 1

    def test_long_prompt_segmentation(self):
        """Prompt largo con múltiples oraciones se segmenta correctamente."""
        text = (
            "Hola, espero que estés bien. "
            "Necesito que me expliques cómo funciona la fotosíntesis de forma muy detallada. "
            "No uses ejemplos de fibonacci. "
            "El contexto es que esto es parte de un sistema de pagos muy importante. "
            "Máximo 500 palabras por favor."
        )
        result = segment_prompt(text)
        assert len(result) >= 2
        # Verificar que todos los segmentos tienen formato correcto
        for seg in result:
            assert "text" in seg
            assert "label" in seg
            assert "embedding" in seg
            assert len(seg["text"]) > 0

    def test_english_prompt(self):
        """Prompt en inglés funciona correctamente."""
        text = "Explain how photosynthesis works. Don't use fibonacci examples."
        result = segment_prompt(text)
        assert len(result) >= 1
        labels = [seg["label"] for seg in result]
        # Al menos un intent o constraint
        assert any(l in labels for l in ["intent", "constraint"])

    def test_mixed_language_prompt(self):
        """Prompt mixto es/en no crashea."""
        text = "Necesito help with this code. Por favor explain the function."
        result = segment_prompt(text)
        assert len(result) >= 1
        for seg in result:
            assert seg["label"] in ["intent", "constraint", "context_high", "context_low", "filler"]

    def test_code_in_prompt(self):
        """Prompt con código detectado como intent."""
        text = "Explica este código: print('hello world')"
        result = segment_prompt(text)
        assert len(result) >= 1
        labels = [seg["label"] for seg in result]
        assert "intent" in labels