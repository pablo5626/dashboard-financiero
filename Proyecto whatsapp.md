# Proyecto WhatsApp: bot para registrar gastos («28000 en salida a comer»)

Estado: **investigación terminada (21-sep-2026), sin implementar.** Este documento reúne el
análisis de viabilidad, costos y la ruta propuesta. Antes de empezar hay una modificación
pendiente que el dueño quiere definir.

## Veredicto

**Es totalmente viable y costaría prácticamente $0 al mes** para el dueño y un equipo pequeño.
La vía recomendada es la **API oficial de WhatsApp (Cloud API) hablando directo con una
Edge Function de Supabase**, sin n8n. Casi todo lo difícil ya existe en la app: el
parser de frases (`voice-parse`), la IA (`_shared/gemini.ts`), la tabla `transactions` y
el modelo multiusuario. Lo nuevo es un webhook, una identificación de usuario distinta y
el trámite con Meta.

Decisiones tomadas: **primero solo el dueño, luego su equipo pequeño**; el bot
**guarda al instante y permite «deshacer»**.

## Opciones comparadas (uso estimado: 10 mensajes/día = 300 al mes)

| Opción | Costo mensual | Riesgo / esfuerzo | Veredicto |
|---|---|---|---|
| **Cloud API oficial de Meta + Edge Function** | **~$0** (ver detalle abajo) | Trámite en Meta (cuenta, app, token). Sin riesgo de baneo | **Recomendada** |
| Cloud API vía Twilio | ~$3 (Twilio cobra US$0,005 por mensaje enviado *y* recibido, más lo de Meta) | Más fácil de configurar, unas 10 veces más caro | Innecesario |
| n8n (cloud o propio) delante de la Cloud API | Cloud desde €20–24/mes (2.500 ejecuciones); autoalojado ~US$4–7/mes de servidor | Una pieza más que mantener; igual necesitaría credenciales para escribir en Supabase | No aporta aquí |
| Librerías no oficiales (Baileys, Evolution API, WAHA, whatsapp-web.js) | $0 | **Violan los términos de WhatsApp: riesgo real de perder el número**; se rompen con cada cambio del protocolo | Descartada |
| Telegram (bot) | $0, sin trámites (BotFather, 5 minutos) | Mismo diseño, otro canal; no es WhatsApp | Buen plan B o prototipo |

### Desglose del costo de la opción recomendada
- **Meta:** los mensajes que el usuario envía al bot son gratis. Las respuestas del bot dentro de
  las 24 h del último mensaje del usuario son gratis **hasta el 30-sep-2026**. Desde el
  **1-oct-2026** se cobran por mensaje al precio de la categoría «utility» de cada país, pero
  **los primeros 1.000 al mes por número de empresa son gratis** (cifra coincidente en tres
  fuentes; la página oficial que se abrió no la menciona, así que hay que reconfirmarla al
  montarlo). Con 300 respuestas al mes se está muy por debajo; un equipo de 5 (1.500 respuestas)
  pagaría centavos de dólar. La tarifa exacta de Colombia no se pudo confirmar; solo se sabe que
  es una fracción de centavo por mensaje.
- **IA (Gemini 3.6 Flash):** US$0,75 por millón de tokens de entrada y US$3,75 de salida hasta
  el 31-dic-2026 (el doble desde enero de 2027). Un mensaje son ~700 tokens de entrada y ~60 de
  salida: **~US$0,00075 por mensaje, unos US$0,23 al mes** con 300 mensajes (~US$0,45 desde 2027).
  Una nota de voz de 10 s añade una cantidad despreciable.
- **Supabase:** el plan gratuito actual sobra; el webhook son unas pocas invocaciones al día.
- **Número de teléfono:** para probar, Meta da un **número de prueba gratis** (hasta 5
  destinatarios verificados por código). Para producción hace falta un número que no esté activo
  en el WhatsApp normal (una SIM prepago, o «coexistencia» con la app WhatsApp Business, que exige
  abrirla al menos cada 13 días). Costo de una SIM: estimado, no investigado.

## Riesgos y hechos que condicionan el diseño

1. **Identidad (el punto de diseño principal).** Hoy todas las funciones actúan «como el usuario»
   con su JWT y RLS, y evitan la service role key. Meta no envía ningún JWT: solo un número de
   teléfono y una firma. El webhook tendrá que usar la service role key, como ya hace
   `rates-auto-update`, con estas barreras: verificar la firma `X-Hub-Signature-256` con el app
   secret (obligatorio), ignorar cualquier número no vinculado y filtrar **toda** consulta por el
   `user_id` resuelto.
2. **Idempotencia gratis.** Meta reintenta los webhooks. Usar el id del mensaje de WhatsApp como
   `monia_id` (`whatsapp-<wamid>`) aprovecha el `unique(user_id, monia_id)` que ya existe: un
   reintento no duplica el gasto.
3. **Política de IA de Meta (15-ene-2026):** prohíbe los chatbots de IA «de propósito general», no
   los bots de tarea concreta. Un bot que solo registra gastos encaja en lo permitido, pero es una
   lectura de fuentes de terceros, no un dictamen de Meta.
4. **Cuota de IA por usuario.** `consume_ai_quota` depende de `auth.uid()`, que no existe con service
   role. Para uso personal se puede omitir; para el equipo hace falta una variante que reciba el
   `user_id` (cambio de esquema + SQL a correr una vez, según la regla del repo).
5. **Privacidad.** Los mensajes pasan por Meta y por Google (Gemini). La capa gratuita de Gemini usa
   los datos para mejorar el producto: conviene confirmar que la key está en la capa de pago.
6. **Audio.** Las notas de voz de WhatsApp son OGG/Opus; Gemini acepta audio, pero hay que probar
   ese formato concreto antes de prometerlo.
7. **Token de Meta.** El temporal dura 24 h; en producción se usa el de «usuario del sistema»,
   permanente. Sin verificación de negocio hay un tope de 250 conversaciones/24 h iniciadas por la
   empresa (no afecta: aquí inicia el usuario); a esta escala puede no hacer falta verificar, pero
   hay que confirmarlo al crear la cuenta (la verificación tarda 2–10 días hábiles).

## Diseño propuesto

```
WhatsApp del usuario → Meta Cloud API → POST /functions/v1/whatsapp-webhook (verify_jwt = false)
  → verifica firma → resuelve teléfono → usuario
  → Gemini (mismo prompt de voice-parse; texto o nota de voz)
  → INSERT en transactions (monia_id = whatsapp-<wamid>, origin 'manual')
  → responde: «✅ −$28.000 · Salida a comer · sin cuenta. Escribe "deshacer" para borrarlo»
```

- **Reutilizar:** el prompt y el esquema de `voice-parse/index.ts` (moverlo a `_shared/` para
  compartirlo), `sanitizeNameList` (`_shared/input.ts`), `_shared/gemini.ts` (modelo, thinking,
  errores) y el patrón de `rates-auto-update` para service role y `verify_jwt = false` en
  `supabase/config.toml`.
- **Sin cuenta o sin categoría:** se guarda igual (la fila queda en «Pendientes de banco» o sin
  categoría, editable tocándola en la app) y la respuesta lo dice. Sin monto: el bot pregunta.
- **«deshacer»:** borra el último gasto creado por WhatsApp desde ese chat. Cumple la regla del
  proyecto de que todo lo que se crea se puede borrar.
- **Canal desacoplado:** parseo y guardado en una función aparte y un adaptador delgado por canal,
  para poder sumar Telegram con poco código si WhatsApp da problemas.

## Ruta por fases

**Fase 1 — solo el dueño (~1 día de código + el trámite con Meta)**
1. En Meta for Developers: crear la app (tipo Business) con el producto WhatsApp, usar el
   número de prueba, añadir el celular del dueño como destinatario y crear el token permanente.
2. Secrets en Supabase: `WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`,
   `WHATSAPP_OWNER_PHONE`, `WHATSAPP_OWNER_USER_ID`.
3. Función `whatsapp-webhook`: handshake de verificación (GET), firma, texto y nota de voz,
   guardado, respuesta y «deshacer». Desplegar y apuntar el webhook de Meta a ella.

**Fase 2 — equipo pequeño (se decide tras usar la Fase 1)**
1. Tabla `whatsapp_links` (usuario ↔ teléfono, con RLS) y códigos de un solo uso; sección
   «WhatsApp» en Ajustes que genera el código; el usuario escribe «vincular CÓDIGO» al bot.
2. Variante de la cuota de IA por `user_id`; añadir las tablas nuevas al script de limpieza de
   `.claude/rules/multiusuario-despliegue.md`.
3. Número de producción y, si Meta lo pide, verificación del negocio; aviso de privacidad.

## Verificación (al implementar)
- `GET` del handshake con `curl` devuelve el `hub.challenge`; una firma inválida responde 401.
- Desde el celular: «28000 en salida a comer» crea la fila y aparece en Diario con la categoría
  correcta; «deshacer» la borra.
- Reenviar el mismo webhook (mismo `wamid`) no crea una segunda fila.
- Un número no vinculado no obtiene respuesta ni escribe nada.
- Probar una nota de voz real; si el audio OGG falla, documentar la limitación.
- Tras cualquier cambio en `_shared/`, redesplegar las cuatro funciones que lo importan.

## Fuentes
- [Precios de la plataforma (Meta)](https://developers.facebook.com/docs/whatsapp/pricing) ·
  [cambio del 1-oct-2026 (Courier)](https://www.courier.com/blog/whatsapp-pricing-changes-october-2026) ·
  [franquicia de 1.000 mensajes (respond.io)](https://respond.io/blog/whatsapp-pricing-change-2026) ·
  [YCloud](https://www.ycloud.com/blog/whatsapp-api-message-pricing-update-effective-october-1-2026)
- [Precios de Gemini](https://ai.google.dev/gemini-api/docs/pricing)
- [Precios de n8n en 2026](https://coworker.ai/blog/n8n-pricing) · [Twilio WhatsApp](https://www.twilio.com/en-us/whatsapp/pricing)
- [Riesgo de baneo con librerías no oficiales](https://sporesec.com/en/blog/whatsapp-unofficial-api-ban-risk) ·
  [política de IA de WhatsApp 2026](https://learn.turn.io/l/en/article/khmn56xu3a-whats-app-s-2026-ai-policy-explained)
- [Requisitos de la Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started/) ·
  [coexistencia con la app Business](https://www.ycloud.com/blog/whatsapp-business-app-coexistence-meta-update)
