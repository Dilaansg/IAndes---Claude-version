# IAndes

Extension MV3 para optimizar prompts localmente en chats de IA (ChatGPT, Claude, Gemini) y mostrar estimaciones de impacto (tokens, agua y CO2) sin enviar datos a infraestructura externa.

## Principios

- Todo el procesamiento es local.
- Arquitectura por capas con degradacion elegante.
- Modo de mejora con fallback cuando no hay Ollama.

## Arquitectura actual

### Modo Comprimir

1. Capa 0: clasificacion de prompt en `content.js`.
2. Capa 1: limpieza lexico-determinista en `content.js`.
3. Capa 2: deduplicacion semantica (ONNX + MiniLM) en `background.js`.
4. Capa 3: reescritura generativa con Ollama en `background.js` (si disponible).

### Modo Mejorar

1. Capa 0-M: analisis de componentes presentes/faltantes en `background.js`.
2. Capa 1-M: mejora por plantillas si no hay Ollama.
3. Capa 2-M: mejora generativa con Ollama si hay modelo valido.
4. Reemplazo controlado desde `content.js` con revision previa (aceptar/descartar).

## Estructura principal

- `manifest.json`: configuracion MV3, permisos, content scripts y service worker.
- `content.js`: deteccion de proveedor, overlay de metricas, capas locales, UX de revision e inyeccion.
- `background.js`: pipeline pesado (ONNX, scoring de Ollama, mejora/compresion).
- `popup.html` + `popup.js`: estado del sistema, modo activo, banner de Ollama, resumen de sesion.
- `token_worker.js`: conteo de tokens en worker con fallback heuristico.

## Requisitos

### Obligatorio para Capa 2

El archivo `lib/ort.min.js` debe existir para habilitar ONNX Runtime Web.

Ejemplo rapido (PowerShell):

```powershell
New-Item -ItemType Directory -Force lib | Out-Null
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js" -OutFile "lib/ort.min.js"
```

### Opcional para Capa 3 / Capa 2-M

- Ollama instalado y corriendo en `http://localhost:11434`.
- Modelo recomendado: `qwen3.5:2b`.

```powershell
ollama pull qwen3.5:2b
```

## Uso

1. Cargar la extension en modo desarrollador (`chrome://extensions` -> Load unpacked).
2. Abrir ChatGPT, Claude o Gemini.
3. Escribir un prompt y dejar de tipear.
4. En modo mejorar, revisar cambios y elegir:
   - Aceptar y reemplazar
   - Descartar

## Estado de implementacion

- Sin servidor local Python.
- Metricas ambientales por estimacion local.
- Resumen de sesion en popup conectado a estadisticas persistidas.
- Brechas y roadmap en `BRECHAS_ARQUITECTURA.md`.
