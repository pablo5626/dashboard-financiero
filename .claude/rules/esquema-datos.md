---
paths:
  - schema.sql
  - src/lib/*Api.js
---

# Reglas del esquema de datos (Supabase / schema.sql)

`schema.sql` en la raíz del proyecto es la fuente de verdad del modelo de
datos. Cualquier cambio de esquema se hace ahí, no en migraciones sueltas ni
directamente en el panel de Supabase sin reflejarlo en el archivo.

- **RLS obligatorio en toda tabla nueva**: `user_id uuid not null references
  auth.users(id) default auth.uid()` + políticas `select/insert/update/delete`
  con `user_id = auth.uid()`. La app es multiusuario con registro abierto:
  cada persona que se registra empieza con cero filas (no hay triggers ni
  seeds sobre `auth.users`), y el aislamiento entre personas es solo RLS.
- **`ai_usage` + `consume_ai_quota(p_limit)`**: contador diario por usuario
  (`user_id`, `day`, `count`) de llamadas a las Edge Functions de IA, que
  comparten una sola `GEMINI_API_KEY`. La función es `security invoker`, así
  que solo toca la fila del propio usuario; devuelve `false` al pasar el
  límite (60 por día, definido en `supabase/functions/_shared/quota.ts`).
- **`transactions.account_id` es nullable a propósito**: representa el estado
  "pendiente de banco" del motor de asignación (ver `motor-asignacion.md`). No
  se reemplaza por una cuenta ficticia tipo "Sin asignar".
- **`transactions.source_amount` / `source_currency` / `currency_pending`**
  existen solo para las compras en divisa que MonIA exporta convertidas a COP
  (ver `motor-asignacion.md`). `amount`/`currency` siguen siendo la verdad
  canónica —siempre en la moneda de la cuenta— y `source_*` es la fila original
  del CSV, guardada como auditoría; `currency_pending` marca que `amount` es
  todavía una estimación hecha con la tasa manual y falta que el usuario
  confirme el monto real.
- **Deduplicación por `monia_id`** (el campo `id` del CSV de MonIA) vía
  `unique (user_id, monia_id)` en Postgres — la idempotencia de reimportar el
  mismo CSV se garantiza en la base de datos, nunca solo en el cliente.
- **`parent_account_id` es jerarquía/UI, no flujo de dinero real**. Una cuenta
  hija puede estar agrupada bajo Bold (la madre) para efectos de
  visualización aunque el dinero que recibe no salga de Bold (ej. Pibank,
  financiada desde Nequi). El origen real del dinero se registra siempre en
  `account_transfers` (`from_account_id` → `to_account_id`), sin restricción
  de que el origen sea la madre.
- **`account_allocations`** modela específicamente el ritual mensual
  madre→hijas (distribución de presupuesto). Una cuenta financiada de forma
  puntual desde otra hija no necesita fila ahí ese mes.
- **`account_transfers` alimenta dos cosas, no una**: el saldo de ambas cuentas
  (siempre lo hizo) y además el "% usado" de la cuenta de **origen** — la plata
  que sale de una hija consume su presupuesto aunque la compra final se ejecute
  desde la cuenta destino. La regla vive en `sumOutgoingByAccount`
  (`transfersApi.js`), que excluye las transferencias de vuelta a la madre
  (devolución, no uso) y las marcadas `consumes_budget = false`. Esa columna
  (boolean, default `true`) la elige el usuario con un checkbox al crear la
  transferencia, porque mover plata entre dos hijas es ambiguo: puede ser
  fondear una compra que se ejecuta desde la otra cuenta o puro reacomodo de
  bolsillos. Lo que sigue sin cambiar: una transferencia **nunca** es un gasto
  en las vistas consolidadas (Panel general).
- **`monthly_initial_balances`** ya no representa una carga mensual
  obligatoria por cuenta — una fila es un **ancla puntual**: el saldo real de
  ese bolsillo al arranque de ese mes exacto, cargada a mano (o vía el
  Shortcut de iOS de Fase 2, `source: 'shortcut'`) solo cuando el banco real
  difiere de lo calculado. La lectura (`fetchBalancesForMonth` en
  `accountsApi.js`, `fetchMonthlyTrend` en `panelApi.js`, ambas vía
  `resolveAnchorsFromRows` en `src/lib/balanceAnchors.js`) resuelve, por
  bolsillo, la fila explícita más reciente con `(year, month) <= mes
  consultado` y acumula transacciones/transferencias desde ahí; sin ninguna
  fila, el ancla es 0 en el mes de `accounts.created_at`. Sigue siendo la
  tabla que recibe la siembra inicial al crear una cuenta
  (`accountsApi.createAccount`, tanto para el bolsillo primario como para
  cada moneda extra de una cuenta multi-moneda) — lo que cambió es que ya no
  hace falta una fila nueva cada mes para que el saldo se calcule bien.
- **`user_settings`** guarda ajustes globales del usuario (no de una cuenta ni
  una categoría en particular) — **una sola fila por usuario**, y `user_id` es
  su propia primary key (no tiene `id` aparte, a diferencia del resto de las
  tablas). Hoy solo tiene `budget_alerts_enabled` (default `true`) y
  `budget_alert_threshold_pct` (default `100`), que controlan la alerta de
  presupuesto por categoría de `panelApi.fetchAlerts` (Ajustes →
  Presupuestos). Sin fila todavía, `userSettingsApi.getUserSettings()`
  devuelve esos mismos defaults, así que el comportamiento anterior (alerta
  solo al pasarse del 100%) se conserva hasta que el usuario toque algo. Se
  escribe con `upsert` sobre `user_id`, apoyándose en el
  `default auth.uid()` de la columna igual que cualquier otro insert de la
  app. Está en el mismo bucle de RLS de `schema.sql` que el resto.
- **`category_account_stats`** guarda aprendizaje incremental por categoría
  **y por tag** (columna `tag` nullable): una fila agrega por categoría sola,
  otra fila específica por categoría+tag, para que el orden de sugerencias
  use el tag cuando exista.
- **`purpose_category_stats`** es el mismo tipo de aprendizaje incremental un
  nivel antes: descripción (`purpose`, normalizada con `normalizePurpose`) →
  categoría + tag, alimentada tanto por `createManualTransaction` como por
  `importTransactions` (`src/lib/transactionsApi.js`) cada vez que una fila
  guarda una categoría resuelta. Solo se usa para precargar (nunca
  autoguardar) categoría/tag en el formulario de carga manual
  (`QuickCaptureFAB.jsx`, único formulario manual que queda — ver
  "GastosDiarios.jsx" en `CLAUDE.md`) cuando el usuario repite una
  descripción ya vista — matching por texto exacto normalizado, sin fuzzy
  matching por ahora (evaluado y explícitamente diferido, ver "Known
  deferred scope" en `CLAUDE.md`).
- Los bloques de `insert` de valores iniciales (cuentas, categorías) están
  comentados en `schema.sql` a propósito — se ejecutan una vez, ya
  autenticado, para que `auth.uid()` resuelva al usuario real.
- **`tags` es una tabla NO normativa** — un catálogo de autocompletado/gestión
  para Ajustes → Tags, sin FK desde `transactions.tags` (que sigue siendo un
  `text[]` libre, ver `motor-asignacion.md`). Se llena a mano desde esa
  pantalla o automáticamente vía `tagsApi.ensureTags`, llamada desde
  `createManualTransaction`, `updateTransactionTags`, `updateTransaction` e
  `importTransactions` cada vez que se guarda un tag nuevo — filtrando con
  `isReservedTag` para que un nombre de cuenta o un `IGNORED_TAGS` nunca
  entre al catálogo como si fuera un tag real.

## Cambios de esquema en la base de datos ya viva

`schema.sql` solo se ejecuta completo en una instalación limpia. Como el
proyecto Supabase del usuario ya existe, todo cambio de esquema necesita
*ambas* cosas: (a) el cambio en `schema.sql` para futuras instalaciones
limpias, y (b) un snippet SQL de una sola vez que se le entrega al usuario
para correr en el SQL Editor de Supabase (`alter table ... add column
...;` / `insert into ...;` plano — no se usa framework de migraciones).
Dos gotchas aprendidos:

- El SQL Editor corre como el superusuario `postgres` sin JWT, así que
  `auth.uid()` **siempre evalúa a `null`** ahí — un `insert into
  categories (user_id, ...) values (auth.uid(), ...)` falla por
  violación de not-null. En su lugar, toma el `user_id` real de una fila
  existente de la misma tabla (u otra tabla del mismo usuario), ej.
  `insert into categories (user_id, name, is_ambiguous) select user_id, 'X', true from categories limit 1;`.
- Si un snippet de varias sentencias falla a la mitad, el SQL Editor de
  Supabase revierte *todo el bloque* (corre como una sola transacción) —
  el error de una sentencia posterior deshace silenciosamente una
  sentencia anterior que parecía haber funcionado. Entrégale al usuario
  snippets separados para correr uno a la vez cuando un paso posterior es
  riesgoso (ej. un `insert` después de un `alter table`), y si PostgREST
  no reconoce una columna recién agregada de inmediato,
  `notify pgrst, 'reload schema';` fuerza a que la reconozca.
