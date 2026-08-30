# Reglas del esquema de datos (Supabase / schema.sql)

`schema.sql` en la raíz del proyecto es la fuente de verdad del modelo de
datos. Cualquier cambio de esquema se hace ahí, no en migraciones sueltas ni
directamente en el panel de Supabase sin reflejarlo en el archivo.

- **RLS obligatorio en toda tabla nueva**: `user_id uuid not null references
  auth.users(id) default auth.uid()` + políticas `select/insert/update/delete`
  con `user_id = auth.uid()`. Es un solo usuario hoy, pero el diseño ya
  contempla un segundo creador (pareja) sin romper el modelo.
- **`transactions.account_id` es nullable a propósito**: representa el estado
  "pendiente de banco" del motor de asignación (ver `motor-asignacion.md`). No
  se reemplaza por una cuenta ficticia tipo "Sin asignar".
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
- **`monthly_initial_balances`** es la tabla pensada para recibir el POST del
  futuro Shortcut de iOS (Fase 2) vía la API REST auto-generada de Supabase —
  mantenerla simple (una fila por cuenta hija por mes) porque ese es su
  contrato de entrada.
- **`category_account_stats`** guarda aprendizaje incremental por categoría
  **y por tag** (columna `tag` nullable): una fila agrega por categoría sola,
  otra fila específica por categoría+tag, para que el orden de sugerencias
  use el tag cuando exista.
- Los bloques de `insert` de valores iniciales (cuentas, categorías) están
  comentados en `schema.sql` a propósito — se ejecutan una vez, ya
  autenticado, para que `auth.uid()` resuelva al usuario real.
