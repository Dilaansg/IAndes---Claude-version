# Reglas Capa 1 (Filtro léxico)

Este documento resume los patrones que elimina IAndes en Capa 1.

## Objetivo

Eliminar ruido conversacional sin tocar la intención principal del prompt, minimizando los falsos positivos (como eliminar saludos dentro de comillas o partes esenciales del texto).

## Mecanismo de Seguridad

Antes de aplicar cualquier filtro, la Capa 1 extrae y protege todo el texto que se encuentre entre comillas dobles (`"`), comillas simples (`'`) y acentos graves (``` ` ```). Una vez finalizada la limpieza, el texto protegido se restaura. Esto garantiza que comandos como:
`Traduce la frase "Hola, espero que estés bien"` no se vean afectados.

## Catálogo de reglas

1. `start_greeting` - Saludo inicial
- Ejemplos: `hola`, `hey`, `saludos cordiales`, `buenos días`, `estimados`
- Alcance: solo al inicio del texto

2. `start_wellbeing` - Cortesía inicial
- Ejemplos: `espero que estés muy bien`, `cómo estás`
- Alcance: solo al inicio del texto

3. `end_thanks` - Agradecimiento final
- Ejemplos: `muchas gracias de antemano`, `te lo agradezco`, `quedo atento a tus comentarios`, `saludos cordiales`
- Alcance: solo al final del texto

4. `ask_permission` - Fórmula de ruego
- Ejemplos: `quisiera`, `me gustaría`, `te quería pedir`, `si no es molestia`, `te agradecería muchísimo si`, `serías tan amable de`
- Alcance: global (ignorado si parece código)

5. `please` - Cortesía explícita
- Ejemplos: `por favor`, `porfa`, `si puedes`, `si es posible`
- Alcance: global (ignorado si parece código)

6. `assist_request` - Solicitud indirecta
- Ejemplos: `podrías ayudarme`, `puedes explicarme`, `hacerme el favor de`
- Alcance: global (ignorado si parece código)

7. `need_help` - Petición redundante de ayuda
- Ejemplos: `necesito que me ayudes`, `quiero que me expliques`
- Alcance: global (ignorado si parece código)

8. `verbosity_request` - Pedida de verbosidad (solo relleno)
- Ejemplos: `de forma muy detallada`, `paso a paso y clara y sencilla`, `con ejemplos`
- Alcance: global (ignorado si parece código)

9. `transition_filler` - Muletilla de transición
- Ejemplos: `a continuación`, `antes que nada`, `primero que todo`, `sin más preámbulos`, `yendo al grano`, `el contexto es el siguiente`, `me explico`
- Alcance: global (ignorado si parece código)

## Transparencia en runtime

- Catálogo cargado en: `window.__iandes_rulebook`
- Diagnóstico del último análisis: `window.__iandes.layer1_debug`
  - `saved_tokens`
  - `matched_rules`
  - `matched_fragments`

## Nota de seguridad

Cuando hay duda, Capa 1 prioriza no borrar contenido útil. Un falso negativo (dejar basura) es tolerable, un falso positivo (borrar tu intención) es el error que importa.
