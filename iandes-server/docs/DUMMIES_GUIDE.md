# IAndes v5 — Resumen para Dummies

## Que es IAndes?

Imagina que escribes un mensaje largo a ChatGPT, Claude o Gemini. Algo como:

> "Hola, espero que estes bien. Necesito que me expliques como funciona la fotosintesis de forma muy detallada. No uses ejemplos de fibonacci."

IAndes toma ese mensaje y lo convierte en:

> "Necesito que me expliques como funciona la fotosintesis de forma muy detallada. No uses ejemplos de fibonacci."

**Que paso?** IAndes elimino "Hola, espero que estes bien" porque es **relleno** (filler) — no aporta nada a la pregunta. Y conservo intacta la pregunta (intent) y la restriccion (constraint).

**Resultado**: Mensaje mas corto, mas claro, y mas barato. Y el planeta agradece: menos tokens = menos CO2 y menos agua consumida.

---

## Como funciona? (Version simple)

Piensa en IAndes como un editor de texto inteligente con 6 pasos:

### Paso 1: Verificar la intencion (D1)
- Tu extension Chrome dice: "Esto es una pregunta (qa) con 80% de confianza"
- Si la confianza es alta (>= 60%), IAndes acepta esa clasificacion
- Si es baja, IAndes recalcula usando analisis del texto

### Paso 2: Dividir en partes (D2)
- IAndes divide tu mensaje en partes y las etiqueta:
  - "Hola, espero que estes bien" → **filler** (relleno)
  - "Necesito que me expliques..." → **intent** (intencion)
  - "No uses ejemplos de fibonacci" → **constraint** (restriccion)

### Paso 3: Asignar presupuesto (D3)
- Cada parte tiene un "presupuesto de compresion":
  - **intent**: 0% (NO se toca, es lo mas importante)
  - **constraint**: 0% (NO se toca, las restricciones son sagradas)
  - **context_high**: 20% (se puede comprimir un poco)
  - **context_low**: 60% (se puede comprimir bastante)
  - **filler**: 100% (se puede eliminar completamente)

### Paso 4: Podar palabras (D4)
- Para las partes que se pueden comprimir, IAndes elimina las palabras menos importantes
- Usa TF-IDF para saber que palabras pesan menos
- **Protege**: URLs, numeros, fechas, nombres propios, codigo, verbos principales
- **Nunca elimina**: la intencion ni las restricciones

### Paso 5: Verificar coherencia (D5)
- IAndes compara el mensaje original con el optimizado usando IA (MiniLM)
- Si el mensaje optimizado pierde demasiado significado (similitud < 85%):
  - Restaura la parte mas danada (rollback)
  - Intenta hasta 2 veces
  - Si no puede mejorar: marca `quality_warning = true`

### Paso 6: Reconstruir (D6)
- IAndes junta las partes que sobrevivieron
- Calcula cuantos tokens se ahorraron
- Calcula el impacto ambiental (CO2 y agua)
- Devuelve el resultado a la extension Chrome

---

## Que significa cada termino?

| Termino | Que significa | Ejemplo |
|---------|--------------|---------|
| **Token** | Una unidad de texto (aprox. 4 caracteres) | "Hola mundo" = ~2 tokens |
| **Intent** | Lo que el usuario quiere lograr | "Explica la fotosintesis" |
| **Constraint** | Lo que el usuario NO quiere | "No uses ejemplos" |
| **Filler** | Texto que no aporta nada | "Hola, espero que estes bien" |
| **Context** | Informacion de fondo | "Estoy en la universidad" |
| **TF-IDF** | Tecnica para saber que palabras son importantes | Palabras raras = mas importantes |
| **MiniLM** | Modelo de IA que entiende significado | Sabe que "explica" y "describe" son similares |
| **Cosine similarity** | Medida de que tan parecidos son dos textos | 1.0 = identicos, 0.0 = completamente diferentes |
| **Rollback** | Deshacer una compresion que fue demasiado agresiva | Restaurar un segmento que se comprimio demasiado |
| **Quality floor** | Umbral minimo de similitud aceptable | 0.85 = el optimizado debe ser 85% similar al original |

---

## Cuanto se ahorra?

| Tokens ahorrados | CO2 ahorrado | Agua ahorrada |
|-----------------|-------------|---------------|
| 10 | 0.023g | 5ml |
| 50 | 0.115g | 25ml |
| 100 | 0.23g | 50ml |
| 500 | 1.15g | 250ml |
| 1000 | 2.3g | 500ml |

**Referencias**:
- CO2: Patterson et al. (2021) — 0.0023g por token
- Agua: Li et al. (2023) — 0.50ml por token

---

## Que NO hace IAndes?

- **NO** reescribe tu prompt con IA generativa (no usa GPT, Claude, etc.)
- **NO** cambia el significado de lo que pediste
- **NO** elimina informacion importante (intent, constraint, entidades)
- **NO** requiere conexion a internet (todo es local)
- **NO** almacena tus prompts

---

## Estructura de archivos (version simple)

```
iandes-server/
├── main.py              # El servidor (FastAPI)
├── pipeline/
│   ├── verifier.py      # D1: Verifica la intencion
│   ├── segmenter.py     # D2: Divide en partes
│   ├── budget.py        # D3: Asigna presupuesto
│   ├── pruner.py        # D4: Elimina palabras innecesarias
│   ├── validator.py     # D5: Verifica que no se perdio significado
│   └── rebuilder.py     # D6: Reconstruye el resultado
├── models/
│   ├── loader.py        # Carga los modelos de IA
│   └── minilm/          # Modelo de IA para entender significado
├── tests/              # 118 pruebas automaticas
└── ui/                  # Panel de control web
```

---

## Preguntas frecuentes

**P: IAndes puede eliminar algo importante por error?**
R: Es muy poco probable. El sistema protege la intencion (intent) y las restricciones (constraint) con un presupuesto de compresion de 0%. Ademas, el validador (D5) verifica que el resultado mantenga al menos 85% de similitud con el original. Si baja de ese umbral, hace rollback automaticamente.

**P: Que pasa si los modelos de IA no estan disponibles?**
R: IAndes funciona igual. Usa heuristicas (regex) como fallback. Los resultados son menos precisos pero siempre funcionales.

**P: IAndes funciona en ingles?**
R: Si. Los patrones de deteccion cubren espanol e ingles. El modelo MiniLM es multilingual (50+ idiomas).

**P: Cuanto tarda en procesar un prompt?**
R: Tipicamente 100-300ms en el primer request (carga de modelos) y 20-50ms en requests subsiguientes.

**P: Puedo usar IAndes sin la extension Chrome?**
R: Si. El servidor tiene una API REST en `http://localhost:8000/optimize` que puedes usar directamente con curl o cualquier cliente HTTP.