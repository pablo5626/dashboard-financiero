# Vaciar los datos de una cuenta en Supabase (empezar de 0 sin perder el login)

Este script borra **todo el contenido** de una cuenta elegida (cuentas bancarias, categorías,
transacciones, deudas, metas, gastos fijos, transferencias, tags, ajustes, tasas de cambio,
etiquetas de estadísticas...) para que quede como una cuenta recién registrada, **sin borrar el
usuario de `auth.users`** — la persona sigue pudiendo iniciar sesión con el mismo correo y
contraseña, solo que ve la app completamente vacía (el `OnboardingCard.jsx` de "Empieza aquí"
vuelve a aparecer solo, porque se deduce de los datos, no de una bandera).

No toca la estructura ni las políticas RLS (`schema.sql` queda igual), no toca los secrets de
Edge Functions, y no afecta a otras cuentas — está filtrado por `user_id` en cada `delete`.

⚠️ **Es irreversible.** Correrlo borra los datos para siempre; no hay respaldo automático. Si hay
alguna duda de si es la cuenta correcta, confirmar el correo antes de ejecutar.

## Cómo usarlo

1. Abrir el proyecto en Supabase → **SQL Editor**.
2. Pegar el bloque de abajo y reemplazar `CORREO_DE_LA_CUENTA` por el email real de la cuenta a
   vaciar (el **propio**, si es a esa a la que se le quiere borrar todo, u otra cuenta de prueba —
   el script no distingue, solo actúa sobre el correo que se ponga).
3. Ejecutar. Si el correo no corresponde a exactamente un usuario, el script no borra nada y
   avisa con un error (`No hay exactamente un usuario con ese correo`).

```sql
do $$
declare
  v_email text := 'CORREO_DE_LA_CUENTA';
  v_uid uuid;
begin
  if (select count(*) from auth.users where email = v_email) <> 1 then
    raise exception 'No hay exactamente un usuario con ese correo: %', v_email;
  end if;
  select id into v_uid from auth.users where email = v_email;

  delete from savings_contributions where user_id = v_uid;
  delete from savings_goals where user_id = v_uid;
  delete from debt_installments where user_id = v_uid;
  delete from debts where user_id = v_uid;
  delete from fixed_expense_month_status where user_id = v_uid;
  delete from fixed_expenses where user_id = v_uid;
  delete from category_account_stats where user_id = v_uid;
  delete from purpose_category_stats where user_id = v_uid;
  delete from transactions where user_id = v_uid;
  delete from account_transfers where user_id = v_uid;
  delete from monthly_initial_balances where user_id = v_uid;
  delete from account_allocations where user_id = v_uid;
  delete from account_currencies where user_id = v_uid;
  delete from accounts where user_id = v_uid;
  delete from categories where user_id = v_uid;
  delete from tags where user_id = v_uid;
  delete from user_settings where user_id = v_uid;
  delete from exchange_rates where user_id = v_uid;
  delete from ai_usage where user_id = v_uid;
  -- Nota: NO se borra de auth.users — el login de esta cuenta se mantiene intacto.
end $$;
```

El orden respeta las claves foráneas (hijas antes que padres) — es el mismo orden que ya usa el
script de limpieza de cuentas de prueba en
`.claude/rules/multiusuario-despliegue.md`, solo que ese además borra `auth.users` al final y
este lo deja afuera a propósito.

**Si se agrega una tabla nueva con `user_id` al esquema, agregarla también acá** (y al script de
limpieza de `multiusuario-despliegue.md`), o esa tabla quedaría con datos huérfanos de una cuenta
que se supone vacía.

## Qué NO borra este script

- El usuario en `auth.users` (email, contraseña, sesión) — sigue existiendo.
- La estructura de las tablas, las políticas RLS, las funciones (`consume_ai_quota`,
  `rates-auto-update`, etc.) y los secrets de Edge Functions (`GEMINI_API_KEY`,
  `RATES_CRON_SECRET`, `GEMINI_MODEL`...).
- Los datos de **otras** cuentas — solo actúa sobre el `user_id` resuelto del correo que se puso.

Si en cambio se quiere borrar la cuenta por completo (login incluido), usar el script existente
en `.claude/rules/multiusuario-despliegue.md` ("Probar con una cuenta de prueba y borrarla"), que
es igual a este pero termina con `delete from auth.users where id = v_uid;`.
