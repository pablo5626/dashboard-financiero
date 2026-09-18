# Guía: cómo cambiar el proveedor de IA (voz y recibo)

Esta guía es para el día que quieras reemplazar Gemini por otro proveedor
(Anthropic/Claude, OpenAI, etc.) en las dos funciones que hoy llaman a un
modelo de lenguaje: captura por voz y escaneo de recibo. Estas dos son las
**únicas** dos llamadas a un LLM en todo el proyecto — no hay ninguna capa
de abstracción multi-proveedor a propósito (ver `CLAUDE.md`, sección
"Quick capture (FAB) + voice input"), así que cambiar de proveedor siempre
es editar directamente estos 2 archivos, nunca una configuración central.

## 1. Dónde vive esto hoy

| Qué | Dónde |
|---|---|
| Interpreta la frase hablada → JSON del formulario | `supabase/functions/voice-parse/index.ts` |
| Interpreta la foto del recibo → JSON del formulario | `supabase/functions/receipt-parse/index.ts` |
| API key del proveedor actual (secret de Supabase, **no** está en el repo) | `GEMINI_API_KEY` |
| Referencia del proyecto Supabase (para los comandos de deploy/secrets) | `qxiqqozogggfynkanevt` (ver `supabase/config.toml` y `CLAUDE.md`) |

Ninguna otra parte del código (`QuickCaptureFAB.jsx`, `Diario.jsx`, etc.)
sabe qué proveedor hay detrás — solo hacen `fetch` a estas dos Edge
Functions de Supabase y reciben `{ ok, result: {...} }` o
`{ ok: false, error }`. **Mientras esa forma de respuesta no cambie, el
front-end no necesita ningún cambio.**

> Nota: `exchangeRatesApi.fetchLiveRate` (tasa de cambio en vivo) llama a
> `open-er-api.com`, no es un modelo de IA — no forma parte de esta guía.

## 2. Qué cambia en cada archivo al cambiar de proveedor

Ambos archivos siguen el mismo patrón: una constante con la API key leída
de `Deno.env`, una constante con el nombre del modelo, y un único
`fetch()` directo a la REST API del proveedor dentro del `Deno.serve`. Al
cambiar de proveedor hay que tocar, en **cada uno de los 2 archivos**:

1. **La constante de la API key** (línea ~10-14): el nombre de la variable
   y el `Deno.env.get(...)`.
2. **El nombre/id del modelo** (constante `GEMINI_MODEL` o como se llame).
3. **La URL del `fetch`** (línea ~81).
4. **Los headers** — cada proveedor autentica distinto (ver tabla abajo).
5. **El `body` del `fetch`** — cada proveedor tiene su propio formato de
   "system prompt + mensaje de usuario (+ imagen)".
6. **Cómo se extrae el texto de la respuesta** (línea ~100/106,
   `data?.candidates?.[0]?.content?.parts?.[0]?.text` en Gemini).
7. **El mensaje de error "no configurada"** (línea ~65/61) — menciona el
   nombre de la env var por su nombre literal, hay que actualizarlo.

El resto de cada archivo (CORS, validación del body de entrada, parseo del
JSON de salida a `{ok, result}`, límites como `MAX_BASE64_LENGTH`, las
listas `CATEGORIES`/`ACCOUNTS`) es genérico y **no depende del proveedor**
— no tocar.

## 3. Ejemplo concreto: pasar de Gemini a Anthropic (Claude)

Este proyecto ya usó Anthropic antes de migrar a Gemini (ver el comentario
al principio de `voice-parse/index.ts`), así que volver es el ejemplo más
directo. Los cambios de la tabla del punto 2, aplicados a Anthropic:

| Punto | Gemini (actual) | Anthropic |
|---|---|---|
| Env var | `GEMINI_API_KEY` | `ANTHROPIC_API_KEY` |
| Modelo | `gemini-2.5-flash` | `claude-sonnet-5` (o `claude-haiku-4-5-20251001` para algo más barato/rápido, ver la skill `claude-api` para ids vigentes) |
| URL | `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent` | `https://api.anthropic.com/v1/messages` |
| Headers | `x-goog-api-key: <key>` | `x-api-key: <key>` + `anthropic-version: 2023-06-01` |
| Body (system) | `systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }` | `system: SYSTEM_PROMPT` (campo aparte, no dentro de `messages`) |
| Body (mensaje texto) | `contents: [{ role: 'user', parts: [{ text }] }]` | `messages: [{ role: 'user', content: text }]` |
| Body (mensaje con imagen) | `parts: [{ inline_data: { mime_type, data } }, { text }]` | `messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } }, { type: 'text', text: '...' }] }]` |
| Forzar salida JSON | `generationConfig: { responseMimeType: 'application/json' }` | Anthropic no tiene un flag equivalente — el `SYSTEM_PROMPT` ya pide "SOLO un JSON estricto, sin texto extra, sin markdown", lo cual alcanza en la práctica; si hiciera falta más garantía, se puede agregar un mensaje `{ role: 'assistant', content: '{' }` al final de `messages` para forzar que la respuesta empiece con `{` |
| `max_tokens` | `generationConfig.maxOutputTokens` | `max_tokens` (campo raíz obligatorio en Anthropic, no opcional) |
| Extraer el texto de la respuesta | `data?.candidates?.[0]?.content?.parts?.[0]?.text` | `data?.content?.[0]?.text` |
| Error de key faltante | `'GEMINI_API_KEY no configurada...'` | `'ANTHROPIC_API_KEY no configurada...'` |

El resto del archivo (parseo del texto limpio a JSON, validación de
`amount`, armado de `{ ok: true, result: {...} }`) queda idéntico.

### Ejemplo de `fetch` resultante para `voice-parse/index.ts`

```ts
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const ANTHROPIC_MODEL = 'claude-sonnet-5'

// ...

const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: ANTHROPIC_MODEL,
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: text }],
  }),
})

// ...

const data = await response.json()
const rawText = data?.content?.[0]?.text ?? ''
```

Para `receipt-parse/index.ts` el `messages` con imagen queda:

```ts
messages: [{
  role: 'user',
  content: [
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
    { type: 'text', text: 'Leé este recibo y devolvé el JSON pedido.' },
  ],
}],
```

## 4. Pasos para aplicar el cambio (en cualquier proveedor nuevo)

1. Conseguir la API key del proveedor nuevo (en el caso de Anthropic,
   desde console.anthropic.com — es una key distinta a cualquier
   suscripción de Claude Code, igual que `GEMINI_API_KEY` es distinta de
   cualquier cuenta de Google).
2. Registrar el secret en Supabase (reemplaza, no acumula, el nombre de
   variable de abajo):
   ```
   npx supabase secrets set ANTHROPIC_API_KEY=xxxxx --project-ref qxiqqozogggfynkanevt
   ```
3. Editar `voice-parse/index.ts` y `receipt-parse/index.ts` con los 7
   puntos de la tabla de la sección 2.
4. Redesplegar **ambas** funciones (un cambio de secret solo no requiere
   redeploy, pero un cambio de código sí):
   ```
   npx supabase functions deploy voice-parse --project-ref qxiqqozogggfynkanevt
   npx supabase functions deploy receipt-parse --project-ref qxiqqozogggfynkanevt
   ```
5. Probar de punta a punta en `npm run dev` (`localhost`, no
   `http://<ip-lan>`, porque `SpeechRecognition` necesita contexto
   seguro): un movimiento por voz y un recibo escaneado, confirmando que
   el formulario se precarga igual que antes.
6. Si el cambio queda permanente (no es solo una prueba), actualizar los
   comentarios en ambos `index.ts` que mencionan "Gemini"/`GEMINI_API_KEY`
   explícitamente, y la sección de `CLAUDE.md` que documenta el proveedor
   actual ("Known deferred scope" y "Quick capture (FAB) + voice input"),
   para que la próxima sesión no vea una referencia a Gemini desactualizada.

## 5. Qué NO hace falta tocar

- `QuickCaptureFAB.jsx`, `Diario.jsx`, ni ningún componente de React — solo
  consumen `{ ok, result }` vía `fetch` a la Edge Function, sin saber nada
  del proveedor.
- `supabase/config.toml` — ninguna de las dos funciones aparece ahí (se
  despliegan con `verify_jwt = true` por default, ver el comentario al
  principio de cada `index.ts`).
- La key vieja del proveedor anterior no hace falta borrarla del secret
  store de Supabase (no rompe nada tenerla sin uso), pero sí conviene
  borrar del código cualquier referencia a su nombre de variable para no
  confundir a futuro.
