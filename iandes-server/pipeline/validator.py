"""
D5 — Coherence Validator

Verifica que el prompt optimizado preserve la intención del original
usando similitud coseno entre embeddings (MiniLM) con fallback a
similitud Jaccard sobre tokens.

Si similarity_score < quality_floor, activa rollback parcial:
restaura el segmento más problemático y recalcula.
Máximo 2 iteraciones de rollback.

Si tras 2 rollbacks no se alcanza quality_floor → quality_warning: true.
"""

import copy
import logging
from typing import Optional

logger = logging.getLogger("iandes-server")

QUALITY_FLOOR_DEFAULT = 0.85
MAX_ROLLBACK_ITERATIONS = 2

# ---------------------------------------------------------------------------
# Similarity computation
# ---------------------------------------------------------------------------

def _tokenize_simple(text: str) -> set:
    """Tokeniza texto en un set de palabras en minúsculas para Jaccard."""
    import re
    if not text:
        return set()
    return set(re.findall(r'\b[\wáéíóúñü]+\b', text.lower()))


def _jaccard_similarity(text_a: str, text_b: str) -> float:
    """
    Similitud Jaccard entre dos textos basada en tokens.

    Fallback cuando MiniLM no está disponible.
    Jaccard = |A ∩ B| / |A ∪ B|
    """
    tokens_a = _tokenize_simple(text_a)
    tokens_b = _tokenize_simple(text_b)

    if not tokens_a and not tokens_b:
        return 1.0
    if not tokens_a or not tokens_b:
        return 0.0

    intersection = tokens_a & tokens_b
    union = tokens_a | tokens_b
    return len(intersection) / len(union)


def _cosine_similarity_embeddings(text_a: str, text_b: str) -> float:
    """
    Similitud coseno usando embeddings de MiniLM.

    Retorna None si el modelo no está disponible.
    """
    try:
        from models.loader import get_sentence_model
        import numpy as np

        model = get_sentence_model()
        embeddings = model.encode([text_a, text_b], convert_to_numpy=True)

        # Cosine similarity: dot(a,b) / (norm(a) * norm(b))
        norm_a = np.linalg.norm(embeddings[0])
        norm_b = np.linalg.norm(embeddings[1])

        if norm_a == 0 or norm_b == 0:
            return 1.0

        similarity = float(np.dot(embeddings[0], embeddings[1]) / (norm_a * norm_b))
        # Clamp to [0, 1] — MiniLM can produce values slightly outside range
        return max(0.0, min(1.0, similarity))

    except Exception as e:
        logger.warning(f"MiniLM no disponible, usando fallback Jaccard: {e}")
        return None


def compute_similarity(text_a: str, text_b: str) -> float:
    """
    Computa similitud entre dos textos.

    Intenta MiniLM primero; si no está disponible, usa Jaccard.
    """
    # Intentar MiniLM primero
    mlm_sim = _cosine_similarity_embeddings(text_a, text_b)
    if mlm_sim is not None:
        return mlm_sim

    # Fallback a Jaccard
    return _jaccard_similarity(text_a, text_b)


# ---------------------------------------------------------------------------
# Rollback logic
# ---------------------------------------------------------------------------

def _find_worst_segment(segments: list, original_text: str) -> Optional[int]:
    """
    Encuentra el índice del segmento comprimido con peor similitud individual.

    Solo considera segmentos que fueron comprimidos (kept=True, compression_ratio < 1.0).
    Retorna None si no hay segmentos candidatos para rollback.
    """
    worst_idx = None
    worst_sim = 1.0  # Start with perfect similarity

    for i, seg in enumerate(segments):
        # Solo considerar segmentos que fueron comprimidos (no eliminados, no intactos)
        if not seg.get("kept", True):
            continue  # Skip eliminated segments (filler)
        if seg.get("compression_ratio", 1.0) >= 1.0:
            continue  # Skip intact segments (intent, constraint)

        original_seg = seg.get("text", "")
        compressed_seg = seg.get("text_compressed", "")

        if not original_seg or not compressed_seg:
            continue

        sim = _jaccard_similarity(original_seg, compressed_seg)
        if sim < worst_sim:
            worst_sim = sim
            worst_idx = i

    return worst_idx


def _restore_segment(segments: list, idx: int) -> None:
    """
    Restaura un segmento a su texto original (rollback).

    Modifica el segmento in-place: text_compressed = text, compression_ratio = 1.0.
    """
    seg = segments[idx]
    seg["text_compressed"] = seg.get("text", "")
    seg["compression_ratio"] = 1.0
    seg["kept"] = True


def _rebuild_optimized_text(segments: list, fallback_text: str) -> str:
    """
    Reconstruye el texto optimizado a partir de los segmentos.

    Si el resultado está vacío, usa fallback_text (principio: nunca dejar vacío).
    """
    kept = [s for s in segments if s.get("kept", True)]
    text = " ".join(
        s.get("text_compressed", s.get("text", "")) for s in kept
    ).strip()
    return text if text else fallback_text


# ---------------------------------------------------------------------------
# Main validation function
# ---------------------------------------------------------------------------

def validate_coherence(
    original_text: str,
    optimized_text: str,
    quality_floor: float = QUALITY_FLOOR_DEFAULT,
    segments: Optional[list] = None,
) -> dict:
    """
    Valida la coherencia entre el prompt original y el optimizado.

    Si similarity < quality_floor, realiza rollback parcial:
    restaura el segmento más problemático y recalcula.
    Máximo MAX_ROLLBACK_ITERATIONS iteraciones.

    Args:
        original_text: Prompt original
        optimized_text: Prompt optimizado (provisional)
        quality_floor: Umbral mínimo de similitud (default 0.85)
        segments: Lista de segmentos pruned (para rollback). Si es None, no hay rollback.

    Returns:
        dict con keys:
            similarity_score: float (0.0-1.0)
            rollback_count: int (0-2)
            quality_warning: bool (True si no se alcanza quality_floor)
            segments: lista de segmentos (potencialmente modificados por rollback)
    """
    # Deep copy segments para no mutar el original
    working_segments = copy.deepcopy(segments) if segments else None

    # Calcular similitud inicial
    similarity = compute_similarity(original_text, optimized_text)

    # Si la similitud ya es suficiente, pasar sin rollback
    if similarity >= quality_floor:
        return {
            "similarity_score": round(similarity, 4),
            "rollback_count": 0,
            "quality_warning": False,
            "segments": working_segments,
        }

    # Si no hay segmentos, no podemos hacer rollback
    if not working_segments:
        logger.warning(
            f"Similitud {similarity:.4f} < quality_floor {quality_floor}, "
            f"pero no hay segmentos para rollback"
        )
        return {
            "similarity_score": round(similarity, 4),
            "rollback_count": 0,
            "quality_warning": True,
            "segments": None,
        }

    # Rollback parcial: restaurar segmentos más problemáticos
    rollback_count = 0

    for iteration in range(MAX_ROLLBACK_ITERATIONS):
        # Encontrar el segmento con peor similitud individual
        worst_idx = _find_worst_segment(working_segments, original_text)

        if worst_idx is None:
            # No hay más segmentos candidatos para rollback
            logger.info(f"Rollback iter {iteration + 1}: no hay más segmentos candidatos")
            break

        # Restaurar el segmento problemático
        _restore_segment(working_segments, worst_idx)
        rollback_count += 1

        # Reconstruir texto optimizado con el segmento restaurado
        new_optimized = _rebuild_optimized_text(working_segments, original_text)

        # Recalcular similitud
        similarity = compute_similarity(original_text, new_optimized)

        logger.info(
            f"Rollback iter {rollback_count}: restaurado segmento {worst_idx}, "
            f"similitud {similarity:.4f}"
        )

        if similarity >= quality_floor:
            return {
                "similarity_score": round(similarity, 4),
                "rollback_count": rollback_count,
                "quality_warning": False,
                "segments": working_segments,
            }

    # No se alcanzó quality_floor tras max rollbacks
    logger.warning(
        f"Similitud {similarity:.4f} < quality_floor {quality_floor} "
        f"tras {rollback_count} rollbacks"
    )
    return {
        "similarity_score": round(similarity, 4),
        "rollback_count": rollback_count,
        "quality_warning": True,
        "segments": working_segments,
    }