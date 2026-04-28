"""
PromptAnalysis v2.0 — Schema de request

Contrato entre la extensión Chrome y el servidor IAndes.
"""

from pydantic import BaseModel, Field, field_validator
from typing import Optional
from enum import Enum


class ModeEnum(str, Enum):
    compress = "compress"
    enhance = "enhance"


class IntentEnum(str, Enum):
    code = "code"
    qa = "qa"
    creative = "creative"
    general = "general"


class PreflightInfo(BaseModel):
    """Información de pre-clasificación del cliente."""
    intent: IntentEnum = Field(
        default=IntentEnum.general,
        description="Intent detectado por el pre-flight classifier",
    )
    confidence: float = Field(
        default=0.50,
        ge=0.0,
        le=1.0,
        description="Confianza del pre-flight classifier (0-1)",
    )
    estimated_tokens: int = Field(
        default=0,
        ge=0,
        description="Tokens estimados por el cliente",
    )
    language: str = Field(
        default="unknown",
        description="Idioma detectado: es, en, unknown",
    )
    has_code_blocks: bool = Field(
        default=False,
        description="Si el prompt contiene bloques de código",
    )
    paragraph_count: int = Field(
        default=1,
        ge=1,
        description="Número de párrafos del prompt",
    )


class Constraints(BaseModel):
    """Restricciones para la optimización."""
    max_output_tokens: Optional[int] = Field(
        default=None,
        description="Límite duro de tokens en output. None = sin límite",
    )
    preserve_entities: bool = Field(
        default=True,
        description="Si True, no tocar nombres propios, números, fechas, URLs",
    )
    quality_floor: float = Field(
        default=0.85,
        ge=0.0,
        le=1.0,
        description="Similitud coseno mínima aceptable",
    )


class Metadata(BaseModel):
    """Metadatos de la request."""
    source: str = Field(
        default="unknown",
        description="Proveedor detectado: chatgpt, claude, gemini",
    )
    timestamp: int = Field(
        default=0,
        description="Unix timestamp de la request",
    )


class PromptAnalysis(BaseModel):
    """Schema completo de la request del cliente al servidor."""
    version: str = Field(default="2.0", description="Versión del contrato")
    request_id: str = Field(
        ...,
        description="UUID v4 generado por el cliente",
    )
    raw_prompt: str = Field(
        ...,
        min_length=1,
        max_length=8000,
        description="Texto completo del prompt (máximo 8000 caracteres)",
    )
    mode: ModeEnum = Field(
        default=ModeEnum.compress,
        description="Modo de optimización: compress o enhance",
    )
    preflight: PreflightInfo = Field(
        default_factory=PreflightInfo,
        description="Información de pre-clasificación del cliente",
    )
    constraints: Constraints = Field(
        default_factory=Constraints,
        description="Restricciones para la optimización",
    )
    metadata: Metadata = Field(
        default_factory=Metadata,
        description="Metadatos de la request",
    )

    @field_validator("raw_prompt")
    @classmethod
    def prompt_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("raw_prompt no puede estar vacío")
        return v