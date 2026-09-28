# Seguridad y variables de entorno

- `.env.local` guarda las credenciales reales de Supabase
  (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) y está en `.gitignore` — no
  se commitea nunca.
- `.env.example` es una plantilla pública con **placeholders genéricos**
  (`https://xxxxx.supabase.co`, `tu-anon-key-aqui`). Nunca debe contener
  valores reales del proyecto, aunque la anon key esté protegida por RLS —
  ya pasó una vez que se sobreescribió con las credenciales reales por error;
  revisar este archivo antes de cualquier commit.
- La seguridad real de los datos la da **RLS** (`user_id = auth.uid()` en
  cada tabla, ver `esquema-datos.md`), no el secreto de la anon key — así que
  el foco de seguridad está en no romper esas políticas, más que en tratar la
  anon key como un secreto absoluto.
- Cambios en `.env.local` requieren reiniciar `npm run dev` — Vite no
  recarga variables de entorno en caliente.

## Multiusuario: qué se protege y cómo

- La app tiene registro abierto: **RLS es el único aislamiento entre personas**
  (se verificó en vivo que las 18 tablas devuelven `[]` con solo la anon key y que
  una escritura anónima se rechaza). No confiar en filtros del cliente
  (`.eq('user_id', ...)`) ni en ocultar cosas en la UI: la seguridad está en las
  políticas. `ai_usage` es la excepción deliberada (solo `select`; se escribe vía
  `consume_ai_quota`), ver `esquema-datos.md`.
- **Secrets**: `GEMINI_API_KEY` y `RATES_CRON_SECRET` viven solo en Supabase (y el
  segundo también en GitHub Actions). La service role key solo la usa
  `rates-auto-update` (cron) y nunca debe llegar al cliente ni a `.env.local`
  (que solo tiene `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`).
- **Edge Functions**: las que llama el navegador (`voice-parse`, `receipt-parse`,
  `money-ask`) validan al usuario con `requireUser` (la anon key sola devuelve
  401), aplican el tope diario de IA y responden CORS solo a los orígenes
  permitidos (`withCors`; `ALLOWED_ORIGINS` para agregar más). Los errores
  internos y del proveedor de IA se registran en el servidor y al cliente le
  llega un mensaje genérico. `receipt-parse` valida la firma real del archivo.
- **`auto-capture`** (captura automática desde el teléfono, ver
  `captura-automatica.md`) es la excepción: `verify_jwt = false`, porque el
  teléfono no tiene sesión. La autenticación es un token personal (`cap_` + 256
  bits), del que se guarda solo el sha256 y que se revoca borrándolo desde
  Ajustes. Lo valida la RPC `ingest_auto_capture` (`security definer`,
  ejecutable solo por `anon`), que escribe únicamente en el usuario dueño del
  token y tiene un tope de 200 capturas por día. No usa la service role.
- **Nunca versionar** `Finanzas - Google Play package.zip` ni ningún
  `signing.keystore`: es la llave de firma del APK.
- **Frontend**: CSP inyectada en el build (`vite.config.js`); la sesión de
  Supabase vive en `localStorage`, por eso no debe existir
  `dangerouslySetInnerHTML`/`innerHTML` ni cargarse scripts de terceros. Al
  registrarse o cambiar la contraseña se consulta Have I Been Pwned por
  k-anonimato (`passwordCheck.js`).
- **Repo público**: revisar el diff antes de cada push (no hay secretos
  versionados; el project-ref y el nombre del repo no lo son). `other recursos/` y
  `posible/` están sin versionar y sin ignorar: no usar `git add .`.
- Revisión periódica: `npm audit` (hoy solo marca vite/esbuild y react-router,
  ver "Known deferred scope" en `CLAUDE.md`).
