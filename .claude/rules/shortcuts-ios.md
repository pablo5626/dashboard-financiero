# Shortcuts de iOS: registro rápido (gasto + transferencia)

Este archivo es la especificación de dos Shortcuts de iOS que el usuario
arma y mantiene él mismo en su teléfono — igual que el Shortcut existente de
distribución mensual madre→hijas (ver "Known deferred scope" en
`CLAUDE.md`). **No se versiona ningún `.shortcut` en este repo**; este
documento es el contrato de entrada (endpoints, headers, cuerpo JSON) contra
el que se arma cada Shortcut a mano en la app Atajos.

Ambos siguen el mismo patrón de 3 llamadas ya probado por el Shortcut
mensual: **login → insert**. El paso de login es idéntico en los dos.

## Paso 1 (común a ambos): login

```
POST https://<SUPABASE_URL>/auth/v1/token?grant_type=password
Headers:
  apikey: <ANON_KEY>
  Content-Type: application/json
Body:
  { "email": "<email del usuario>", "password": "<password>" }
```

Respuesta: JSON con `access_token`. Guardarlo en una variable del Shortcut
para usarlo en el paso 2 — **la anon key sola nunca puede escribir**, cada
insert necesita este `access_token` real porque RLS evalúa `auth.uid()`
contra el JWT, no contra la anon key (ver `.claude/rules/seguridad-entorno.md`).

## Shortcut "Gasto rápido"

**Prompts** (2, en este orden):
1. *Ask for Input* — "¿Cuánto?" (tipo número).
2. *Choose from Menu* — "¿Desde qué cuenta?", con una opción por cada cuenta
   hija activa (mismos nombres que en la app: Dale, Nequi, Rappi, Nubank,
   Efectivo, Pibank, arq, arq eur...). Cada opción del menú lleva
   *hardcodeado* el UUID de esa cuenta (columna `id` en `accounts` — se
   consulta una vez en Supabase y se pega en el Shortcut; si se renombra o
   agrega una cuenta hay que actualizar este menú a mano, mismo costo de
   mantenimiento que ya tiene el Shortcut mensual con `account_allocations`).

**Insert**:
```
POST https://<SUPABASE_URL>/rest/v1/transactions
Headers:
  apikey: <ANON_KEY>
  Authorization: Bearer <access_token>
  Content-Type: application/json
  Prefer: return=minimal
Body:
  {
    "monia_id": "shortcut-<epoch en segundos>-<4 dígitos random>",
    "occurred_at": "<fecha/hora actual en ISO 8601, ej. 2026-09-14T15:30:00Z>",
    "purpose": "Gasto rápido",
    "amount": <-1 * monto ingresado>,
    "currency": "COP",
    "account_id": "<uuid elegido en el menú>",
    "assignment_level": 3,
    "assignment_confirmed": true,
    "origin": "manual"
  }
```

Notas:
- `amount` va **negativo** (gasto). Si algún día se quiere una variante
  "Ingreso rápido", es el mismo insert con `amount` positivo.
- `monia_id` es el único requisito de deduplicación de `transactions`
  (`unique(user_id, monia_id)`, ya existente, sin cambio de esquema) — un
  valor único por ejecución alcanza; no hace falta idempotencia adicional
  acá porque cada ejecución del Shortcut es una compra distinta por
  definición (a diferencia de una transferencia, ver abajo).
- `currency` queda fijo en `'COP'` a propósito: las cuentas en divisa (arq,
  arq eur) casi siempre se cargan vía el flujo de MonIA con conversión
  pendiente (ver `.claude/rules/motor-asignacion.md`, "Compras en divisa");
  un gasto en divisa real desde este Shortcut se corrige a mano después
  desde `GastosDiarios.jsx`, o se usa el botón "+" de la app (que sí deriva
  la moneda de la cuenta elegida) en vez de este Shortcut.
- Queda sin categoría ni tag — se completa después en la app si hace falta,
  igual que cualquier fila que cae en "Pendientes de banco" (acá no cae ahí
  porque `assignment_confirmed = true`, pero sigue siendo editable).

## Shortcut "Transferencia rápida"

Lee las cuentas activas de Supabase en cada ejecución, así que **no lleva
UUIDs pegados a mano**: crear, renombrar o archivar una cuenta en la app se
refleja solo en los menús del Shortcut.

**Flujo**, con los nombres de las acciones en Atajos en español (entre
paréntesis el nombre en inglés donde no se pudo confirmar el español):

1. **Login** (paso 1 común) → `Obtener valor del diccionario` `access_token`
   → `Definir variable` **Token**.
2. **Traer cuentas** → `Obtener contenido de URL` → `Definir variable`
   **Cuentas**:
   ```
   GET https://<SUPABASE_URL>/rest/v1/accounts?select=id,name,currency&is_active=eq.true&order=name
   Headers:
     apikey: <ANON_KEY>
     Authorization: Bearer <Token>
   ```
3. **Lista de nombres** → `Repetir con cada` elemento de **Cuentas** →
   `Obtener valor del diccionario` `name` de *Elemento repetido* →
   `Terminar repetición`. La variable *Repetir resultados* queda con los
   nombres.
4. **Preguntas** → `Solicitar entrada` (Número, "¿Cuánto?") → **Monto**.
   Luego `Elegir de la lista` sobre *Repetir resultados* ("¿Desde qué
   cuenta?") → **Origen**. Luego otro `Elegir de la lista` ("¿Hacia qué
   cuenta?") → **Destino**.
5. **Resolver id y moneda** → `Repetir con cada` elemento de **Cuentas**, y
   adentro:
   - `Obtener valor del diccionario` `name` de *Elemento repetido*.
   - `Si` ese valor es **Origen** → `Obtener valor del diccionario` `id` de
     *Elemento repetido* → **OrigenID**; `currency` → **MonedaOrigen**.
   - `Si` ese mismo valor es **Destino** → `id` → **DestinoID**;
     `currency` → **MonedaDestino**.

   Después, `Terminar repetición`. No hace llamadas extra a la red.
6. **Validaciones** (cada una: `Mostrar alerta` → `Detener este atajo` (Stop
   This Shortcut)):
   - **Origen** es **Destino**.
   - **MonedaOrigen** no es **MonedaDestino** (ej. Dale COP → arq USD): ese
     caso necesita el segundo monto (`to_amount`/`to_currency`), así que se
     registra con el botón "+" de la app. Si se dejara pasar, la
     transferencia quedaría en la moneda del origen y
     `fetchBalancesForMonth` la descartaría en silencio del saldo de la
     cuenta en divisa.
7. **Confirmación obligatoria** → `Mostrar alerta` "¿Mover [Monto] de
   [Origen] a [Destino]?" con *Mostrar Cancelar* activado. Protege contra un
   toque posterior accidental: cancelar detiene el atajo antes del insert.
8. **Fecha y clave** → `Fecha actual` → `Formatear fecha`, formato
   personalizado `yyyy-MM-dd` → **Fecha**. Otro `Formatear fecha` de la
   misma fecha actual con formato `yyyyMMddHHmmssSSS` → `Texto`
   `shortcut-[resultado]` → **Clave**.
9. **Insert** → `Obtener contenido de URL`:
   ```
   POST https://<SUPABASE_URL>/rest/v1/account_transfers?on_conflict=user_id,idempotency_key
   Headers:
     apikey: <ANON_KEY>
     Authorization: Bearer <Token>
     Content-Type: application/json
     Prefer: return=minimal,resolution=ignore-duplicates
   Body (JSON):
     {
       "from_account_id": "<OrigenID>",
       "to_account_id": "<DestinoID>",
       "amount": <Monto>,
       "currency": "<MonedaOrigen>",
       "consumes_budget": true,
       "transfer_date": "<Fecha>",
       "idempotency_key": "<Clave>"
     }
   ```
10. **Resultado** → `Si` *Contenido de URL* tiene algún valor → `Mostrar
    resultado`, porque con `return=minimal` un insert exitoso responde
    vacío y cualquier contenido es el error de Supabase. `De lo contrario`
    → `Mostrar notificación` "Transferencia registrada".

Notas:
- `consumes_budget` va **siempre `true`**, sin preguntarlo — decisión
  confirmada con el usuario para mantener el Shortcut en 3 prompts (el caso
  más común es mover plata para gastarla desde la otra cuenta). Si alguna
  vez es solo reacomodo entre bolsillos sin gastar, se corrige borrando y
  recreando la transferencia desde `TransferHistorySection` en la app — una
  transferencia no tiene UI de edición, ese es el mecanismo de corrección
  para cualquier campo, no solo este. `sumOutgoingByAccount` ya ignora las
  transferencias hacia la madre, así que devolver plata a Bold no infla el
  "% usado" aunque el flag vaya en `true`.
- `idempotency_key`: se genera de nuevo en **cada ejecución** (la fecha con
  milisegundos basta; no hace falta ninguna acción de número aleatorio).
  `?on_conflict=user_id,idempotency_key` + `Prefer:
  resolution=ignore-duplicates` hace que un reintento de red con la *misma*
  clave se descarte en vez de duplicar la fila — pero nunca reutilizar la
  clave entre dos ejecuciones reales, o la segunda transferencia legítima se
  perdería en silencio.
- `transfer_date` se manda explícito con la fecha **local del teléfono**:
  el default de la columna (`current_date` del servidor) va en UTC, que
  desde las 7 p. m. en Bogotá ya es el día siguiente.
- Si los menús salen vacíos, el login falló (email o contraseña mal escritos
  en el paso 1): sin `access_token`, RLS devuelve `[]` en vez de un error.

## Cambio de esquema requerido

`account_transfers` no tenía ninguna clave de deduplicación (a diferencia de
`transactions.monia_id`) — ver `schema.sql` y `.claude/rules/esquema-datos.md`.
`schema.sql` ya incluye la columna `idempotency_key text` + `unique
(user_id, idempotency_key)`. En una base ya creada que todavía no la tenga,
correr una sola vez en el SQL Editor:

```sql
alter table account_transfers add column idempotency_key text;
alter table account_transfers add constraint account_transfers_user_idem_key unique (user_id, idempotency_key);
```

## Disparador recomendado: toque posterior

Ajustes → Accesibilidad → Tocar → **Toque posterior** (en algunas versiones
en español aparece como «Tocar atrás») → *Pulsar dos veces* o *Triple
pulsación* → elegir el atajo. Alternativas sin gesto físico: Action Button
(iPhone 15 Pro en adelante), un control fijo en el Centro de Control
(iOS 18+, alcanzable desde la pantalla bloqueada), o un ícono en la pantalla
de inicio agregado desde la app Atajos ("Añadir a pantalla de inicio").
