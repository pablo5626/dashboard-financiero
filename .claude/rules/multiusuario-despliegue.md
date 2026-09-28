# Multiusuario, despliegue y distribución como APK

Procedimientos operativos que no se deducen del código. El modelo de datos
multiusuario está en `esquema-datos.md`, el detalle de seguridad en
`seguridad-entorno.md` y el resumen de arquitectura en `CLAUDE.md`
("Multi-user model", "Security posture").

## Estado a 20 de septiembre de 2026

- Sitio publicado: `https://pablo5626.github.io/dashboard-financiero/` (rama
  `master` del repo público `pablo5626/dashboard-financiero`, workflow "Deploy a
  GitHub Pages", ~35 s).
- Supabase: proyecto `qxiqqozogggfynkanevt` (`my_dashboard`, plan free).
- Registro abierto y confirmación de correo **activada** (verificado en
  `/auth/v1/settings`: `disable_signup=false`, `mailer_autoconfirm=false`, solo
  el proveedor `email`). No desactivar la confirmación aunque simplifique el APK.
- Edge Functions desplegadas con el código nuevo: `voice-parse`, `receipt-parse`,
  `money-ask`, `rates-auto-update`.
- **Captura automática** (`auto-capture`, ver `captura-automatica.md`): el código
  está en el repo, pero hay que correr en vivo el SQL de `capture_tokens`,
  `auto_captures`, las dos RPCs y el `check` ampliado de `transactions.origin`, y
  luego desplegar la función (`npx supabase functions deploy auto-capture
  --project-ref qxiqqozogggfynkanevt`; `verify_jwt = false` sale de
  `config.toml`).
- **`quick-capture` sigue desplegada en su versión anterior** (secreto compartido
  `x-quick-capture-secret` y dueño fijo `QUICK_CAPTURE_USER_ID`). El código del
  repo ya es el nuevo (JWT del propio usuario, ver `shortcuts-ios.md`), pero no
  se despliega hasta que el dueño actualice sus Shortcuts de iOS, porque el
  cambio los rompe. Hasta entonces **no borrar** los secrets
  `QUICK_CAPTURE_SECRET` ni `QUICK_CAPTURE_USER_ID`.
- SQL vivo aplicado: tabla `ai_usage` y función `consume_ai_quota` (`security
  definer`; llamada como anónimo devuelve `permission denied`). Comprobar con
  `select policyname from pg_policies where tablename = 'ai_usage';` que solo
  quede `select_own`.

## Orden para desplegar un cambio

1. **SQL** (solo si cambió el esquema): snippet único en el SQL Editor, además de
   editar `schema.sql` (ver `esquema-datos.md`).
2. **Edge Functions**: `npx supabase functions deploy <funciones> --project-ref
   qxiqqozogggfynkanevt`. La carpeta `supabase/functions/_shared/` se empaqueta
   sola; no hace falta Docker. Redesplegar todas las que importen algo de
   `_shared` cuando ese helper cambie.
3. **Frontend**: `git push origin master`. El build necesita los secrets del repo
   `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`; la CSP toma de la primera el
   origen permitido en `connect-src`.

Secrets de Supabase en uso: `GEMINI_API_KEY`, `RATES_CRON_SECRET` y, opcional,
`ALLOWED_ORIGINS` (orígenes extra para CORS, separados por comas) y
`GEMINI_MODEL` (modelo de Gemini; por defecto `gemini-3.6-flash`, ver
`_shared/gemini.ts`. `gemini-2.5-flash` devuelve 404 a las keys nuevas. Cambiarlo
es `npx supabase secrets set GEMINI_MODEL=... --project-ref qxiqqozogggfynkanevt`,
sin redesplegar). Secrets de
GitHub Actions: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `RATES_CRON_SECRET`.
Nunca pegar en el chat una contraseña de aplicación, un keystore ni una key.

## Correo de Auth (SMTP propio)

El correo por defecto de Supabase permite muy pocos mensajes por hora en todo el
proyecto; con registro abierto y confirmación activada hace falta SMTP propio
(Authentication → Emails → SMTP Settings). Con Gmail: verificación en dos pasos,
contraseña de aplicación, host `smtp.gmail.com`, puerto `465`.

**Error real que ya pasó**: la app mostraba "Error sending confirmation email"
porque el campo **Username** tenía el nombre del remitente ("Dashboard
Financiero") en vez del correo completo de Gmail; Google respondía `535 5.7.8
Username and Password not accepted`. Cómo diagnosticarlo sin adivinar:
Supabase → Logs → Auth, buscar `signup`, abrir la fila con ERROR y leer el campo
`error`. Un registro que falla al enviar el correo no deja usuario creado. El
panel no muestra la contraseña SMTP después de guardar: hay que volver a
escribirla en cada guardado.

Otros ajustes del panel (no están en el repo): largo mínimo de contraseña (8 o
más), Site URL y Redirect URLs con la URL de GitHub Pages y `http://localhost:5173/**`.
CAPTCHA: diferido a propósito, porque exige un widget en la app y mandar el token
en `signUp`/`signIn`/reset; hoy lo cubren la confirmación por correo y el tope
diario de IA.

## Probar con una cuenta de prueba y borrarla

Para registrar una cuenta de prueba sin otro correo, usar un alias del propio
Gmail (`tucorreo+prueba1@gmail.com`): Supabase lo cuenta como usuario distinto y
el correo llega a la misma bandeja.

Las tablas no tienen `ON DELETE CASCADE`, así que borrar al usuario desde el
panel de Authentication falla mientras existan filas suyas. Script de limpieza
(SQL Editor, una sola transacción; **poner el correo de la cuenta de prueba, no
el propio**: el SQL Editor no aplica RLS y solo el filtro por `user_id` protege
los datos ajenos):

```sql
do $$
declare
  v_email text := 'CORREO_DE_PRUEBA';
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
  delete from auto_captures where user_id = v_uid;
  delete from capture_tokens where user_id = v_uid;
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
  delete from auth.users where id = v_uid;
end $$;
```

El orden respeta las claves foráneas (hijas antes que padres). **Si se agrega una
tabla con `user_id`, agregarla acá.** Usuario de prueba pendiente de borrar a
20 de septiembre de 2026: `jp9867415@gmail.com`.

## APK para Android (Trusted Web Activity)

**Decisión**: un TWA generado con PWABuilder, no Capacitor. El TWA abre el sitio
publicado dentro de Chrome, así que conserva todas las funciones (voz con Web
Speech API, cámara y recibos, IA) y se actualiza solo con cada `git push`; con
Capacitor el WebView de Android no trae `SpeechRecognition` y cada cambio de la
web obliga a repartir un APK nuevo. Los Shortcuts de iOS no aplican a Android
(quien use el APK usa el botón "+"), y sacrificarlos fue una decisión explícita
del dueño.

**Manifest** (`public/manifest.webmanifest`): `id` y `scope` =
`/dashboard-financiero/`; `theme_color` = `#f9f9f7` (el mismo `--page-plane`
claro de `index.css`, para que la barra de estado no sea una franja azul sobre
la app); `background_color` = `#0d366b` (pantalla de carga, combina con el
ícono, que tiene fondo azul); íconos `any` (`pwa-192/512.png`) y `maskable`
(`pwa-maskable-192/512.png`, el ícono sobre fondo `#0d366b` a sangre completa,
con el dibujo dentro de la zona segura). Cambiar `id`, `scope`, `start_url` o el
`base` de `vite.config.js` cambia la identidad de la app instalada.

**Verificación del dominio** (Digital Asset Links): Android exige
`https://pablo5626.github.io/.well-known/assetlinks.json` en la **raíz del
dominio**, que un sitio de proyecto como `/dashboard-financiero/` no puede
servir. Por eso existe el repo `pablo5626/pablo5626.github.io` (sitio de usuario,
con `.nojekyll` porque Jekyll ignora carpetas que empiezan con punto). Hoy el
archivo contiene `[]`; al tener el APK hay que poner el paquete y la huella:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.pablo5626.finanzas",
    "sha256_cert_fingerprints": ["AA:BB:...:FF"]
  }
}]
```

**Pasos** (pwabuilder.com, pegar la URL del sitio): Package For Stores → Android →
**Other Android** (da un `.apk`; no usar "Download Test Package", que se firma con
otra clave y no coincidiría con la huella) → Package ID
`com.pablo5626.finanzas`, host `pablo5626.github.io`, start URL
`/dashboard-financiero/`, display standalone, barra de estado y navegación
`#f9f9f7`, pantalla de carga `#0d366b`, signing key **Create new** → descargar el
zip. `signing-key-info.txt` trae la contraseña y la huella SHA-256; solo la huella
va al `assetlinks.json` (no es secreta).

**Guardar el zip completo, sobre todo `signing.keystore` y su contraseña**: sin
ellos no se puede publicar una actualización del APK sobre las instalaciones
existentes. Cambios en el sitio no requieren un APK nuevo; sí cambios de nombre,
ícono, colores del paquete o paquete.

**Instalación y prueba**: permitir "instalar apps desconocidas" (Play Protect
avisará); hace falta Chrome. Si la app abre a pantalla completa, la verificación
funcionó; si se ve una barra de direcciones, revisar el `assetlinks.json`
(huella, paquete, que responda 200 como JSON). Probar voz, cámara y recibo en un
teléfono real. Alternativa sin APK: "Instalar app" desde Chrome (Android/PC) o
"Añadir a pantalla de inicio" (iPhone); ambos abren sin barra.

**Estado**: PWABuilder analizó el sitio (0 errores, 2 avisos, sin bloquear).
Pendiente: generar el paquete, pasar la huella al `assetlinks.json` del repo
`pablo5626.github.io` y probar la instalación.

## Privacidad

Voz, recibos y "Pregúntale a tu dinero" mandan datos de cada usuario a Google
(Gemini) a través de las Edge Functions. Conviene avisarlo a quien use la app. El
dueño del proyecto de Supabase puede leer los datos de todos los usuarios desde el
panel. El repositorio es público y `CLAUDE.md` / `prompt-dashboard-financiero.md`
describen las cuentas y categorías personales del dueño original.
