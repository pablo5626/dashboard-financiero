-- ============================================================================
-- Dashboard Financiero Personal — Esquema Supabase (Postgres)
-- Basado en prompt-dashboard-financiero.md
-- Ejecutar completo en el SQL Editor de Supabase (un solo usuario vía auth.uid())
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
  currency text not null default 'COP',        -- moneda nativa de la cuenta (COP o USD)
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

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
  updated_at timestamptz not null default now()
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
  unique (user_id, account_id, year, month)
);

-- Historial de transferencias entre cuentas (madre->hija, hija->hija, ajustes)
create table account_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  from_account_id uuid references accounts(id),
  to_account_id uuid references accounts(id),
  amount numeric not null,
  currency text not null default 'COP',
  transfer_date date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 4. CATÁLOGO DE CATEGORÍAS (editable; valores iniciales = tabla del prompt)
-- ----------------------------------------------------------------------------
create table categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  name text not null,
  emoji text,
  is_ambiguous boolean not null default true,   -- false = 100% inequívoca (ej. Suscripciones)
  monthly_budget numeric,                        -- tope mensual editable, mismo monto todos los meses hasta que se cambie (null = sin presupuesto definido)
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
  origin text not null default 'csv_import' check (origin in ('csv_import', 'manual')),
  created_at timestamptz not null default now(),
  unique (user_id, monia_id)
);

create index idx_transactions_date on transactions (user_id, occurred_at);
create index idx_transactions_pending on transactions (user_id) where account_id is null;
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
  created_at timestamptz not null default now()
);

create table debt_installments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  debt_id uuid not null references debts(id),
  due_date date not null,
  amount numeric not null,
  paid boolean not null default false,
  paid_at timestamptz
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
  created_at timestamptz not null default now()
);

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
    'fixed_expenses', 'fixed_expense_month_status', 'debts', 'debt_installments',
    'savings_goals', 'savings_contributions'
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
-- Catálogo inicial de categorías (tomado de la tabla de mapeo del prompt)
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
