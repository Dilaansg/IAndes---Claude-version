# Reglas Capa 1 (Filtro lexico)

Este documento resume que patrones elimina IAndes en Capa 1.

## Objetivo

Eliminar ruido conversacional sin tocar la intencion principal del prompt.

## Catalogo de reglas

1. `start_greeting` - Saludo inicial
- Ejemplos: `hola`, `buenos dias`, `saludos`, `estimado`
- Alcance: solo al inicio del texto

2. `start_wellbeing` - Cortesia inicial
- Ejemplos: `como estas`, `espero que estes bien`
- Alcance: solo al inicio del texto

3. `end_thanks` - Agradecimiento final
- Ejemplos: `gracias`, `muchas gracias`, `gracias de antemano`, `te lo agradezco`
- Alcance: solo al final del texto

4. `ask_permission` - Formula de ruego
- Ejemplos: `quisiera`, `te pido que`, `si no es molestia`, `te agradeceria si`
- Alcance: global

5. `please` - Cortesia explicita
- Ejemplos: `por favor`, `porfa`, `si puedes`, `si es posible`
- Alcance: global

6. `assist_request` - Solicitud indirecta
- Ejemplos: `podrias ayudarme`, `puedes explicarme`, `podrias resumirme`
- Alcance: global

7. `need_help` - Peticion redundante de ayuda
- Ejemplos: `necesito que me ayudes`, `quiero que me expliques`
- Alcance: global

8. `verbosity_request` - Petida de verbosidad
- Ejemplos: `de forma detallada`, `de forma exhaustiva`, `clara y sencilla`
- Alcance: global

9. `transition_filler` - Muletilla de transicion
- Ejemplos: `a continuacion`, `antes que nada`, `primero que todo`
- Alcance: global

## Transparencia en runtime

- Catalogo cargado en: `window.__iandes_rulebook`
- Diagnostico del ultimo analisis: `window.__iandes.layer1_debug`
  - `saved_tokens`
  - `matched_rules`
  - `matched_fragments`

## Nota de seguridad

Cuando hay duda, Capa 1 prioriza no borrar contenido util.
