"""
Impact Calculator — Fórmulas de impacto ambiental

Fórmulas:
  CO₂ por token = 0.0023 gramos
  Fuente: Patterson et al. (2021) "Carbon Footprint of Machine Learning"

  Agua por token = 0.50 ml
  Fuente: Li et al. (2023) "Making AI Less Thirsty"

Nota: Se investigarán papers más recientes para actualizar estos valores.
"""

CO2_GRAMS_PER_TOKEN = 0.0023
WATER_ML_PER_TOKEN = 0.50

METHODOLOGY_REF = (
    '{"co2": "Patterson et al. (2021) - Carbon Footprint of Machine Learning", '
    '"water": "Li et al. (2023) - Making AI Less Thirsty"}'
)


def estimate_tokens(text: str) -> int:
    """
    Estima el número de tokens de un texto.
    Fórmula simple: caracteres / 4.
    Consistente con la estimación del cliente.
    """
    if not text:
        return 0
    return max(1, round(len(text) / 4))


def calculate_savings(original_tokens: int, optimized_tokens: int) -> dict:
    """
    Calcula el ahorro ambiental basado en tokens ahorrados.

    Args:
        original_tokens: Tokens del prompt original
        optimized_tokens: Tokens del prompt optimizado

    Returns:
        dict con tokens_saved, co2_grams_saved, water_ml_saved, methodology_ref
    """
    tokens_saved = max(0, original_tokens - optimized_tokens)

    return {
        "tokens_saved": tokens_saved,
        "co2_grams_saved": round(tokens_saved * CO2_GRAMS_PER_TOKEN, 4),
        "water_ml_saved": round(tokens_saved * WATER_ML_PER_TOKEN, 2),
        "methodology_ref": METHODOLOGY_REF,
    }