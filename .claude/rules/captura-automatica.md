# Captura automática de pagos (Apple Pay / notificaciones del banco)

Nació de la investigación `captura-automatica-pagos-mon-ai.md` (raíz del repo).
El teléfono manda cada compra, sin que el usuario haga nada, a la Edge Function
`auto-capture`. **Si se pudo leer el monto, la compra se guarda sola como
gasto**, con la categoría aprendida del historial, y queda un recordatorio para
rectificarla en Gastos → "Capturas automáticas por revisar". El badge de Gastos
y la alerta del Panel cuentan esas capturas pendientes.

**Esta es una decisión explícita del usuario** y una excepción deliberada a la
regla de "nunca adivinar y guardar" del resto de la app (el "+", la voz y los
recibos solo precargan). Primero se diseñó como una bandeja que no contaba nada
hasta confirmar; el usuario pidió "que se guarde automáticamente, pero que le
recuerde rectificarlo".

**Cómo se elige la categoría**: sin IA. El comercio se compara con texto exacto
normalizado (`lower(trim(...))`) contra las descripciones de sus movimientos
anteriores, y gana la categoría + tag más frecuente, o la más reciente si hay
empate (misma regla que `suggestCategoryForPurpose`, repetida en SQL dentro de
`ingest_auto_capture`). La primera compra en un comercio se guarda **sin
categoría**, y la tarjeta de revisión lo avisa. Corregirla en la revisión
actualiza la transacción, y con eso la próxima compra en ese comercio ya sale
con esa categoría, sin ningún paso de "aprender".

**No se guarda sola, y queda "Sin guardar" en la bandeja, cuando**: no se leyó
el monto (texto irreconocible, o el bug de Wallet sin datos), o la cuenta
resuelta tiene otra moneda que la captura. En ese segundo caso el gasto quedaría
fuera del saldo en silencio (ver "Compras en divisa" en `motor-asignacion.md`).

## Piezas

- **`capture_tokens`** + RPC `create_capture_token(label)`: token personal
  (`cap_` + 64 hex) creado en Ajustes → Captura automática. Se muestra una sola
  vez y la base solo guarda su sha256. Borrar la fila lo revoca. Reemplaza al
  login con contraseña que usan los Shortcuts de `shortcuts-ios.md`.
- **`auto-capture`** (`verify_jwt = false` en `supabase/config.toml`): lee
  `Authorization: Bearer <token>`, parsea el texto de la notificación con
  `_shared/notificationParsers.ts` y llama a la RPC `ingest_auto_capture` con
  la anon key. Esa RPC, `security definer` y ejecutable solo por `anon`, valida
  el hash, resuelve la cuenta por nombre (con `_` como espacio), aplica un tope
  de 200 capturas por usuario y día y hace el insert idempotente por
  `dedup_key`. No se usa la service role.
- **`auto_captures`**: el registro de cada captura y el recordatorio.
  - `pending` con `transaction_id`: guardada, falta revisarla.
  - `pending` sin `transaction_id`: sin guardar, hay que completarla.
  - `confirmed`: revisada o completada.
  - `discarded`: descartada, o su gasto se eliminó.
  - `merged`: la absorbió la conciliación con el CSV.

  La transacción creada lleva `origin = 'auto_capture'` y
  `monia_id = 'auto-<id de la captura>'`.
- **Frontend**: `autoCaptureApi.js`, `AutoCaptureQueue.jsx` (cola en Gastos,
  categoría precargada con `suggestCategoryForPurpose`, nunca guardada sola),
  `AutoCaptureSettings.jsx` (tokens), el badge de Gastos en `AppShell` y la
  alerta `capturas_pendientes` en `fetchAlerts`. Todo tolera que las tablas
  todavía no existan en la base viva (cuentan 0 o la cola no aparece).

## Parsers

El parseo vive en el servidor para que corregir un formato sea un deploy, sin
tocar las macros de cada teléfono. `PATTERNS` en `notificationParsers.ts`
recibe una regex por formato, con los grupos `merchant` y `amount`.
`parseCopAmount` entiende `$50.000`, `50.000,00` y `$50,000.00`. Una compra
rechazada se ignora. Un texto que ningún patrón reconoce se guarda con
`amount = null` y el `raw_text`, para completarlo a mano en la bandeja.
**Pendiente**: afinar los patrones con textos reales de las notificaciones de
Nu Colombia y de los demás bancos. Los patrones actuales siguen el ejemplo de la
investigación.

## Conciliación con el CSV de MonIA

Ocurre en `importTransactions` (`reconcileWithAutoCaptures`). Una fila de gasto
del CSV y una captura se emparejan solo si tienen el mismo monto absoluto y la
misma moneda, fechas a ±1 día, y la misma cuenta (o alguna de las dos sin
cuenta), **y el emparejamiento es 1 a 1**. Ante cualquier ambigüedad se importa
normal, sin especular.

- Si la captura ya estaba confirmada, la transacción adopta el `monia_id` del
  CSV y la fila del CSV no se inserta. Un reimport posterior la salta sola.
- Si la captura seguía pendiente, la fila del CSV entra normal y la captura
  pasa a `merged`.

El resultado de la importación informa `reconciled`. Límite conocido: una
compra en divisa (arq) no concilia, porque el CSV llega convertido a la moneda
de la cuenta y la captura queda en COP.

## Probar sin teléfono: simulador

`tools/simulador-captura.html` (herramienta de desarrollo, fuera de `public/` y
del build) dibuja un iPhone y un Android que mandan al endpoint real el mismo
JSON que el dispositivo, con presets (Nu aprobada, rechazada, irreconocible,
formato en-US, el bug de Wallet sin datos). Se abre con `npm run dev` en
`http://localhost:5173/dashboard-financiero/tools/simulador-captura.html`. Por
eso `auto-capture` usa `withCors`: permite `localhost` y el sitio, y al
teléfono real no le afecta porque no manda preflight.

## Configuración en el teléfono

**iPhone** (Atajos → Automatización → Nueva → **Transacción**/Wallet):
1. Elegir la tarjeta. Crear **una automatización por tarjeta**, porque cada una
   manda su propia `cuenta`. Activar "Ejecutar inmediatamente".
2. Dentro del atajo: `Obtener valor del diccionario` `Amount` y `Merchant` de la
   entrada del atajo. Seleccionarlos directo desde el selector falla desde un
   bug de iOS 17.
3. `Obtener contenido de URL`, POST a
   `https://<SUPABASE_URL>/functions/v1/auto-capture`, header
   `Authorization: Bearer <token>`, cuerpo JSON
   `{"source":"apple_pay","amount":<Amount>,"merchant":<Merchant>,"cuenta":"nubank"}`.
4. Si llegan vacíos (`Amount = 0`), activar los datos móviles de Wallet
   (Ajustes → Apps → Wallet).

**Android** (MacroDroid):
1. Disparador **Notificación recibida**, filtrado por la app del banco (hay que
   confirmar el paquete exacto de Nu Colombia).
2. Acción **Solicitud HTTP** POST a la misma URL, con el mismo header y el
   cuerpo `{"source":"android_notification","text":"[notification_title] [notification]","app":"[app_package]","cuenta":"nubank"}`.
   No hace falta regex en el teléfono.

Respuestas: `{ok:true,status:"saved"|"inserted"|"duplicate"|"ignored_rejected",notification}`,
401 (token inválido o revocado) y 429 (más de 200 capturas en el día).
`notification` (`{title, body}`, o null cuando no hay nada que avisar) es el
texto para mostrar la notificación en el celular desde el mismo automatismo:

- **Atajos**: después del POST, `Obtener valor del diccionario` `notification`,
  luego `title` y `body`, y la acción **Mostrar notificación**.
- **MacroDroid**: en la solicitud HTTP, guardar la respuesta en una variable
  (`respuesta`), extraer con **Analizar JSON** `notification.title` y
  `notification.body`, y la acción **Mostrar notificación**.

La notificación la muestra Atajos o MacroDroid, no la app: no hay Web Push.

## Fuera de alcance (anotado)

- Belvo / Open Finance: sería la fuente más robusta de datos reales, pero tiene
  costo y requiere integrar su API.
- Respaldo con Gemini para formatos desconocidos. Hoy quedan en la bandeja con
  el texto crudo.
