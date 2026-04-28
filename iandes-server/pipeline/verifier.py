"""
D1 — Intent Verifier

Verifica la clasificación de intent del cliente.
Si confidence >= 0.60, acepta sin procesar (bypass).
Si confidence < 0.60, usa spaCy para recalcular intent basándose en:
  - Análisis de entidades nombradas (código, preguntas, creatividad)
  - Dependencias sintácticas (verbos principales)
  - Vocabulario específico por dominio

Intent categories:
  - code: prompts sobre programación, debugging, código
  - qa: preguntas directas, explicaciones solicitadas
  - creative: escritura creativa, brainstorming, generación de contenido
  - general: todo lo demás

Contrato de salida (NO cambiar):
- Retorna dict con keys: verified_intent (str), verification_source ("client"|"server")
- verified_intent es uno de: "code", "qa", "creative", "general"
"""

import re
import logging
from typing import Optional

from schemas.request import PromptAnalysis

logger = logging.getLogger("iandes-server")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CONFIDENCE_THRESHOLD = 0.60  # Below this, recalculate with spaCy

# ---------------------------------------------------------------------------
# Intent classification patterns
# ---------------------------------------------------------------------------

# Code-related patterns
CODE_PATTERNS = re.compile(
    r'\b(?:c[oó]digo|code|programming|programaci[oó]n|function|funci[oó]n|'
    r'variable|class|clase|method|m[eé]todo|debug|error|bug|'
    r'compile|compilar|execute|ejecutar|script|'
    r'python|javascript|java|html|css|sql|api|'
    r'import|export|return|def |async |await |'
    r'print|console\.log|echo)\b',
    re.IGNORECASE
)

# Code block indicators
CODE_BLOCK_PATTERN = re.compile(r'```[\s\S]*?```|`[^`]+`')

# QA-related patterns
QA_PATTERNS = re.compile(
    r'\b(?:explica|explain|qu[eé]\s+es|what\s+is|c[oó]mo\s+(?:funciona|se\s+hace|hacer)|'
    r'how\s+(?:does|do|to|can)|por\s+qu[eé]|why|'
    r'diferencia|difference|definici[oó]n|definition|'
    r'cu[aá]l\s+es|which\s+is|puedes\s+decir|can\s+you\s+tell|'
    r'necesito\s+saber|need\s+to\s+know|'
    r'qu[ií]significa|what\s+does\s+.*\s+mean)\b',
    re.IGNORECASE
)

# Creative-related patterns
CREATIVE_PATTERNS = re.compile(
    r'\b(?:escribe|write|crea|create|genera|generate|'
    r'inventa|invent|imagina|imagine|'
    r'historia|story|poema|poem|canci[oó]n|song|'
    r'brainstorm|lluvia\s+de\s+ideas|'
    r'redacta|draft|compose|componer|'
    r'cuento|tale|novela|novel|relato)\b',
    re.IGNORECASE
)

# spaCy intent keywords (for dependency analysis)
INTENT_VERB_MAP = {
    "code": {"escribir", "programar", "depurar", "compilar", "ejecutar", "implementar",
             "write", "code", "debug", "compile", "run", "implement", "fix"},
    "qa": {"explicar", "entender", "saber", "averiguar", "comprender", "aprender",
           "explain", "understand", "know", "find", "comprehend", "learn"},
    "creative": {"crear", "inventar", "imaginar", "componer", "redactar", "diseñar",
                 "create", "invent", "imagine", "compose", "write", "design"},
}


def _classify_with_patterns(text: str, has_code_blocks: bool) -> str:
    """
    Clasifica el intent usando patrones léxicos.

    Prioridad: code > creative > qa > general
    (code tiene prioridad porque los prompts de código suelen ser los más específicos)
    """
    # Code blocks son un indicador fuerte de intent=code
    if has_code_blocks or CODE_BLOCK_PATTERN.search(text):
        return "code"

    # Contar matches por categoría
    code_matches = len(CODE_PATTERNS.findall(text))
    qa_matches = len(QA_PATTERNS.findall(text))
    creative_matches = len(CREATIVE_PATTERNS.findall(text))

    # Si hay matches de código, es code
    if code_matches > 0:
        return "code"

    # Si hay matches creativos y más que QA
    if creative_matches > 0 and creative_matches >= qa_matches:
        return "creative"

    # Si hay matches de QA
    if qa_matches > 0:
        return "qa"

    # Default
    return "general"


def _classify_with_spacy(text: str, has_code_blocks: bool) -> str:
    """
    Clasifica el intent usando spaCy para análisis sintáctico.

    Usa dependencias sintácticas y entidades nombradas para
    determinar el intent del prompt.

    Primero usa patrones léxicos (rápido y confiable).
    Solo usa spaCy para refinar si los patrones no son concluyentes.
    """
    # Primero: clasificación por patrones (rápida y confiable)
    pattern_intent = _classify_with_patterns(text, has_code_blocks)

    # Si los patrones dan algo específico (no general), confiar en ellos
    if pattern_intent != "general":
        return pattern_intent

    # Si los patrones dan "general", intentar spaCy para refinar
    try:
        from models.loader import get_spacy_model
        nlp = get_spacy_model()
    except Exception as e:
        logger.warning(f"spaCy no disponible para verifier: {e}")
        return pattern_intent  # "general"

    try:
        doc = nlp(text)

        code_indicators = 0
        qa_indicators = 0
        creative_indicators = 0

        for token in doc:
            lemma_lower = token.lemma_.lower()

            # Verbos principales
            if token.pos_ == "VERB":
                for intent, verbs in INTENT_VERB_MAP.items():
                    if lemma_lower in verbs:
                        if intent == "code":
                            code_indicators += 2
                        elif intent == "qa":
                            qa_indicators += 1
                        elif intent == "creative":
                            creative_indicators += 1

        # Code blocks (del parámetro)
        if has_code_blocks:
            code_indicators += 3

        # Decidir basado en indicadores de spaCy
        if code_indicators >= 2:
            return "code"
        if creative_indicators > qa_indicators and creative_indicators > 0:
            return "creative"
        if qa_indicators > 0:
            return "qa"

        return "general"

    except Exception as e:
        logger.warning(f"Error en spaCy verifier: {e}")
        return pattern_intent


def _compute_server_confidence(text: str, intent: str) -> float:
    """
    Estima la confianza del intent calculado por el servidor.

    Heurística: más patrones coincidentes = más confianza.
    """
    code_matches = len(CODE_PATTERNS.findall(text))
    qa_matches = len(QA_PATTERNS.findall(text))
    creative_matches = len(CREATIVE_PATTERNS.findall(text))
    has_code = bool(CODE_BLOCK_PATTERN.search(text))

    total_matches = code_matches + qa_matches + creative_matches
    if has_code:
        total_matches += 2

    if total_matches == 0:
        return 0.40  # Sin patrones, confianza baja

    # Más matches = más confianza, con cap en 0.95
    confidence = min(0.40 + (total_matches * 0.10), 0.95)

    # Bonus si el intent coincide con los patrones dominantes
    if intent == "code" and (code_matches > 0 or has_code):
        confidence = min(confidence + 0.10, 0.95)
    elif intent == "qa" and qa_matches > 0:
        confidence = min(confidence + 0.10, 0.95)
    elif intent == "creative" and creative_matches > 0:
        confidence = min(confidence + 0.10, 0.95)

    return round(confidence, 2)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def verify_intent(payload: PromptAnalysis) -> dict:
    """
    Verifica el intent del prompt.

    Si confidence >= 0.60, acepta el intent del cliente (bypass).
    Si confidence < 0.60, recalcula con spaCy + patrones.

    Args:
        payload: PromptAnalysis con preflight.intent, preflight.confidence,
                 raw_prompt, preflight.has_code_blocks

    Returns:
        dict con keys:
            verified_intent: str ("code"|"qa"|"creative"|"general")
            verification_source: str ("client"|"server")
            confidence: float (0-1)
    """
    client_intent = payload.preflight.intent.value
    client_confidence = payload.preflight.confidence
    text = payload.raw_prompt
    has_code_blocks = payload.preflight.has_code_blocks

    # Si la confianza del cliente es suficiente, aceptar sin procesar
    if client_confidence >= CONFIDENCE_THRESHOLD:
        return {
            "verified_intent": client_intent,
            "verification_source": "client",
            "confidence": client_confidence,
        }

    # Confianza baja: recalcular con spaCy + patrones
    logger.info(
        f"Intent verification: client confidence {client_confidence} < {CONFIDENCE_THRESHOLD}, "
        f"recalculating with server analysis"
    )

    # Intentar spaCy primero, fallback a patrones
    server_intent = _classify_with_spacy(text, has_code_blocks)
    server_confidence = _compute_server_confidence(text, server_intent)

    # Si el servidor tiene más confianza, usar el resultado del servidor
    if server_confidence > client_confidence:
        return {
            "verified_intent": server_intent,
            "verification_source": "server",
            "confidence": server_confidence,
        }

    # Si el cliente sigue siendo mejor, mantener el del cliente
    return {
        "verified_intent": client_intent,
        "verification_source": "client",
        "confidence": client_confidence,
    }