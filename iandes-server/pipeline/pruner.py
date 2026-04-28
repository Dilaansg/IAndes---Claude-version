"""
D4 — Token Pruner

Elimina palabras de menor peso TF-IDF dentro de cada segmento
según su presupuesto de compresión.

Estrategia por segmento:
- max_compression == 0.0: devolver sin modificar (intent, constraint)
- max_compression == 1.0: devolver vacío (filler eliminado)
- max_compression entre 0 y 1: TF-IDF para identificar palabras de menor peso,
  proteger entidades (nombres, números, fechas, URLs), y eliminar palabras
  candidatas hasta alcanzar la compresión target.
"""

import re
import math
from collections import Counter

from impact.calculator import estimate_tokens


# ---------------------------------------------------------------------------
# TF-IDF Implementation
# ---------------------------------------------------------------------------

def compute_tfidf(corpus: list) -> list:
    """
    Calcula TF-IDF para cada documento en el corpus.

    Args:
        corpus: Lista de textos (documentos)

    Returns:
        Lista de dicts {palabra: peso_tfidf} para cada documento
    """
    tokenized = [_tokenize(doc) for doc in corpus]
    n_docs = len(tokenized)

    if n_docs == 0:
        return []

    # Document frequency
    doc_freq = Counter()
    for tokens in tokenized:
        unique_tokens = set(tokens)
        for token in unique_tokens:
            doc_freq[token] += 1

    # Calcular IDF
    idf = {}
    for token, df in doc_freq.items():
        idf[token] = math.log((n_docs + 1) / (df + 1)) + 1

    # Calcular TF-IDF para cada documento
    results = []
    for tokens in tokenized:
        tf = Counter(tokens)
        total_tokens = len(tokens) if tokens else 1
        tfidf = {}
        for token, count in tf.items():
            tfidf[token] = (count / total_tokens) * idf.get(token, 1.0)
        results.append(tfidf)

    return results


def _tokenize(text: str) -> list:
    """Tokeniza texto en palabras, preservando palabras con acentos."""
    if not text:
        return []
    tokens = re.findall(r'\b[\wáéíóúñüÁÉÍÓÚÑÜ]+\b', text.lower())
    return tokens


# ---------------------------------------------------------------------------
# Entity Protection
# ---------------------------------------------------------------------------

ENTITY_PATTERNS = [
    re.compile(r'\b\d+(?:\.\d+)?\b'),
    re.compile(r'\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b'),
    re.compile(r'\b\d{4}\b'),
    re.compile(r'https?://\S+'),
    re.compile(r'www\.\S+'),
    re.compile(r'\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)+\b'),
    re.compile(r'\b[A-Z]{2,}\b'),
    re.compile(r'\b[\w.-]+@[\w.-]+\.\w+\b'),
    re.compile(r'```[\s\S]*?```'),
    re.compile(r'`[^`]+`'),
]


def _find_protected_words(text: str) -> set:
    """Encuentra palabras que no deben eliminarse porque son entidades."""
    protected = set()
    for pattern in ENTITY_PATTERNS:
        for match in pattern.finditer(text):
            match_text = match.group().lower()
            words = re.findall(r'\b[\wáéíóúñü]+\b', match_text)
            protected.update(words)
    return protected


# ---------------------------------------------------------------------------
# Verb Protection
# ---------------------------------------------------------------------------

MAIN_VERB_ES = re.compile(
    r'\b(soy|eres|es|somos|son|estoy|estás|está|estamos|están|'
    r'tengo|tienes|tiene|tenemos|tienen|'
    r'puedo|puedes|puede|podemos|pueden|'
    r'quiero|quieres|quiere|queremos|quieren|'
    r'hago|haces|hace|hacemos|hacen|'
    r'digo|dices|dice|decimos|dicen|'
    r'veo|ves|ve|ved|ven|'
    r'sé|sabes|sabe|sabemos|saben|'
    r'debo|debes|debe|debemos|deben|'
    r'voy|vas|va|vamos|van|'
    r'ayuda|explica|resume|analiza|compara|genera|escribe|corrige|'
    r'traduce|describe|clasifica|planifica|enumera|lista|evalua|'
    r'necesito|quiero|puedo|debo|tengo|'
    r'importa|vale|pena|merece|'
    r'funciona|falla|rompe|arregla|mejora|optimiza)\b',
    re.IGNORECASE
)


def _find_main_verbs(text: str) -> set:
    """Encuentra verbos principales en el texto que no deben eliminarse."""
    verbs = set()
    for match in MAIN_VERB_ES.finditer(text):
        verbs.add(match.group().lower())
    return verbs


# ---------------------------------------------------------------------------
# Compression Functions
# ---------------------------------------------------------------------------

def _compress_text(text: str, max_compression: float, corpus: list, preserve_entities: bool = True) -> str:
    """
    Comprime un texto eliminando palabras de menor peso TF-IDF.

    Args:
        text: Texto a comprimir
        max_compression: Ratio de compresión máximo (0.0 = intocable, 1.0 = eliminar todo)
                        Viene del Budget Controller: intent=0.0, filler=1.0, etc.
        corpus: Corpus completo para TF-IDF (todas las oraciones del prompt)
        preserve_entities: Si True, protege entidades nombradas

    Returns:
        Texto comprimido
    """
    if not text or not text.strip():
        return text

    # max_compression: 0.0 = intocable, 1.0 = eliminar todo
    if max_compression <= 0.0:
        return text  # Intocable
    if max_compression >= 1.0:
        return ""  # Eliminar completamente

    original_tokens = _tokenize(text)
    if not original_tokens:
        return text

    # Target: cuántos tokens conservar (1.0 = todos, 0.0 = ninguno)
    keep_ratio = 1.0 - max_compression
    target_token_count = max(1, int(len(original_tokens) * keep_ratio))

    # Calcular TF-IDF usando el corpus completo
    full_corpus = corpus + [text]
    tfidf_scores = compute_tfidf(full_corpus)
    text_tfidf = tfidf_scores[-1] if tfidf_scores else {}

    # Encontrar palabras protegidas
    protected = set()
    if preserve_entities:
        protected = _find_protected_words(text)
    protected.update(_find_main_verbs(text))

    # Ordenar palabras por peso TF-IDF (ascendente = menor peso primero)
    word_scores = []
    for word in set(original_tokens):
        if word in protected:
            continue
        score = text_tfidf.get(word, 0.0)
        word_scores.append((word, score))

    word_scores.sort(key=lambda x: x[1])

    # Determinar cuántas palabras eliminar
    current_count = len(original_tokens)
    words_to_remove = current_count - target_token_count

    if words_to_remove <= 0:
        return text

    # Seleccionar palabras a eliminar (las de menor peso)
    remove_words = set()
    for word, score in word_scores:
        if len(remove_words) >= words_to_remove:
            break
        remove_words.add(word)

    # Reconstruir texto sin las palabras eliminadas
    words = text.split()
    result_words = []
    for word in words:
        clean_word = re.sub(r'[^\wáéíóúñüÁÉÍÓÚÑÜ]', '', word).lower()
        if clean_word in remove_words:
            continue
        result_words.append(word)

    result = " ".join(result_words)

    # Limpiar espacios múltiples y puntuación huérfana
    result = re.sub(r'\s+', ' ', result).strip()
    result = re.sub(r'\s([,.;:!?])', r'\1', result)

    # Verificar que el resultado no está vacío
    if not result:
        return text

    return result


def prune_segments(segments: list, preserve_entities: bool = True) -> list:
    """
    Aplica poda de tokens a cada segmento según su max_compression.

    Args:
        segments: Lista de dicts con keys: text, label, max_compression
        preserve_entities: Si True, protege entidades nombradas

    Returns:
        Lista de dicts con keys adicionales: text_compressed, compression_ratio, kept
    """
    # Construir corpus para TF-IDF (todas las oraciones del prompt)
    corpus = [seg.get("text", "") for seg in segments if seg.get("text")]

    result = []
    for seg in segments:
        max_comp = seg.get("max_compression", 0.0)
        original_text = seg.get("text", "")

        if max_comp >= 1.0:
            # Eliminar completamente (filler)
            result.append({
                **seg,
                "text_compressed": "",
                "compression_ratio": 0.0,
                "kept": False,
            })
        elif max_comp <= 0.0:
            # Intocable (intent, constraint)
            result.append({
                **seg,
                "text_compressed": original_text,
                "compression_ratio": 1.0,
                "kept": True,
            })
        else:
            # Compresión parcial con TF-IDF
            compressed = _compress_text(
                text=original_text,
                max_compression=max_comp,
                corpus=corpus,
                preserve_entities=preserve_entities,
            )

            # Calcular ratio real de compresión
            original_len = len(original_text)
            compressed_len = len(compressed)
            ratio = compressed_len / original_len if original_len > 0 else 1.0

            result.append({
                **seg,
                "text_compressed": compressed,
                "compression_ratio": round(ratio, 2),
                "kept": True,
            })

    return result