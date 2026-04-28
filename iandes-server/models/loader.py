"""
Models Loader — Singleton para carga lazy de modelos ML

Carga spaCy y sentence-transformers una sola vez al inicio del servidor.
Todas las requests posteriores usan los modelos ya cargados en memoria.
"""

import time
import logging
from pathlib import Path

logger = logging.getLogger("iandes-server")

_spacy_model = None
_spacy_loading = False
_sentence_model = None
_sentence_loading = False

SPACY_MODEL_NAME = "es_core_news_sm"
# Local path first, then HuggingFace Hub as fallback
_LOCAL_MINILM_PATH = str(Path(__file__).parent / "minilm")
SENTENCE_MODEL_NAME = _LOCAL_MINILM_PATH


def get_spacy_model():
    """
    Retorna la instancia de spaCy es_core_news_sm.
    Carga en la primera llamada (lazy loading).
    """
    global _spacy_model, _spacy_loading

    if _spacy_model is not None:
        return _spacy_model

    if _spacy_loading:
        # Esperar a que termine la carga
        while _spacy_loading:
            time.sleep(0.1)
        return _spacy_model

    _spacy_loading = True
    try:
        import spacy
        logger.info(f"Cargando modelo spaCy: {SPACY_MODEL_NAME}...")
        start = time.time()
        _spacy_model = spacy.load(SPACY_MODEL_NAME)
        elapsed = time.time() - start
        logger.info(f"Modelo spaCy cargado en {elapsed:.1f}s")
        return _spacy_model
    except OSError:
        logger.error(
            f"Modelo spaCy '{SPACY_MODEL_NAME}' no encontrado. "
            f"Ejecuta: python -m spacy download {SPACY_MODEL_NAME}"
        )
        raise
    finally:
        _spacy_loading = False


def get_sentence_model():
    """
    Retorna la instancia de sentence-transformers.
    Carga en la primera llamada (lazy loading).
    """
    global _sentence_model, _sentence_loading

    if _sentence_model is not None:
        return _sentence_model

    if _sentence_loading:
        while _sentence_loading:
            time.sleep(0.1)
        return _sentence_model

    _sentence_loading = True
    try:
        from sentence_transformers import SentenceTransformer
        logger.info(f"Cargando modelo sentence-transformers: {SENTENCE_MODEL_NAME}...")
        start = time.time()
        _sentence_model = SentenceTransformer(SENTENCE_MODEL_NAME)
        elapsed = time.time() - start
        logger.info(f"Modelo sentence-transformers cargado en {elapsed:.1f}s")
        return _sentence_model
    except Exception as e:
        logger.error(f"Error cargando sentence-transformers: {e}")
        raise
    finally:
        _sentence_loading = False


def get_models_status() -> dict:
    """Retorna el estado de los modelos cargados."""
    return {
        "spacy_ready": _spacy_model is not None,
        "sentence_model_ready": _sentence_model is not None,
    }