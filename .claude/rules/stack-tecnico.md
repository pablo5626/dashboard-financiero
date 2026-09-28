# Stack técnico

- **Vite + React 18**, JSX plano — **sin TypeScript**. Es un proyecto
  personal de un solo desarrollador; se prioriza velocidad de iteración sobre
  tipado estático. No introducir TS a mitad de camino sin que el usuario lo
  pida.
- **CSS plano con custom properties** (`src/index.css` para tokens globales +
  CSS Modules por componente), **no Tailwind**. Los tokens de color,
  tipografía y espaciado ya cubren lo que Tailwind aportaría; añadir Tailwind
  sería una dependencia redundante para este proyecto.
- **React Router** (`react-router-dom`) para las 6 secciones principales
  (`/`, `/diario`, `/cuentas`, `/gastos`, `/deudas`, `/metas`), navegación
  por URL real (no un simple `useState` de tab activo).
- **Recharts** para gráficos, **`@supabase/supabase-js`** como cliente de
  datos, **`date-fns`** para fechas, **`papaparse`** para parsear el CSV de
  MonIA en el navegador al importar.
- **`src/lib/supabaseClient.js`** es el único punto de creación del cliente
  de Supabase — no instanciar `createClient` en otros archivos.
- Estructura de carpetas: `src/pages/` (una por sección), `src/components/ui/`
  (piezas genéricas: Card, ConfirmDialog, ColorSwatchPicker, FormKit — el
  vocabulario de formularios de edición/alta: campos, píldoras, switch, hoja modal), `src/components/layout/`
  (AppShell, navegación), `src/components/` a nivel raíz (`QuickCaptureFAB.jsx`,
  `SettingsPanel.jsx`, `SearchPanel.jsx`, `CategoryEmojiGrid.jsx`,
  `AccountAutocomplete.jsx`, `OnboardingCard.jsx` (guía "Empieza aquí" de
  Panel para un usuario vacío), `icons.jsx` — componentes globales que no
  pertenecen a una sola página, varios de ellos montados una sola vez en
  `AppShell.jsx` y controlados por su propio `open`/estado, no por rutas),
  `src/lib/` (cliente Supabase, formato, un módulo `*Api.js` por dominio de
  datos, más módulos chicos sin dependencias para lógica compartida que no
  encaja en un dominio — `currencyPockets.js` para las claves de bolsillo
  multi-moneda, `chartUtils.js` para el cálculo de ancho de eje de los
  gráficos horizontales, ver `.claude/rules/diseno-ui.md`;
  `balanceAnchors.js` para resolver el ancla de saldo compartida por
  `fetchBalancesForMonth` y `fetchMonthlyTrend`, ver "Money math" en
  `CLAUDE.md`; `userSettingsApi.js` para los ajustes globales de
  `user_settings`; `passwordCheck.js` para revisar contraseñas filtradas al
  registrarse; `functionErrors.js` para mostrar el mensaje real de una Edge
  Function que respondió con error).
- **Edge Functions** (`supabase/functions/`, Deno): cada función en su carpeta y
  el código común en `_shared/` (`auth.ts`: `requireUser`, `withCors`,
  `timingSafeEqual`; `quota.ts`: tope diario de IA; `input.ts`: saneo de listas de
  nombres). Sin Docker ni Deno local: se despliegan con `npx supabase functions
  deploy`, así que no hay chequeo de tipos antes de desplegar — probar con `curl`
  después (ver `multiusuario-despliegue.md`).
- **`vite.config.js`** inyecta una Content-Security-Policy (`<meta>`) solo en el
  build; cualquier host externo nuevo que el navegador deba llamar hay que
  agregarlo a `connect-src` ahí o la petición queda bloqueada.
- No queda ningún dato de muestra en el proyecto — `src/lib/sampleData.js`
  se eliminó una vez que las secciones quedaron conectadas a Supabase (ver
  `CLAUDE.md`). Si algún día se agrega una sección nueva antes de tener su
  tabla lista, sus datos de ejemplo van en un archivo dedicado bajo
  `src/lib/`, nunca hardcodeados dentro de un componente de página.
- **CSS Modules por página solo para lo que lo necesita**: `Cuentas`, `Deudas`,
  `MetasAhorro` y `FixedExpensesSection` tienen su propio `.module.css`, pero
  únicamente para su UI de edición (encabezado tocable, filas, hoja); el resto
  de esas páginas conserva estilos en línea. Una pantalla nueva con UI propia
  de edición va con su `.module.css`, no con más estilos en línea.
