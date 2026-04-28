# IAndes v4.0 — Instalación

## Requisitos Previos

- Google Chrome (u otro navegador Chromium: Edge, Brave)
- Extensión cargada en `chrome://extensions` en modo desarrollador

## Instalación Rápida (Solo Capa 1 + Jaccard)

1. **Clonar o descargar** el proyecto
2. **Abrir Chrome** → `chrome://extensions`
3. **Modo desarrollador** → "Cargar extensión sin empaquetar"
4. **Seleccionar carpeta** `IAndes`

La extensión funciona inmediatamente con:
- ✅ Capa 1 (regex): Siempre activa
- ✅ Capa 2 (Jaccard fallback): Siempre activa
- ⚠️ Capa 2 (Transformers.js): Requiere instalación adicional
- ⚠️ Capa 3 (Ollama): Requiere instalación adicional

---

## Instalación de Ollama (Capa 3)

Ollama permite la reescritura generativa de prompts (compresión avanzada).

### 1. Instalar Ollama

**macOS/Linux:**
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

**Windows:** Descargar desde https://ollama.com/download

### 2. Descargar modelo recomendado

```bash
ollama pull qwen3.5:2b
```

**Modelos alternativos compatibles:**
- `llama3.2:3b`
- `mistral:7b`
- `gemma2:2b`

### 3. Verificar instalación

```bash
ollama list
```

Deberías ver el modelo descargado en la lista.

### 4. Iniciar Ollama (si no está corriendo)

```bash
ollama serve
```

Ollama debe estar corriendo en `localhost:11434`.

---

## Instalación de Transformers.js (Capa 2 Avanzada)

Transformers.js permite deduplicación semántica usando embeddings de oraciones (más preciso que Jaccard).

### 1. Instalar Node.js

Descargar desde https://nodejs.org (versión 18+)

### 2. Instalar dependencias

```bash
cd IAndes
npm install
```

### 3. Generar bundle de Transformers.js

```bash
npm run build:transformers
```

O manualmente:
```bash
npx esbuild node_modules/@xenova/transformers/src/transformers.js \
  --bundle \
  --format=iife \
  --outfile=lib/transformers.min.js \
  --global-name=Transformers
```

### 4. Recargar la extensión

1. Abrir `chrome://extensions`
2. Hacer clic en el botón de recarga (♻️) en la tarjeta de IAndes

### 5. Verificar estado

1. Abrir el popup de IAndes
2. El indicador "ONNX" debería mostrar:
   - `"Capa 2: Transformers.js ✓"` si todo está listo
   - `"Descargando modelo (~22MB)"` si está descargando por primera vez

---

## Verificación de Instalación

### Test básico (Capa 1 + Jaccard)

1. Abrir https://chatgpt.com
2. Escribir: `"hola, por favor explícame cómo funciona la fotosíntesis de forma muy detallada"`
3. Esperar 1.5 segundos
4. Deberías ver el overlay con:
   - Conteo de tokens
   - Impacto ambiental (agua, CO₂)
5. Hacer clic en "Sí" cuando aparezca el hint
6. Verificar que el panel muestra ANTES/DESPUÉS

### Test de Ollama (Capa 3)

1. Asegurarse que Ollama está corriendo (`ollama serve`)
2. Escribir un prompt de 15+ palabras con cortesía
3. Verificar que el panel muestra "Capa 3" o "Capa 2m"

### Test de Transformers.js (Capa 2 Avanzada)

1. Escribir: `"explícame la fotosíntesis. describe el proceso fotosintético."`
2. Si Transformers.js está activo, debería quedar una sola oración
3. Si solo Jaccard está activo, puede que queden ambas (Jaccard es menos preciso)

---

## Solución de Problemas

### "Ollama no detectado"

1. Verificar que Ollama está corriendo:
   ```bash
   curl http://localhost:11434/api/tags
   ```
2. Si falla, iniciar Ollama:
   ```bash
   ollama serve
   ```

### "Capa 2 no disponible"

1. Verificar que `lib/transformers.min.js` existe
2. Si no existe, ejecutar:
   ```bash
   npm run build:transformers
   ```

### "Token worker error" en consola

Este error es esperado y no afecta la funcionalidad. El fallback a `estimateTokens()` local se activa automáticamente.

### La extensión no carga

1. Verificar que todos los archivos .js están presentes
2. Verificar que `manifest.json` tiene `"manifest_version": 3`
3. Recargar la extensión en `chrome://extensions`

---

## Scripts Disponibles

```bash
# Instalar todas las dependencias
npm install

# Generar bundle de Transformers.js
npm run build:transformers

# Ejecutar tests
npm test

# Tests individuales
node test_layer1.js
node test_classify.js
node test_dedup.js
```

---

## Arquitectura de Capas

```
┌─────────────────────────────────────────────────────────────┐
│                      USUARIO INPUT                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Capa 0: Clasificación (classifyPrompt)                     │
│  - Detecta perfil: short_direct, long_padded, etc.          │
│  - Determina qué capas activar                              │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Capa 1: Filtro Léxico (applyLayer1Detailed)                │
│  - Regex: saludos, cortesía, muletillas                     │
│  - SIEMPRE se aplica (baseline)                             │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Capa 2: Deduplicación Semántica                            │
│  - Transformers.js (preciso, ~22MB)                         │
│  - Jaccard fallback (heurística, siempre disponible)        │
│  - Elimina frases redundantes                               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Capa 3: Reescritura Generativa (Ollama)                    │
│  - Requiere Ollama instalado                                │
│  - Modelo: qwen3.5:2b recomendado                           │
│  - Comprime sin perder significado                          │
└─────────────────────────────────────────────────────────────┘
```

---

*Documentación generada para IAndes v4.0*
*Fecha: 26 de Abril 2026*
