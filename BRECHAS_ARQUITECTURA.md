# Brechas arquitectonicas - IAndes

Fecha: 2026-04-22
Fuente de referencia: PLANOS ARQUITECTONICOS.md

## 1) Modulo de compresion (Capas 0-3)

### 1.1 Capa 0 y Capa 1
- Plan: clasificar y limpiar ruido conversacional localmente.
- Estado actual: implementado.
- Evidencia: content.js (classifyPrompt, applyLayer1).

### 1.2 Capa 2 (ONNX)
- Plan: deduplicacion semantica con ONNX Runtime Web + MiniLM.
- Estado actual: implementado y con runtime local agregado.
- Nota: validar en navegador que el service worker cargue `lib/ort.min.js` sin bloqueos de contexto.
- Evidencia: manifest.json (web_accessible_resources), background.js (importScripts de lib/ort.min.js).

### 1.3 Capa 3 (Ollama)
- Plan: reescritura oportunista con deteccion/scoring de modelos.
- Estado actual: implementado.
- Observacion: ya se alinea modelo recomendado a qwen3.5:2b.

## 2) Modulo de mejora (Capas 0-M, 1-M, 2-M)

### 2.1 Capa 0-M detector de componentes
- Plan: detectar componentes presentes/faltantes y score_completitud.
- Estado actual: en progreso.
- Avance aplicado: analisis basico de componentes y regla score >= 0.8 para no transformar.

### 2.2 Capa 1-M plantillas (sin Ollama)
- Plan: degradacion elegante con mejora estructural sin generacion.
- Estado actual: en progreso.
- Avance aplicado: fallback por plantillas cuando no hay Ollama.

### 2.3 Capa 2-M generativa (con Ollama)
- Plan: mejorar prompt con componentes faltantes/presentes como contexto de reescritura.
- Estado actual: en progreso.
- Avance aplicado: prompt de usuario enriquecido con componentes present/missing para modo improve.

## 3) UX y contrato de interaccion

### 3.1 Diff visual antes de reemplazar
- Plan: mostrar cambios y permitir [Aceptar/Descartar].
- Estado actual: implementado en modo mejorar.
- Avance aplicado: panel de revision con preview de diff y botones Aceptar/Descartar antes de inyectar.

### 3.2 Activacion por accion del usuario
- Plan: procesamiento al activar extension/atajo.
- Estado actual: parcialmente alineado.
- Impacto: hoy se procesa por debounce al escribir.

### 3.3 Estado de popup y telemetria local
- Plan: comunicar degradacion y estado del sistema claramente.
- Estado actual: implementado.
- Avance aplicado: status periodico de sistema, mensaje explicito "sin servidor" y resumen de sesion con datos persistidos.

## 4) Documentacion y coherencia

### 4.1 README
- Plan: documentacion coherente con arquitectura vigente.
- Estado actual: implementado.
- Avance aplicado: se elimino la narrativa contradictoria de servidor local y se documento el flujo local actual.

## 5) Cierre por fases recomendado

Fase A (critica):
1. Validar en navegador la carga real de Capa 2 con ONNX Runtime.
2. Completar pruebas de regresion por proveedor y modo.

Fase B (producto):
1. Mejorar calidad del diff (hoy es preview lineal de bajo costo).
2. Refinar UX de revision (resaltar componentes anadidos por categoria).

Fase C (calidad):
1. Refinar detector 0-M con señales semanticas mas robustas.
2. Pruebas por proveedor (ChatGPT/Claude/Gemini) y por modo (compress/improve).
