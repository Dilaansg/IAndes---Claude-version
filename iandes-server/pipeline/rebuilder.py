"""
D6 — Rebuilder

Construye el response final concatenando los segmentos finales
y calculando métricas de ahorro.

TODO: Implementar en Fase 1 (básico) y refinar en Fases 2-5
"""

from impact.calculator import estimate_tokens, calculate_savings


def rebuild_result(
    original_text: str,
    segments: list,
    original_tokens: int,
    pipeline_ms: dict,
    request_id: str,
) -> dict:
    """
    Construye el OptimizationResult final.

    Args:
        original_text: Prompt original
        segments: Lista de segmentos con text_compressed, label, kept, compression_ratio
        original_tokens: Tokens del prompt original
        pipeline_ms: Tiempos de cada módulo del pipeline
        request_id: ID de la request

    Returns:
        dict con el OptimizationResult completo
    """
    # Concatenar segmentos que se mantienen
    kept_segments = [s for s in segments if s.get("kept", True)]
    optimized_text = " ".join(s.get("text_compressed", s.get("text", "")) for s in kept_segments).strip()

    # Si no hay segmentos, usar el original
    if not optimized_text:
        optimized_text = original_text

    optimized_tokens = estimate_tokens(optimized_text)
    savings = calculate_savings(original_tokens, optimized_tokens)

    return {
        "request_id": request_id,
        "server_version": "5.0.0",
        "optimized_prompt": optimized_text,
        "original_tokens": original_tokens,
        "optimized_tokens": optimized_tokens,
        "similarity_score": 1.0,  # placeholder, vendrá de D5
        "segments": [
            {
                "text": s.get("text", ""),
                "label": s.get("label", "general"),
                "kept": s.get("kept", True),
                "compression_ratio": s.get("compression_ratio", 1.0),
            }
            for s in segments
        ],
        "savings": savings,
        "pipeline_ms": pipeline_ms,
    }