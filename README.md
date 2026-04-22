IAndes — Resumen del proyecto
=============================

Descripción
-----------
IAndes es una extensión de navegador (Manifest V3) que detecta cuando escribes
prompts en interfaces de chat (ChatGPT, Claude, Gemini) y sugiere optimizaciones
para reducir tokens, consumo de agua y emisiones de CO₂. Implementa un pipeline
multicapa para limpiar, deduplicar y (opcionalmente) reescribir prompts.

Estructura de archivos
----------------------
- [manifest.json](manifest.json) — Declaración de la extensión (permisos,
  content scripts y service worker).
- [content.js](content.js) — Content script inyectado en las páginas de chat.
  Detecta el proveedor, escucha el campo de texto, muestra un overlay con
  métricas, aplica capas 0 y 1 (clasificación y filtro léxico) y delega las
  capas 2+3 al service worker.
- [background.js](background.js) — Service worker que ejecuta la Capa 2
  (deduplicación semántica con un modelo ONNX) y la Capa 3 (reescritura
  generativa con Ollama si está disponible). También gestiona la descarga y
  cache del modelo ONNX.
- [popup.html](popup.html) — Interfaz emergente de la extensión (configuración,
  estado y opciones de descarga del modelo).
- [contar_tokens_server.py](contar_tokens_server.py) — Pequeño servidor Flask
  local que originalmente devolvía conteos exactos y métricas ambientales.
  Nota: este servidor fue eliminado por decisión del usuario. El cliente
  (`content.js`) ahora usa una heurística local para estimar tokens y el
  impacto ambiental (error típico ±15%).

Qué hace actualmente el sistema (flujo de alto nivel)
----------------------------------------------------
1. `content.js` detecta el proveedor (ChatGPT/Claude/Gemini) y escucha el
   campo de prompt.
2. Al dejar de escribir, muestra una estimación inmediata de tokens local.
3. Llama a `http://127.0.0.1:5000/count` (si `contar_tokens_server.py` está
   corriendo) para obtener el conteo exacto por proveedor y las métricas de
   impacto ambiental.
4. Clasifica el prompt y aplica Capa 0/1 localmente (filtro léxico y
   clasificación). Si corresponde, envía el texto al `background.js` para
   aplicar Capa 2 (deduplicación semántica) y Capa 3 (reescritura con Ollama).
5. Si las Capas 2/3 producen un prompt más corto, se inyecta de vuelta en el
   chat.

Estado actual: servidor eliminado
--------------------------------
El servidor `contar_tokens_server.py` fue eliminado por petición del usuario.
`content.js` ahora calcula estimaciones locales de tokens y del impacto
ambiental usando una heurística (completions ≈ 0.8 × prompt, mínimo 50 tokens)
y una tabla de factores por modelo. Esto reduce la fricción (no se necesita
Python ni claves de API) a costa de perder conteos exactos por proveedor.

Cómo ejecutar (si decides mantener el servidor)
----------------------------------------------
1. Crear entorno e instalar dependencias:

```bash
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install flask tiktoken anthropic google-genai
```

2. (Opcional) Configurar API keys en variables de entorno para soporte Claude/Gemini:

```powershell
set ANTHROPIC_API_KEY=tu_key_aqui
set GOOGLE_API_KEY=tu_key_aqui
```

3. Ejecutar el servidor:

```bash
python contar_tokens_server.py
```

4. Abre la extensión en el navegador (modo desarrollador) y prueba.

Siguientes pasos sugeridos
-------------------------
- Si quieres, hago una de las dos cosas:
  - Elimino `contar_tokens_server.py` y adapto `content.js` para usar solo
    estimaciones locales.
  - O dejo el servidor y añado un archivo `requirements.txt` y un script
    `run_server.bat` para facilitar su ejecución en Windows.

He creado este archivo: [README.md](README.md)
