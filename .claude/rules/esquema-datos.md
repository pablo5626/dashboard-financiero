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
