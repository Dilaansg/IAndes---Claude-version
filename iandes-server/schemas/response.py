"""
OptimizationResult — Schema de response

Contrato de respuesta del servidor IAndes a la extensión Chrome.
"""

from pydantic import BaseModel, Field
from typing import Optional


class Segment(BaseModel):
    """Segmento del prompt con etiqueta y ratio de compresión."""
    text: str = Field(description="Texto original del segmento")
    label: str = Field(
        description="Tipo de segmento: intent, constraint, context_high, context_low, filler"
    )
    kept: bool = Field(description="Si el segmento se mantiene en el resultado")
    compression_ratio: float = Field(
        ge=0.0,
        le=1.0,
        description="Ratio de compresión: 1.0 = intocado, 0.0 = eliminado",
    )


class Savings(BaseModel):
    """Métricas de ahorro ambiental."""
    tokens_saved: int = Field(description="Tokens ahorrados")
    co2_grams_saved: float = Field(description="CO₂ ahorrado en gramos")
    water_ml_saved: float = Field(description="Agua ahorrada en ml")
    methodology_ref: str = Field(
        description="Referencia académica de las fórmulas"
    )


class PipelineMs(BaseModel):
    """Tiempos de ejecución de cada módulo del pipeline."""
    d1_verifier: int = Field(description="ms en D1 Intent Verifier")
    d2_segmenter: int = Field(description="ms en D2 Semantic Segmenter")
    d3_budget: int = Field(description="ms en D3 Budget Controller")
    d4_pruner: int = Field(description="ms en D4 Token Pruner")
    d5_validator: int = Field(description="ms en D5 Coherence Validator")
    d6_rebuilder: int = Field(description="ms en D6 Rebuilder")
    total: int = Field(description="ms total del pipeline")


class OptimizationResult(BaseModel):
    """Schema completo de la respuesta del servidor."""
    request_id: str = Field(description="UUID v4 de la request original")
    server_version: str = Field(description="Versión del servidor")
    optimized_prompt: str = Field(description="Prompt optimizado, listo para reinyectar")
    original_tokens: int = Field(description="Tokens del prompt original")
    optimized_tokens: int = Field(description="Tokens del prompt optimizado")
    similarity_score: float = Field(
        ge=0.0,
        le=1.0,
        description="Similitud coseno entre original y optimizado",
    )
    segments: list[Segment] = Field(
        default_factory=list,
        description="Segmentos del prompt con etiquetas y ratios",
    )
    savings: Savings = Field(description="Métricas de ahorro ambiental")
    pipeline_ms: PipelineMs = Field(description="Tiempos de ejecución del pipeline")
    quality_warning: bool = Field(
        default=False,
        description="True si el quality_floor no se alcanzó tras 2 rollbacks",
    )