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
