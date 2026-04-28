"""
D3 — Budget Controller

Lookup table determinista que asigna compresión máxima por tipo de segmento.
Incluye lógica de redistribución cuando max_output_tokens está definido.

| Label          | Max compression | Reason                              |
|----------------|-----------------|-------------------------------------|
| intent         | 0%              | Core user intent, untouchable       |
| constraint     | 0%              | Wrong compression = wrong outputs   |
| context_high   | 20%             | Relevant, compress with care        |
| context_low    | 60%             | Accessory, likely redundant         |
| filler         | 100%            | No informational value              |
"""

from impact.calculator import estimate_tokens

BUDGET_TABLE = {
    "intent": 0.0,
    "constraint": 0.0,
    "context_high": 0.20,
    "context_low": 0.60,
    "filler": 1.0,
}

# Prioridad de compresión: de mayor a menor compresión permitida.
# Cuando se necesita redistribuir, se comprime primero los de mayor prioridad.
COMPRESSION_PRIORITY = ["filler", "context_low", "context_high"]


def assign_budgets(segments: list, max_output_tokens: int = None) -> list:
    """
    Asigna presupuesto de compresión a cada segmento.

    Args:
        segments: Lista de dicts con keys: text, label
        max_output_tokens: Límite duro de tokens en output (None = sin límite)

    Returns:
        Lista de dicts con key adicional: max_compression (float)
    """
    # Paso 1: Asignar presupuestos base
    result = []
    for seg in segments:
        label = seg.get("label", "general")
        max_comp = BUDGET_TABLE.get(label, 0.0)
        result.append({**seg, "max_compression": max_comp})

    # Paso 2: Si no hay límite de tokens, retornar presupuestos base
    if max_output_tokens is None:
        return result

    # Paso 3: Calcular tokens estimados del output con presupuestos base
    estimated_output = _estimate_output_tokens(result)

    if estimated_output <= max_output_tokens:
        # El output ya cabe dentro del límite
        return result

    # Paso 4: Redistribuir presupuestos para cumplir el límite
    return _redistribute_budgets(result, max_output_tokens)


def _estimate_output_tokens(segments: list) -> int:
    """
    Estima los tokens del output después de aplicar compresión.

    Para segmentos con max_compression=0: tokens completos.
    Para segmentos con max_compression=1: 0 tokens (eliminados).
    Para segmentos con compresión parcial: tokens * (1 - max_compression).
    """
    total = 0
    for seg in segments:
        original_text = seg.get("text", "")
        original_tokens = estimate_tokens(original_text)
        max_comp = seg.get("max_compression", 0.0)

        if max_comp >= 1.0:
            # Eliminado completamente
            continue
        elif max_comp <= 0.0:
            # Intocable
            total += original_tokens
        else:
            # Compresión parcial
            total += int(original_tokens * (1 - max_comp))

    return max(1, total)


def _redistribute_budgets(segments: list, max_output_tokens: int) -> list:
    """
    Redistribuye presupuestos de compresión para cumplir el límite de tokens.

    Estrategia:
    1. Eliminar filler (max_compression=1.0) ya está hecho.
    2. Si aún excede, aumentar compresión de context_low (60% → más).
    3. Si aún excede, aumentar compresión de context_high (20% → más).
    4. Intent y constraint NUNCA se comprimen.

    Args:
        segments: Lista de segmentos con max_compression asignado
        max_output_tokens: Límite duro de tokens

    Returns:
        Lista de segmentos con max_compression redistribuido
    """
    result = [dict(seg) for seg in segments]  # Copia profunda

    # Intentar cada nivel de compresión adicional
    for label in COMPRESSION_PRIORITY:
        current_output = _estimate_output_tokens(result)
        if current_output <= max_output_tokens:
            break

        # Calcular cuántos tokens necesitamos ahorrar
        tokens_to_save = current_output - max_output_tokens

        # Calcular tokens disponibles en segmentos de este tipo
        available_tokens = 0
        for seg in result:
            if seg.get("label") == label and seg.get("max_compression", 0) < 1.0:
                original_text = seg.get("text", "")
                original_tokens = estimate_tokens(original_text)
                current_comp = seg.get("max_compression", 0.0)
                # Tokens que aún se pueden ahorrar
                available_tokens += int(original_tokens * (1 - current_comp))

        if available_tokens == 0:
            continue

        # Calcular nueva compresión para este tipo
        # Distribuir el ahorro necesario proporcionalmente
        for seg in result:
            if seg.get("label") == label and seg.get("max_compression", 0) < 1.0:
                original_text = seg.get("text", "")
                original_tokens = estimate_tokens(original_text)
                current_comp = seg.get("max_compression", 0.0)

                # Cuánto podemos comprimir adicionalmente
                remaining_capacity = 1.0 - current_comp
                # Proporción del ahorro necesario que corresponde a este segmento
                if available_tokens > 0:
                    proportion = original_tokens / available_tokens if available_tokens > 0 else 0
                    additional_comp = min(remaining_capacity, (tokens_to_save / available_tokens) * remaining_capacity)
                    seg["max_compression"] = min(1.0, current_comp + additional_comp)

    return result