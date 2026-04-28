"""
D2 — Semantic Segmenter

Divide el prompt en segmentos y los etiqueta como:
intent, constraint, context_high, context_low, filler

Versión completa (Fase 4):
- spaCy para segmentación de oraciones (fallback a regex)
- MiniLM embeddings para agrupación semántica (fallback a heurística)
- Etiquetado heurístico con prioridad: filler > constraint > intent > context_high > context_low

Contrato de salida (NO cambiar):
- Retorna list[dict] con keys: text, label, embedding
- Labels: intent, constraint, context_high, context_low, filler
- Signature: segment_prompt(text, verified_intent="general", paragraph_count=1)
"""

import re
import logging
from typing import Optional

import numpy as np

logger = logging.getLogger("iandes-server")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SIMILARITY_THRESHOLD = 0.65  # Umbral para agrupar oraciones consecutivas

# ---------------------------------------------------------------------------
# Heuristic patterns (unchanged from placeholder, used for labeling)
# ---------------------------------------------------------------------------

INTENT_VERBS = re.compile(
    r'\b(explica|explain|resume|summarize|analiza|analyze|compara|compare|'
    r'genera|generate|escribe|write|corrige|fix|traduce|translate|'
    r'describe|clasifica|classify|planifica|plan|enumera|list|'
    r'evalua|evaluate|crea|create|haz|make|dime|tell|'
    r'necesito|need|quiero|want|ayuda|help)\b',
    re.IGNORECASE
)

CONSTRAINT_PATTERNS = re.compile(
    r'\b(no|solo|únicamente|solamente|nunca|jamás|evita|avoid|'
    r'asegúrate|make sure|sin|without|no uses|don\'t use|'
    r'máximo|max|mínimo|min|en menos de|formato|'
    r'restringido|restricted|prohibido|forbidden)\b',
    re.IGNORECASE
)

FILLER_PATTERNS = re.compile(
    r'^(?:hola|hey|ey|saludos|buenos?\s*(?:d[ií]as|tardes|noches)|'
    r'espero\s+que\s+(?:te\s+)?est[eé]s?\s+bien|'
    r'c[oó]mo\s+est[aá]s|qu[eé]\s+tal)\b',
    re.IGNORECASE
)

FILLER_ENDINGS = re.compile(
    r'(?:gracias|muchas\s+gracias|gracias\s+por\s+(?:tu|su)\s+(?:ayuda|tiempo)|'
    r'te\s+lo\s+agradezco|quedo\s+atent[oa]|'
    r'saludos(?:\s+cordiales)?|por\s+favor|porfa)\s*[.!]?\s*$',
    re.IGNORECASE
)

CONTEXT_HIGH_PATTERNS = re.compile(
    r'(?:'
    r'\b(?:contexto|background|antecedentes)\b|'
    r'\b\d{4}\b|'
    r'\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|'
    r'https?://\S+|'
    r'\b[A-Z][\wáéíóúñüÁÉÍÓÚÑÜ]+(?:\s[A-Z][\wáéíóúñüÁÉÍÓÚÑÜ]+)+\b|'
    r'\b[A-Z]{2,}\b'
    r')'
)

# ---------------------------------------------------------------------------
# spaCy sentence splitting
# ---------------------------------------------------------------------------

_spacy_nlp = None


def _get_spacy():
    """Lazy-load spaCy model. Returns None if not available."""
    global _spacy_nlp
    if _spacy_nlp is not None:
        return _spacy_nlp
    try:
        from models.loader import get_spacy_model
        _spacy_nlp = get_spacy_model()
        return _spacy_nlp
    except Exception as e:
        logger.warning(f"spaCy no disponible, usando fallback regex: {e}")
        return None


def _split_with_spacy(text: str) -> list:
    """
    Divide texto en oraciones usando spaCy.

    Returns list of sentence strings. Falls back to regex on error.
    """
    nlp = _get_spacy()
    if nlp is None:
        return _split_with_regex(text)

    try:
        doc = nlp(text)
        sentences = [sent.text.strip() for sent in doc.sents if sent.text.strip()]
        return sentences if sentences else [text.strip()]
    except Exception as e:
        logger.warning(f"Error en spaCy sentence split: {e}")
        return _split_with_regex(text)


def _split_with_regex(text: str) -> list:
    """
    Divide texto en oraciones usando regex (fallback).

    Maneja casos especiales como abreviaciones y números.
    """
    if not text or not text.strip():
        return []

    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    sentences = [s.strip() for s in sentences if s.strip()]

    if not sentences:
        sentences = [text.strip()]

    return sentences


# ---------------------------------------------------------------------------
# MiniLM embeddings
# ---------------------------------------------------------------------------

_sentence_model = None


def _get_sentence_model():
    """Lazy-load MiniLM model. Returns None if not available."""
    global _sentence_model
    if _sentence_model is not None:
        return _sentence_model
    try:
        from models.loader import get_sentence_model
        _sentence_model = get_sentence_model()
        return _sentence_model
    except Exception as e:
        logger.warning(f"MiniLM no disponible, usando heurística: {e}")
        return None


def _compute_embeddings(sentences: list) -> Optional[np.ndarray]:
    """
    Genera embeddings para una lista de oraciones usando MiniLM.

    Returns numpy array of shape (len(sentences), 384) or None if unavailable.
    """
    model = _get_sentence_model()
    if model is None:
        return None

    try:
        embeddings = model.encode(sentences, convert_to_numpy=True, show_progress_bar=False)
        return embeddings
    except Exception as e:
        logger.warning(f"Error generando embeddings: {e}")
        return None


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Computa similitud coseno entre dos vectores."""
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


# ---------------------------------------------------------------------------
# Semantic grouping
# ---------------------------------------------------------------------------

def _group_sentences_by_similarity(
    sentences: list,
    embeddings: np.ndarray,
    threshold: float = SIMILARITY_THRESHOLD,
) -> list[list[int]]:
    """
    Agrupa oraciones consecutivas por similitud semántica.

    Si la similitud coseno entre oración i e i-1 >= threshold,
    se agrupan en el mismo segmento.

    Returns lista de grupos, donde cada grupo es una lista de índices.
    """
    n = len(sentences)
    if n == 0:
        return []
    if n == 1:
        return [[0]]

    groups = [[0]]

    for i in range(1, n):
        sim = _cosine_similarity(embeddings[i], embeddings[i - 1])

        if sim >= threshold:
            # Agrupar con el segmento anterior
            groups[-1].append(i)
        else:
            # Nuevo segmento
            groups.append([i])

    return groups


def _group_sentences_by_heuristic(sentences: list) -> list[list[int]]:
    """
    Agrupa oraciones usando heurística (fallback sin embeddings).

    Estrategia: cada oración es su propio segmento.
    En el futuro se puede mejorar con reglas de longitud y puntuación.
    """
    return [[i] for i in range(len(sentences))]


# ---------------------------------------------------------------------------
# Labeling
# ---------------------------------------------------------------------------

def _classify_sentence(sentence: str, verified_intent: str) -> str:
    """
    Clasifica una oración en uno de los 5 labels.

    Prioridad: filler > constraint > intent > context_high > context_low
    """
    stripped = sentence.strip()
    if not stripped:
        return "filler"

    # 1. Filler: saludos y despedidas
    if FILLER_PATTERNS.match(stripped):
        return "filler"

    if FILLER_ENDINGS.search(stripped):
        return "filler"

    # Cortesías comunes en medio de oración
    if re.search(r'\b(?:por\s+favor|porfa|si\s+no\s+es\s+molestia|te\s+agradezco|'
                 r'me\s+gustar[ií]a|quisiera|podr[ií]as?|puedes?)\b', stripped, re.IGNORECASE):
        courtesy_words = len(re.findall(
            r'\b(?:por\s+favor|porfa|si\s+no\s+es\s+molestia|te\s+agradezco|'
            r'me\s+gustar[ií]a|quisiera|podr[ií]as?|puedes?)\b',
            stripped, re.IGNORECASE
        ))
        total_words = len(stripped.split())
        if courtesy_words / max(total_words, 1) > 0.4:
            return "filler"

    # 2. Constraint: restricciones explícitas
    if CONSTRAINT_PATTERNS.search(stripped):
        return "constraint"

    # 3. Intent: verbos de acción
    if INTENT_VERBS.search(stripped):
        return "intent"

    # 4. Context high: entidades nombradas, datos específicos
    if CONTEXT_HIGH_PATTERNS.search(stripped):
        return "context_high"

    # 5. Default: context_low
    return "context_low"


def _label_segment(segment_text: str, verified_intent: str) -> str:
    """
    Etiqueta un segmento completo (puede contener múltiples oraciones).

    Usa la oración más representativa (la primera con verbos de acción o restricción).
    Si todas las oraciones son similares, usa la primera.
    """
    # Dividir el segmento en oraciones para etiquetar
    sub_sentences = re.split(r'(?<=[.!?])\s+', segment_text.strip())
    sub_sentences = [s.strip() for s in sub_sentences if s.strip()]

    if not sub_sentences:
        return _intent_to_label(verified_intent)

    # Etiquetar cada sub-oración y tomar la más restrictiva
    labels = [_classify_sentence(s, verified_intent) for s in sub_sentences]

    # Prioridad: filler > constraint > intent > context_high > context_low
    priority = {"filler": 0, "constraint": 1, "intent": 2, "context_high": 3, "context_low": 4}
    min_priority = min(priority.get(l, 4) for l in labels)
    for label, p in priority.items():
        if p == min_priority:
            return label

    return "context_low"


def _intent_to_label(intent: str) -> str:
    """Convierte el intent verificado en un label de segmento."""
    mapping = {
        "code": "intent",
        "qa": "intent",
        "creative": "intent",
        "general": "context_low",
        "long_context": "context_low",
    }
    return mapping.get(intent, "context_low")


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def segment_prompt(text: str, verified_intent: str = "general", paragraph_count: int = 1) -> list:
    """
    Segmenta el prompt en segmentos etiquetados.

    Versión completa: usa spaCy + MiniLM con fallback a heurísticas.

    Args:
        text: Texto del prompt
        verified_intent: Intent verificado por D1
        paragraph_count: Número de párrafos (hint del pre-flight)

    Returns:
        Lista de dicts con keys: text, label, embedding
    """
    if not text or not text.strip():
        return []

    # 1. Dividir en oraciones (spaCy con fallback a regex)
    sentences = _split_with_spacy(text)

    if not sentences:
        return [{"text": text, "label": _intent_to_label(verified_intent), "embedding": None}]

    # Si solo hay una oración, etiquetar directamente
    if len(sentences) == 1:
        label = _classify_sentence(sentences[0], verified_intent)
        # Override: si el intent verificado es fuerte (code, qa, creative),
        # y la oración no es filler/constraint, usar el intent verificado
        if verified_intent in ("code", "qa", "creative") and label not in ("filler", "constraint"):
            label = "intent"
        return [{"text": sentences[0], "label": label, "embedding": None}]

    # 2. Generar embeddings (MiniLM con fallback a heurística)
    embeddings = _compute_embeddings(sentences)

    # 3. Agrupar oraciones por similitud
    if embeddings is not None and len(embeddings) == len(sentences):
        groups = _group_sentences_by_similarity(sentences, embeddings, SIMILARITY_THRESHOLD)
    else:
        groups = _group_sentences_by_heuristic(sentences)

    # 4. Construir segmentos
    segments = []
    for group in groups:
        # Concatenar oraciones del grupo
        group_text = " ".join(sentences[i] for i in group).strip()

        # Etiquetar el segmento
        label = _label_segment(group_text, verified_intent)

        # Embedding del segmento (promedio de embeddings del grupo, o None)
        segment_embedding = None
        if embeddings is not None:
            group_embeddings = embeddings[group]
            segment_embedding = np.mean(group_embeddings, axis=0).tolist()

        segments.append({
            "text": group_text,
            "label": label,
            "embedding": segment_embedding,
        })

    # 5. Si solo hay un segmento, usar el intent verificado
    if len(segments) == 1:
        segments[0]["label"] = _intent_to_label(verified_intent)

    return segments