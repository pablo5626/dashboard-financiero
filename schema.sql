-- ============================================================================
-- Dashboard Financiero Personal — Esquema Supabase (Postgres)
-- Basado en prompt-dashboard-financiero.md
-- Ejecutar completo en el SQL Editor de Supabase. Multiusuario: cada tabla
-- lleva user_id (default auth.uid()) + RLS, así que cada persona que se
-- registra en la app empieza con cero filas — nada de lo de abajo se
-- precarga. Los bloques de INSERT comentados más abajo son solo ejemplos del
-- dueño original: NO ejecutarlos si ya hay más de un usuario (sus
-- "select id from accounts where name = ..." no filtran por usuario).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CUENTAS (madre + hijas)
-- ----------------------------------------------------------------------------
create table accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  name text not null,                          -- ej. "Bold", "Nequi", "Rappi"...
  kind text not null check (kind in ('madre', 'hija')),
  parent_account_id uuid references accounts(id),  -- hijas apuntan a la madre
  is_fixed_expenses_account boolean not null default false,
  currency text not null default 'COP',        -- moneda PRIMARIA de la cuenta (ej. USD para arq) — si is_multi_currency, las monedas adicionales viven en account_currencies, no acá
  is_multi_currency boolean not null default false, -- true = la cuenta tiene más de un bolsillo de moneda (ver account_currencies) bajo esta misma fila/id
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Monedas ADICIONALES de una cuenta multi-moneda (ej. arq en EUR además de su
-- USD primario) — todas comparten el mismo account_id real: no son cuentas
-- separadas, es una sola cuenta con varios saldos. Reemplaza el viejo
-- mecanismo de currency_group_id (dos filas de `accounts` enlazadas), que
-- solo agrupaba visualmente dos cuentas de verdad separadas; acá es una única
-- cuenta con varios `currency` posibles de verdad. `tag` es el texto que el
-- motor de asignación de MonIA (o una edición manual de tags) debe matchear
-- para que una transacción caiga en ESTE bolsillo específico en vez del
-- primario (ej. tag "arq eur" -> este bolsillo EUR de la cuenta "arq"); ver
-- .claude/rules/motor-asignacion.md.
create table account_currencies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  account_id uuid not null references accounts(id) on delete cascade,
  currency text not null,
  tag text not null,
  created_at timestamptz not null default now(),
  unique (account_id, currency),
  unique (user_id, tag)
);

alter table account_currencies enable row level security;
create policy "select own account_currencies" on account_currencies for select using (user_id = auth.uid());
create policy "insert own account_currencies" on account_currencies for insert with check (user_id = auth.uid());
create policy "update own account_currencies" on account_currencies for update using (user_id = auth.uid());
create policy "delete own account_currencies" on account_currencies for delete using (user_id = auth.uid());

-- Valores iniciales sugeridos (el usuario puede renombrar/eliminar libremente)
-- Se insertan solo como plantilla de arranque; comentar si no se desea precargar.
-- insert into accounts (user_id, name, kind) values (auth.uid(), 'Bold', 'madre');
-- insert into accounts (user_id, name, kind, parent_account_id) values
--   (auth.uid(), 'Dale',    'hija', (select id from accounts where name = 'Bold')),
--   (auth.uid(), 'Nequi',   'hija', (select id from accounts where name = 'Bold')),
--   (auth.uid(), 'Rappi',   'hija', (select id from accounts where name = 'Bold')),
--   (auth.uid(), 'Nubank',  'hija', (select id from accounts where name = 'Bold')),
--   (auth.uid(), 'Efectivo','hija', (select id from accounts where name = 'Bold')),
--   (auth.uid(), 'Pibank',  'hija', (select id from accounts where name = 'Bold'));
-- Nota: Pibank se agrupa bajo Bold solo para efectos de organización/UI.
-- El dinero real no sale de Bold, sino de la hija que corresponda cada vez
-- (ej. Nequi) -- eso se registra aparte en account_transfers, no aquí:
-- insert into account_transfers (user_id, from_account_id, to_account_id, amount, currency, transfer_date, note)
-- values (
--   auth.uid(),
--   (select id from accounts where name = 'Nequi'),
--   (select id from accounts where name = 'Pibank'),
--   100000, 'COP', current_date, 'Aporte ahorro en pareja'
-- );

-- ----------------------------------------------------------------------------
-- 2. TASA DE CAMBIO (manual, editable, un único valor vigente por par de monedas)
-- ----------------------------------------------------------------------------
create table exchange_rates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  base_currency text not null default 'COP',
  quote_currency text not null default 'USD',
  rate numeric not null,                      -- ej. 1 USD = 4000 COP -> rate = 4000
  updated_at timestamptz not null default now(),
  unique (user_id, base_currency, quote_currency)
);

-- ----------------------------------------------------------------------------
-- 3. DISTRIBUCIÓN MENSUAL (madre -> hijas), con memoria del mes anterior
-- ----------------------------------------------------------------------------
create table account_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  account_id uuid not null references accounts(id),
  year int not null,
  month int not null check (month between 1 and 12),
  allocated_amount numeric not null,
  currency text not null default 'COP',
  created_at timestamptz not null default now(),
  unique (user_id, account_id, year, month)
);

-- Saldos iniciales de cada cuenta hija al arranque del mes.
-- Tabla pensada para recibir el POST directo del Shortcut de iOS (Fase 2)
-- vía la API REST auto-generada de Supabase.
create table monthly_initial_balances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  account_id uuid not null references accounts(id),
  year int not null,
  month int not null check (month between 1 and 12),
  initial_balance numeric not null,
  currency text not null default 'COP',
  source text not null default 'manual' check (source in ('manual', 'shortcut')),
  created_at timestamptz not null default now(),
  -- Incluye currency (no solo account_id/year/month) para que una cuenta
  -- multi-moneda pueda tener un saldo inicial por cada bolsillo el mismo mes
  -- (ej. arq-USD y arq-EUR), en vez de pisarse entre sí.
  unique (user_id, account_id, year, month, currency)
);

-- Historial de transferencias entre cuentas (madre->hija, hija->hija, ajustes)
create table account_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  from_account_id uuid references accounts(id),
  to_account_id uuid references accounts(id),
  amount numeric not null,
  currency text not null default 'COP',
  to_amount numeric,
  to_currency text,
  -- Si la plata que sale consume el presupuesto de la cuenta de origen (se
  -- movió para gastarla desde la otra cuenta) o es solo reacomodo entre
  -- bolsillos. Se elige al crear la transferencia; ver sumOutgoingByAccount.
  consumes_budget boolean not null default true,
  transfer_date date not null default current_date,
  note text,
  created_at timestamptz not null default now(),
  -- Clave de idempotencia opcional para escrituras directas por REST (ej. el
  -- Shortcut de iOS de "Transferencia rápida", ver .claude/rules/shortcuts-ios.md):
  -- a diferencia de transactions.monia_id, account_transfers no tenía ninguna
  -- protección contra duplicados. El Shortcut genera una key nueva por toque
  -- real y hace el insert con ?on_conflict=user_id,idempotency_key +
  -- Prefer: resolution=ignore-duplicates, así un reintento de red o un
  -- disparo accidental (ej. Back Tap) no crea una fila repetida. Nula para
  -- transferencias creadas desde la app, que no la necesitan.
  idempotency_key text,
  unique (user_id, idempotency_key)
);

-- ----------------------------------------------------------------------------
-- 4. CATÁLOGO DE CATEGORÍAS (editable; valores iniciales = tabla del prompt)
-- ----------------------------------------------------------------------------
create table categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  name text not null,
  emoji text,
  color text,                                    -- hex elegido por el usuario para esta categoría (ej. en la grilla de Diario.jsx); null = color automático por hash del nombre
  is_ambiguous boolean not null default true,   -- false = 100% inequívoca (ej. Suscripciones)
  monthly_budget numeric,                        -- tope mensual editable, mismo monto todos los meses hasta que se cambie (null = sin presupuesto definido)
  is_active boolean not null default true,       -- archivado (soft delete, igual que accounts.is_active)
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- ----------------------------------------------------------------------------
-- 5. TRANSACCIONES (importadas de MonIA; account_id nullable = "pendiente de banco")
-- ----------------------------------------------------------------------------
create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  monia_id text not null,                     -- campo `id` del CSV, clave de deduplicación
  occurred_at timestamptz not null,           -- campo `date` (UTC ISO 8601)
  purpose text not null,
  amount numeric not null,                    -- negativo = gasto, positivo = ingreso
  currency text not null default 'COP',
  category_id uuid references categories(id),
  emoji text,
  creator text,
  creator_name text,
  tags text[] not null default '{}',          -- `tags` separados por ; en el CSV
  source_timezone text,
  account_id uuid references accounts(id),    -- null = pendiente de banco
  assignment_level smallint,                  -- 1 = tag banco, 2 = categoría inequívoca, 3 = manual
  assignment_confirmed boolean not null default false,
  -- 'auto_capture' = confirmada desde la bandeja de capturas automáticas
  -- (Apple Pay / notificación del banco, ver auto_captures más abajo); la
  -- conciliación con el CSV de MonIA busca justamente estas filas.
  origin text not null default 'csv_import' check (origin in ('csv_import', 'manual', 'auto_capture')),
  loan_reviewed boolean not null default false, -- true una vez que una fila de categoría "Préstamo" (dinero prestado saliente) fue vinculada a un registro en `debts` o descartada explícitamente — evita volver a sugerirla en cada importación
  -- Compras en divisa exportadas en COP: MonIA deja cargar el monto en su
  -- moneda original pero al guardar lo convierte, así que el CSV llega en COP
  -- y el monto real (ej. 51.31 EUR) se pierde. Cuando la cuenta asignada tiene
  -- otra moneda, `amount`/`currency` quedan en la moneda de la CUENTA (estimados
  -- con la tasa manual de `exchange_rates`) y estas columnas guardan el dato
  -- original del CSV para auditoría y para que el usuario teclee el monto exacto.
  source_amount numeric,                        -- monto tal cual venía en el CSV
  source_currency text,                         -- su moneda de origen (típicamente 'COP')
  currency_pending boolean not null default false, -- true = `amount` todavía es la estimación, falta confirmarlo
  created_at timestamptz not null default now(),
  unique (user_id, monia_id)
);

create index idx_transactions_date on transactions (user_id, occurred_at);
create index idx_transactions_pending on transactions (user_id) where account_id is null;
create index idx_transactions_currency_pending on transactions (user_id) where currency_pending;
create index idx_transactions_category on transactions (user_id, category_id);

-- Aprendizaje incremental: frecuencia categoría(+tag) -> cuenta, alimentada
-- cada vez que el usuario confirma manualmente una asignación (Nivel 3).
create table category_account_stats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  category_id uuid not null references categories(id),
  tag text,                                   -- null = estadística agregada solo por categoría
  account_id uuid not null references accounts(id),
  confirm_count int not null default 0,
  last_confirmed_at timestamptz,
  unique (user_id, category_id, tag, account_id)
);

-- EN DESUSO: ya nada lee ni escribe esta tabla. La sugerencia descripción ->
-- categoría + tag ahora se calcula al vuelo desde `transactions`
-- (suggestCategoryForPurpose en src/lib/transactionsApi.js), lo que evita
-- mantener contadores que no veían ediciones ni borrados. Se deja creada para
-- no tocar la base viva; se puede borrar (drop table) como limpieza aparte.
create table purpose_category_stats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  purpose_key text not null,                    -- purpose normalizado (normalizePurpose)
  category_id uuid not null references categories(id),
  tag text,                                      -- null = sin tag aprendido para este par
  confirm_count int not null default 0,
  last_confirmed_at timestamptz,
  unique (user_id, purpose_key, category_id, tag)
);

-- ----------------------------------------------------------------------------
-- 6. GASTOS FIJOS RECURRENTES
-- ----------------------------------------------------------------------------
create table fixed_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  account_id uuid references accounts(id),
  name text not null,
  amount numeric not null,
  currency text not null default 'COP',
  due_day int not null check (due_day between 1 and 31),
  frequency text not null check (frequency in ('mensual', 'anual')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Estado por mes: si se incluyó en el presupuesto del mes y si ya se pagó
create table fixed_expense_month_status (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  fixed_expense_id uuid not null references fixed_expenses(id),
  year int not null,
  month int not null check (month between 1 and 12),
  included boolean not null default true,
  amount_override numeric,                    -- si el usuario ajustó el monto ese mes
  paid boolean not null default false,
  paid_at timestamptz,
  unique (user_id, fixed_expense_id, year, month)
);

-- ----------------------------------------------------------------------------
-- 7. DEUDAS / PRÉSTAMOS
-- ----------------------------------------------------------------------------
create table debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  creditor_name text not null,
  total_amount numeric not null,
  remaining_amount numeric not null,
  interest_rate numeric,                      -- % MENSUAL (ej. 1.5 = 1.5% mensual)
  monthly_payment numeric,
  term_months int,                            -- plazo en cuotas, para generar el cronograma de amortización (sistema francés)
  currency text not null default 'COP',
  start_date date,
  is_active boolean not null default true,
  schedule_synced_remaining_amount numeric,   -- snapshot de remaining_amount al generar/regenerar el cronograma; drift vs. remaining_amount = cronograma desactualizado
  direction text not null default 'debo' check (direction in ('debo', 'me_deben')), -- 'debo' = deuda propia, 'me_deben' = préstamo dado (cobro pendiente)
  counterparty_relationship text check (counterparty_relationship is null or counterparty_relationship in ('amigo', 'familiar', 'companero', 'pareja', 'conocido', 'otro')), -- solo aplica cuando direction = 'me_deben'
  contact_info text,                          -- teléfono/contacto opcional, solo 'me_deben'
  expected_payment_date date,                 -- fecha esperada de pago, opcional, solo 'me_deben'
  notes text,                                 -- motivo / descripción libre
  source_transaction_id uuid references transactions(id), -- si se creó desde un movimiento MonIA de categoría "Préstamo" detectado en el import, referencia esa fila
  created_at timestamptz not null default now()
);

create table debt_installments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  debt_id uuid not null references debts(id),
  due_date date not null,
  amount numeric not null,
  paid boolean not null default false,
  paid_at timestamptz,
  linked_transaction_id uuid references transactions(id), -- para abonos de 'me_deben' con cuenta destino: la transacción real que refleja el ingreso, para poder revertirla si se borra el abono
  account_id uuid references accounts(id) -- copia de la cuenta destino del abono, solo para mostrarla en la tabla sin tener que hacer join contra transactions
);

-- ----------------------------------------------------------------------------
-- 8. METAS DE AHORRO (ahorro con propósito + metas puntuales)
-- ----------------------------------------------------------------------------
create table savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  kind text not null check (kind in ('proposito', 'puntual')),
  name text not null,
  account_id uuid references accounts(id),    -- solo aplica a kind = 'proposito'
  target_amount numeric,                      -- opcional en ambos casos
  current_amount numeric not null default 0,  -- usado directo en 'puntual'
  currency text not null default 'COP',
  target_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Historial de aportes (aplica a ambos tipos de meta)
create table savings_contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  savings_goal_id uuid not null references savings_goals(id),
  contributed_at date not null default current_date,
  amount numeric not null,
  note text,
  -- Cuenta de origen del aporte y la transacción real que descontó de ahí —
  -- solo se usan para metas 'puntual' (sin cuenta vinculada); en 'proposito'
  -- el avance ya viene del saldo real de la cuenta vinculada, así que crear
  -- una transacción ahí duplicaría el conteo (ver MetasAhorro.jsx).
  account_id uuid references accounts(id),
  linked_transaction_id uuid references transactions(id),
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 9. CATÁLOGO DE TAGS (autocompletado; no es una tabla normativa)
-- ----------------------------------------------------------------------------
-- transactions.tags sigue siendo un text[] libre (ver motor-asignacion.md) —
-- esta tabla no tiene FK desde ahí, es solo el catálogo que alimenta el
-- selector de Ajustes → Tags y las sugerencias en SearchPanel/QuickCaptureFAB.
-- Se llena de dos formas: a mano desde Ajustes, o automáticamente cada vez
-- que se guarda un movimiento con un tag que todavía no está acá
-- (tagsApi.ensureTags, llamada desde createManualTransaction,
-- updateTransactionTags, updateTransaction e importTransactions).
create table tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- Ajustes globales del usuario (no específicos de una cuenta ni categoría) —
-- una sola fila por usuario (user_id es la propia primary key, no hay id
-- aparte). Hoy solo controla el umbral de la alerta de presupuesto por
-- categoría (Ajustes → Presupuestos, panelApi.fetchAlerts) — pensada para
-- crecer si aparecen más ajustes globales más adelante.
create table user_settings (
  user_id uuid primary key references auth.users(id) default auth.uid(),
  budget_alerts_enabled boolean not null default true,
  budget_alert_threshold_pct integer not null default 100,
  created_at timestamptz not null default now()
);

-- Contador diario de llamadas a las Edge Functions de IA (voice-parse,
-- receipt-parse, money-ask), que comparten una sola GEMINI_API_KEY — sin un
-- tope por usuario, cualquiera que se registre podría gastarla. Una fila por
-- usuario y día (UTC); la función consume_ai_quota la incrementa y dice si
-- todavía está dentro del límite.
create table ai_usage (
  user_id uuid not null references auth.users(id) default auth.uid(),
  day date not null default current_date,
  count integer not null default 0,
  primary key (user_id, day)
);

-- ai_usage NO usa las políticas genéricas de más abajo: si el usuario pudiera
-- hacer update/delete sobre su propia fila, pondría el contador en 0 y se
-- saltaría el tope. Solo puede LEER su fila; escribir lo hace únicamente
-- consume_ai_quota, que es security definer.
alter table ai_usage enable row level security;
create policy "select_own" on ai_usage for select using (user_id = auth.uid());

-- security definer: corre con los permisos del dueño de la función, por eso
-- ignora la RLS de ai_usage (que no tiene políticas de escritura) pero solo
-- toca la fila de auth.uid(). search_path fijo para evitar secuestro de
-- nombres; sin sesión (auth.uid() null) falla en vez de escribir nada.
create or replace function consume_ai_quota(p_limit integer default 60)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'no autenticado';
  end if;
  insert into ai_usage (user_id, day, count)
  values (auth.uid(), current_date, 1)
  on conflict (user_id, day) do update set count = ai_usage.count + 1
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;

revoke execute on function consume_ai_quota(integer) from public, anon;
grant execute on function consume_ai_quota(integer) to authenticated;

-- ----------------------------------------------------------------------------
-- CAPTURA AUTOMÁTICA (Apple Pay vía Atajos / notificaciones del banco vía
-- MacroDroid) — ver .claude/rules/captura-automatica.md
-- ----------------------------------------------------------------------------
-- Token personal que el teléfono manda a la Edge Function auto-capture en vez
-- de la contraseña. Solo se guarda su sha256: el valor en claro se muestra una
-- única vez al crearlo. Sin política de insert/update: el alta pasa por
-- create_capture_token (security definer) y "revocar" es borrar la fila.
create table capture_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  label text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table capture_tokens enable row level security;
create policy "select_own" on capture_tokens for select using (user_id = auth.uid());
create policy "delete_own" on capture_tokens for delete using (user_id = auth.uid());

-- Registro de cada captura y recordatorio de revisión ("Capturas automáticas
-- por revisar" en Gastos). Lo que suma a saldos es siempre la transacción que
-- crea ingest_auto_capture (origin 'auto_capture', transaction_id apunta a
-- ella), nunca esta fila. status 'pending' con transaction_id = guardada sin
-- revisar; sin transaction_id = falta completarla (sin monto, u otra moneda).
create table auto_captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  source text not null check (source in ('apple_pay', 'android_notification')),
  source_app text,                       -- paquete Android que publicó la notificación
  raw_text text,                         -- texto original, para completar a mano si no se pudo parsear
  merchant text,
  amount numeric,                        -- positivo; null = no se pudo leer el monto
  currency text not null default 'COP',
  occurred_at timestamptz not null default now(),
  account_id uuid references accounts(id), -- resuelta desde la pista `cuenta` del teléfono
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'discarded', 'merged')),
  transaction_id uuid references transactions(id) on delete set null,
  dedup_key text not null,               -- absorbe notificaciones repetidas y reintentos de red
  received_at timestamptz not null default now(),
  unique (user_id, dedup_key)
);

create index idx_auto_captures_pending on auto_captures (user_id) where status = 'pending';

create or replace function create_capture_token(p_label text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'no autenticado';
  end if;
  v_token := 'cap_' || encode(extensions.gen_random_bytes(32), 'hex');
  insert into capture_tokens (user_id, label, token_hash)
  values (auth.uid(), left(coalesce(nullif(trim(p_label), ''), 'Teléfono'), 60),
          encode(extensions.digest(v_token, 'sha256'), 'hex'));
  return v_token;
end;
$$;

revoke execute on function create_capture_token(text) from public, anon;
grant execute on function create_capture_token(text) to authenticated;

-- Llamada por la Edge Function auto-capture con la anon key (el teléfono no
-- tiene sesión): el token de captura ES la autenticación. Resuelve el usuario
-- por el hash del token y solo escribe filas de ese usuario.
--
-- Guardado automático (pedido del usuario): si se leyó el monto, además de la
-- fila en auto_captures crea YA la transacción (origin 'auto_capture',
-- monia_id 'auto-<id>'), con la categoría + tag aprendidos del historial por
-- texto exacto del comercio — misma regla que suggestCategoryForPurpose en
-- transactionsApi.js. La captura queda 'pending' con transaction_id: "pending"
-- significa "guardada pero sin revisar", y la bandeja de Gastos le recuerda al
-- usuario rectificarla. Sin monto, o con una cuenta en otra moneda (el gasto
-- se descartaría en silencio del saldo), no se crea transacción y la captura
-- espera a que el usuario la complete. Devuelve 'saved', 'inserted' (solo en
-- la bandeja), 'duplicate', 'invalid_token' o 'rate_limited'.
create or replace function ingest_auto_capture(
  p_token text,
  p_source text,
  p_source_app text,
  p_raw_text text,
  p_merchant text,
  p_amount numeric,
  p_currency text,
  p_occurred_at timestamptz,
  p_account_hint text,
  p_dedup_key text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_account uuid;
  v_account_currency text;
  v_currency text := coalesce(nullif(p_currency, ''), 'COP');
  v_occurred timestamptz := coalesce(p_occurred_at, now());
  v_hint text;
  v_id uuid;
  v_category uuid;
  v_tag text;
  v_tx uuid;
begin
  select user_id into v_uid from capture_tokens
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if v_uid is null then
    return 'invalid_token';
  end if;

  update capture_tokens set last_used_at = now()
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');

  if (select count(*) from auto_captures
      where user_id = v_uid and received_at > now() - interval '1 day') >= 200 then
    return 'rate_limited';
  end if;

  v_hint := lower(trim(replace(coalesce(p_account_hint, ''), '_', ' ')));
  if v_hint <> '' then
    select id, coalesce(currency, 'COP') into v_account, v_account_currency from accounts
    where user_id = v_uid and is_active and lower(trim(replace(name, '_', ' '))) = v_hint
    limit 1;
  end if;

  insert into auto_captures (user_id, source, source_app, raw_text, merchant, amount, currency,
                             occurred_at, account_id, dedup_key)
  values (v_uid, p_source, left(p_source_app, 200), left(p_raw_text, 1000), left(p_merchant, 200),
          p_amount, v_currency, v_occurred, v_account, left(p_dedup_key, 128))
  on conflict (user_id, dedup_key) do nothing
  returning id into v_id;

  if v_id is null then
    return 'duplicate';
  end if;

  if p_amount is null or p_amount <= 0 or (v_account is not null and v_account_currency <> v_currency) then
    return 'inserted';
  end if;

  -- Categoría + tag más frecuentes para ese comercio en el historial (texto
  -- exacto normalizado, sin filas ignoradas); a igualdad, el más reciente.
  if nullif(trim(coalesce(p_merchant, '')), '') is not null then
    select category_id, tags[1] into v_category, v_tag from transactions
    where user_id = v_uid and category_id is not null
      and lower(trim(purpose)) = lower(trim(p_merchant))
      and not (tags && array['traslado', 'moneda', 'ignorar'])
    group by category_id, tags[1]
    order by count(*) desc, max(occurred_at) desc
    limit 1;
  end if;

  insert into transactions (user_id, monia_id, occurred_at, purpose, amount, currency, category_id,
                            account_id, tags, assignment_level, assignment_confirmed, origin)
  values (v_uid, 'auto-' || v_id, v_occurred, coalesce(nullif(trim(p_merchant), ''), 'Compra'),
          -abs(p_amount), v_currency, v_category, v_account,
          case when v_tag is null then '{}'::text[] else array[v_tag] end,
          case when v_account is null then 3 else 1 end, v_account is not null, 'auto_capture')
  on conflict (user_id, monia_id) do nothing
  returning id into v_tx;

  update auto_captures set transaction_id = v_tx where id = v_id;
  return 'saved';
end;
$$;

revoke execute on function ingest_auto_capture(text, text, text, text, text, numeric, text, timestamptz, text, text) from public;
grant execute on function ingest_auto_capture(text, text, text, text, text, numeric, text, timestamptz, text, text) to anon;

-- ============================================================================
-- ROW LEVEL SECURITY: cada tabla solo expone las filas del usuario dueño
-- ============================================================================
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'accounts', 'exchange_rates', 'account_allocations', 'monthly_initial_balances',
    'account_transfers', 'categories', 'transactions', 'category_account_stats',
    'purpose_category_stats',
    'fixed_expenses', 'fixed_expense_month_status', 'debts', 'debt_installments',
    'savings_goals', 'savings_contributions', 'tags', 'user_settings', 'auto_captures'
  ])
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('create policy "select_own" on %I for select using (user_id = auth.uid());', t);
    execute format('create policy "insert_own" on %I for insert with check (user_id = auth.uid());', t);
    execute format('create policy "update_own" on %I for update using (user_id = auth.uid());', t);
    execute format('create policy "delete_own" on %I for delete using (user_id = auth.uid());', t);
  end loop;
end $$;

-- ============================================================================
-- Catálogo inicial de categorías del dueño original (tomado de la tabla de
-- mapeo del prompt). Un usuario nuevo NO lo hereda: crea las suyas desde la app.
-- Ejecutar UNA VEZ ya autenticado (auth.uid() debe resolver a tu usuario)
-- ============================================================================
-- insert into categories (user_id, name, is_ambiguous) values
--   (auth.uid(), 'Anita de mi corazón', true),
--   (auth.uid(), 'Aportes', true),
--   (auth.uid(), 'Compras', true),
--   (auth.uid(), 'Cuidado personal', true),
--   (auth.uid(), 'Deuda o cuadre', true),
--   (auth.uid(), 'Donativo', true),
--   (auth.uid(), 'Educación', true),
--   (auth.uid(), 'Medicina', true),
--   (auth.uid(), 'Mekato', true),
--   (auth.uid(), 'Mercado', true),
--   (auth.uid(), 'Ocio', true),
--   (auth.uid(), 'Préstamo', true),
--   (auth.uid(), 'Regalo - festividades', true),
--   (auth.uid(), 'Ropa', true),
--   (auth.uid(), 'Salida a comer', true),
--   (auth.uid(), 'Servicios', true),
--   (auth.uid(), 'Suscripciones', false),
--   (auth.uid(), 'Tarjeta', true),
--   (auth.uid(), 'Transporte', true),
--   (auth.uid(), 'Viaje', false);

-- ============================================================================
-- Meta de ahorro para Pibank (ahorro en pareja)
-- Ejecutar después de haber creado la cuenta Pibank más arriba.
-- ============================================================================
-- insert into savings_goals (user_id, kind, name, account_id, currency)
-- values (
--   auth.uid(), 'proposito', 'Ahorro en pareja',
--   (select id from accounts where name = 'Pibank'), 'COP'
-- );
