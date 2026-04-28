# IAndes v5 — Referencia Rapida para Desarrolladores

## Comandos utiles

```bash
# Instalar dependencias
cd iandes-server && pip install -r requirements.txt && python -m spacy download es_core_news_sm

# Verificar que todo esta listo
python run.py --check

# Instalar dependencias faltantes
python run.py --install

# Ejecutar servidor (con hot-reload)
python run.py

# Ejecutar servidor en puerto personalizado
python run.py --port 9000

# Ejecutar servidor sin hot-reload (produccion)
python run.py --no-reload

# Ejecutar tests
python -m pytest tests/ -v

# Ejecutar un solo modulo de tests
python -m pytest tests/test_verifier.py -v
python -m pytest tests/test_segmenter.py -v
python -m pytest tests/test_integration.py -v

# Verificar estado del servidor
curl http://localhost:8000/health

# Ejecutar optimizacion manual
curl -X POST http://localhost:8000/optimize \
  -H "Content-Type: application/json" \
  -d '{
    "request_id": "test-001",
    "raw_prompt": "Hola, necesito que expliques la fotosintesis. No uses ejemplos.",
    "mode": "compress",
    "preflight": {"intent": "qa", "confidence": 0.80, "language": "es"},
    "constraints": {"preserve_entities": true, "quality_floor": 0.85}
  }'
```

## Contrato de datos entre modulos

Cada modulo recibe y retorna `list[dict]`. Las keys se enriquecen progresivamente:

```
D2 output:  {text, label, embedding}
D3 output:  {text, label, embedding, max_compression}
D4 output:  {text, label, max_compression, text_compressed, compression_ratio, kept}
D5 output:  (modifica segments si hay rollback)
D6 output:  OptimizationResult completo
```

## Labels validos

| Label | max_compression | Descripcion |
|-------|----------------|-------------|
| `intent` | 0.0 | Intencion principal — NUNCA se comprime |
| `constraint` | 0.0 | Restriccion — NUNCA se comprime |
| `context_high` | 0.20 | Contexto relevante — compresion ligera |
| `context_low` | 0.60 | Contexto accesorio — compresion moderada |
| `filler` | 1.0 | Relleno — se puede eliminar completamente |

## Intents validos

| Intent | Descripcion | Mapeo a label |
|--------|-------------|---------------|
| `code` | Programacion, debugging | → intent |
| `qa` | Pregunta, explicacion | → intent |
| `creative` | Escritura creativa | → intent |
| `general` | Todo lo demas | → context_low |

## Constantes importantes

| Constante | Valor | Archivo |
|-----------|-------|---------|
| `CONFIDENCE_THRESHOLD` | 0.60 | verifier.py |
| `QUALITY_FLOOR_DEFAULT` | 0.85 | validator.py |
| `MAX_ROLLBACK_ITERATIONS` | 2 | validator.py |
| `SIMILARITY_THRESHOLD` | 0.65 | segmenter.py |
| `CO2_GRAMS_PER_TOKEN` | 0.0023 | calculator.py |
| `WATER_ML_PER_TOKEN` | 0.50 | calculator.py |

## Formulas de impacto ambiental

```python
tokens_saved = original_tokens - optimized_tokens
co2_grams_saved = tokens_saved * 0.0023  # Patterson et al. (2021)
water_ml_saved = tokens_saved * 0.50      # Li et al. (2023)
```

## Agregar un nuevo test

```python
# tests/test_nuevo_modulo.py
import pytest
from pipeline.nuevo_modulo import nueva_funcion

class TestNuevoModulo:
    def test_caso_basico(self):
        result = nueva_funcion("input")
        assert result == "expected"
```

## Agregar un nuevo label

1. Agregar a `BUDGET_TABLE` en `pipeline/budget.py`
2. Agregar patron de deteccion en `pipeline/segmenter.py`
3. Actualizar `pipeline/pruner.py` si necesita logica especial
4. Agregar tests

## Troubleshooting

| Problema | Solucion |
|-----------|----------|
| `ModuleNotFoundError: No module named 'pipeline'` | Ejecutar desde `iandes-server/` o agregar al PYTHONPATH |
| `OSError: Model 'es_core_news_sm' not found` | `python -m spacy download es_core_news_sm` o `python run.py --install` |
| `MiniLM no disponible` | Verificar que `models/minilm/` existe con los archivos del modelo |
| `quality_warning: true` | Normal con Jaccard fallback. Con MiniLM deberia ser `false` |
| Tests lentos (>30s) | Primer request carga modelos ML. Los siguientes son rapidos. |
| `Extension context invalidated` | Normal al recargar la extension. El content script se protege con `isContextValid()`. Recargar la pagina de ChatGPT lo resuelve. |
| `Failed to construct 'Worker'` en ChatGPT | CSP restrictivo de ChatGPT bloquea Web Workers. El codigo usa heuristica local como fallback. Metricas locales son estimadas (±15%). |
| `Service worker registration failed (15)` | Eliminar `"type": "module"` del manifest. El service worker usa `importScripts()`, no ES modules. |

## Bugs conocidos (no bloqueantes)

| Bug | Impacto | Workaround |
|-----|---------|------------|
| Segmentador etiqueta oraciones con saludo como filler | "Hola, podrias explicarme..." se etiqueta como filler en vez de intent | El validador revierte correctamente (similarity 1.0). Se puede mejorar en v5.1 separando el saludo del contenido. |
| Segmentador menos preciso en ingles | Prompts en ingles pueden tener etiquetas suboptimas | El validador protege contra perdida de informacion. Mejorar patrones ingleses en v5.1. |