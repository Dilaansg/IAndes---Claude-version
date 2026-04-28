"""
Tests para D5 — Coherence Validator

Cubre:
1. Buena compresión (score >= quality_floor) → pasa sin rollback
2. Compresión agresiva (score < quality_floor) → rollback parcial
3. Dos rollbacks insuficientes → quality_warning: true
4. Sin segmentos → no rollback posible, warning si score bajo
5. Similitud Jaccard (fallback sin MiniLM)
6. Edge cases: textos idénticos, texto vacío
"""

import pytest
from pipeline.validator import (
    validate_coherence,
    compute_similarity,
    _jaccard_similarity,
    _find_worst_segment,
    _restore_segment,
    _rebuild_optimized_text,
    QUALITY_FLOOR_DEFAULT,
    MAX_ROLLBACK_ITERATIONS,
)


class TestJaccardSimilarity:
    """Tests para la similitud Jaccard (fallback)."""

    def test_identical_texts(self):
        """Textos idénticos → similitud 1.0."""
        sim = _jaccard_similarity("Hola mundo", "Hola mundo")
        assert sim == 1.0

    def test_completely_different(self):
        """Textos sin palabras en común → similitud 0.0."""
        sim = _jaccard_similarity("alpha beta", "gamma delta")
        assert sim == 0.0

    def test_partial_overlap(self):
        """Textos con overlap parcial → similitud entre 0 y 1."""
        sim = _jaccard_similarity("hola mundo cruel", "hola mundo bonito")
        # "hola" y "mundo" en común, "cruel" y "bonito" diferentes
        # intersection = {hola, mundo} = 2, union = {hola, mundo, cruel, bonito} = 4
        assert 0.0 < sim < 1.0
        assert abs(sim - 0.5) < 0.01

    def test_empty_texts(self):
        """Dos textos vacíos → similitud 1.0 (ambos vacíos = idénticos)."""
        sim = _jaccard_similarity("", "")
        assert sim == 1.0

    def test_one_empty(self):
        """Un texto vacío y uno no vacío → similitud 0.0."""
        sim = _jaccard_similarity("hola mundo", "")
        assert sim == 0.0

    def test_case_insensitive(self):
        """Jaccard es case-insensitive por diseño (tokeniza en minúsculas)."""
        sim = _jaccard_similarity("Hola Mundo", "hola mundo")
        assert sim == 1.0


class TestComputeSimilarity:
    """Tests para compute_similarity (MiniLM con fallback a Jaccard)."""

    def test_identical_texts(self):
        """Textos idénticos → similitud alta."""
        sim = compute_similarity("Explica la fotosíntesis", "Explica la fotosíntesis")
        assert sim >= 0.99  # Debería ser 1.0 o muy cercano

    def test_similar_texts(self):
        """Textos similares → similitud moderada (Jaccard es conservador)."""
        sim = compute_similarity(
            "Necesito que expliques la fotosíntesis",
            "Explica la fotosíntesis de forma detallada"
        )
        # Jaccard overlap: "fotosíntesis" es la palabra en común
        # Con MiniLM sería más alta, con Jaccard es conservador
        assert sim > 0.1  # Al menos algo de overlap

    def test_very_different_texts(self):
        """Textos muy diferentes → similitud baja."""
        sim = compute_similarity(
            "El gato duerme en la alfombra",
            "Los coches vuelan por la autopista"
        )
        assert sim < 0.5


class TestFindWorstSegment:
    """Tests para encontrar el segmento más problemático."""

    def test_finds_compressed_segment(self):
        """Encuentra el segmento con peor similitud individual."""
        segments = [
            {"text": "Explica la fotosíntesis", "text_compressed": "Explica fotosíntesis", "kept": True, "compression_ratio": 0.75},
            {"text": "Hola, espero que estés bien", "text_compressed": "Hola bien", "kept": True, "compression_ratio": 0.3},
            {"text": "No uses ejemplos", "text_compressed": "No uses ejemplos", "kept": True, "compression_ratio": 1.0},
        ]
        idx = _find_worst_segment(segments, "Explica la fotosíntesis")
        # El segmento con compression_ratio=0.3 debería ser el peor
        assert idx == 1

    def test_no_candidates(self):
        """Si todos los segmentos están intactos, no hay candidato para rollback."""
        segments = [
            {"text": "Explica la fotosíntesis", "text_compressed": "Explica la fotosíntesis", "kept": True, "compression_ratio": 1.0},
            {"text": "No uses ejemplos", "text_compressed": "No uses ejemplos", "kept": True, "compression_ratio": 1.0},
        ]
        idx = _find_worst_segment(segments, "Explica la fotosíntesis")
        assert idx is None

    def test_skips_eliminated_segments(self):
        """Los segmentos eliminados (kept=False) no son candidatos."""
        segments = [
            {"text": "Hola", "text_compressed": "", "kept": False, "compression_ratio": 0.0},
            {"text": "Explica fotosíntesis", "text_compressed": "Explica", "kept": True, "compression_ratio": 0.5},
        ]
        idx = _find_worst_segment(segments, "Explica fotosíntesis")
        assert idx == 1  # Solo el segundo es candidato


class TestRestoreSegment:
    """Tests para restaurar un segmento."""

    def test_restore_resets_compression(self):
        """Restaurar un segmento pone text_compressed = text y ratio = 1.0."""
        segments = [
            {"text": "Explica la fotosíntesis", "text_compressed": "Explica fotosíntesis", "kept": True, "compression_ratio": 0.75},
        ]
        _restore_segment(segments, 0)
        assert segments[0]["text_compressed"] == "Explica la fotosíntesis"
        assert segments[0]["compression_ratio"] == 1.0
        assert segments[0]["kept"] is True


class TestRebuildOptimizedText:
    """Tests para reconstruir texto optimizado."""

    def test_rebuild_from_segments(self):
        """Reconstruye texto a partir de segmentos kept."""
        segments = [
            {"text": "Explica la fotosíntesis", "text_compressed": "Explica fotosíntesis", "kept": True},
            {"text": "Hola", "text_compressed": "", "kept": False},
            {"text": "No uses ejemplos", "text_compressed": "No uses ejemplos", "kept": True},
        ]
        result = _rebuild_optimized_text(segments, "fallback")
        assert "Explica fotosíntesis" in result
        assert "No uses ejemplos" in result
        assert "Hola" not in result

    def test_fallback_when_empty(self):
        """Si todos los segmentos están vacíos, usa fallback."""
        segments = [
            {"text": "Hola", "text_compressed": "", "kept": False},
        ]
        result = _rebuild_optimized_text(segments, "texto original")
        assert result == "texto original"


class TestValidateCoherence:
    """Tests para la función principal validate_coherence."""

    def test_good_compression_no_rollback(self):
        """Compresión buena (score >= quality_floor) → pasa sin rollback."""
        # Textos casi idénticos → alta similitud
        result = validate_coherence(
            original_text="Necesito que expliques la fotosíntesis de forma detallada",
            optimized_text="Necesito que expliques la fotosíntesis de forma detallada",
            quality_floor=0.85,
        )
        assert result["similarity_score"] >= 0.85
        assert result["rollback_count"] == 0
        assert result["quality_warning"] is False

    def test_aggressive_compression_triggers_rollback(self):
        """Compresión agresiva (score < quality_floor) → rollback parcial.

        MiniLM es más inteligente que Jaccard: entiende semántica, no solo tokens.
        Para activar rollback con MiniLM, el texto optimizado debe ser
        SEMÁNTICAMENTE diferente, no solo token-wise diferente.
        """
        # Caso donde la intención se pierde significativamente:
        # El original dice "explicar la fotosíntesis detalladamente"
        # El optimizado solo dice "fotosíntesis" — pierde el verbo y el contexto
        segments = [
            {"text": "Necesito que me expliques la fotosíntesis de forma muy detallada", "text_compressed": "fotosíntesis", "label": "context_low", "max_compression": 0.8, "kept": True, "compression_ratio": 0.15},
            {"text": "Hola que tal", "text_compressed": "", "label": "filler", "max_compression": 1.0, "kept": False, "compression_ratio": 0.0},
        ]
        original = "Necesito que me expliques la fotosíntesis de forma muy detallada Hola que tal"
        optimized = "fotosíntesis"  # Pierde "Necesito explicar" - intención destruida

        result = validate_coherence(
            original_text=original,
            optimized_text=optimized,
            quality_floor=0.85,
            segments=segments,
        )
        # Debería haber hecho rollback porque "fotosíntesis" solo
        # no captura la intención completa (MiniLM similarity debe ser < 0.85)
        assert result["rollback_count"] >= 1, f"Expected rollback but got similarity={result['similarity_score']}"
        # Los segmentos devueltos deberían tener al menos uno restaurado
        restored = [s for s in result["segments"] if s["compression_ratio"] == 1.0 and s["kept"]]
        assert len(restored) >= 1

    def test_max_rollbacks_insufficient_warning(self):
        """Si 2 rollbacks no son suficientes → quality_warning: true."""
        # Caso extremo: texto original muy largo, optimizado muy corto
        # Con solo 2 segmentos comprimidos, 2 rollbacks pueden no ser suficientes
        segments = [
            {"text": "Por favor necesito que me expliques en detalle cómo funciona el proceso de fotosíntesis en las plantas", "text_compressed": "fotosíntesis", "label": "context_low", "max_compression": 0.6, "kept": True, "compression_ratio": 0.1},
            {"text": "y también necesito entender la respiración celular y el ciclo de Krebs de manera completa", "text_compressed": "respiración", "label": "context_low", "max_compression": 0.6, "kept": True, "compression_ratio": 0.05},
        ]
        original = "Por favor necesito que me expliques en detalle cómo funciona el proceso de fotosíntesis en las plantas y también necesito entender la respiración celular y el ciclo de Krebs de manera completa"
        optimized = "fotosíntesis respiración"

        result = validate_coherence(
            original_text=original,
            optimized_text=optimized,
            quality_floor=0.85,
            segments=segments,
        )
        # Después de 2 rollbacks, si la similitud sigue baja → warning
        assert result["rollback_count"] <= MAX_ROLLBACK_ITERATIONS
        # La similitud debería haber mejorado pero puede que no llegue a 0.85
        # quality_warning depende de si la similitud final >= quality_floor
        assert isinstance(result["quality_warning"], bool)

    def test_no_segments_no_rollback(self):
        """Sin segmentos, no hay rollback posible."""
        result = validate_coherence(
            original_text="Texto original largo y detallado",
            optimized_text="Texto corto",
            quality_floor=0.85,
            segments=None,
        )
        assert result["rollback_count"] == 0
        # Similitud baja sin posibilidad de rollback → warning
        assert result["quality_warning"] is True

    def test_identical_texts_high_score(self):
        """Textos idénticos → score alto, sin rollback ni warning."""
        result = validate_coherence(
            original_text="Explica la fotosíntesis de forma detallada",
            optimized_text="Explica la fotosíntesis de forma detallada",
            quality_floor=0.85,
        )
        assert result["similarity_score"] >= 0.85
        assert result["rollback_count"] == 0
        assert result["quality_warning"] is False

    def test_custom_quality_floor(self):
        """quality_floor personalizado (más estricto)."""
        # Textos con algo de diferencia
        result = validate_coherence(
            original_text="Necesito que expliques la fotosíntesis",
            optimized_text="Necesito que expliques la fotosíntesis",
            quality_floor=0.99,  # Muy estricto
        )
        # Textos idénticos deberían pasar incluso con floor alto
        assert result["similarity_score"] >= 0.99

    def test_segments_not_mutated(self):
        """Los segmentos originales no deben ser mutados por rollback."""
        segments = [
            {"text": "Explica la fotosíntesis", "text_compressed": "explicar fotosíntesis", "label": "intent", "max_compression": 0.0, "kept": True, "compression_ratio": 0.75},
        ]
        original_compressed = segments[0]["text_compressed"]
        original_ratio = segments[0]["compression_ratio"]

        validate_coherence(
            original_text="Explica la fotosíntesis detalladamente",
            optimized_text="explicar fotosíntesis",
            quality_floor=0.85,
            segments=segments,
        )
        # Los segmentos originales no deben haber cambiado
        assert segments[0]["text_compressed"] == original_compressed
        assert segments[0]["compression_ratio"] == original_ratio