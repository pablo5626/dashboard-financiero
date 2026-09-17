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
  (piezas genéricas: Card, ConfirmDialog, ColorSwatchPicker), `src/components/layout/`
  (AppShell, navegación), `src/components/` a nivel raíz (`QuickCaptureFAB.jsx`,
  `SettingsPanel.jsx`, `SearchPanel.jsx`, `CategoryEmojiGrid.jsx`,
  `AccountAutocomplete.jsx`, `icons.jsx` — componentes globales que no
  pertenecen a una sola página, varios de ellos montados una sola vez en
  `AppShell.jsx` y controlados por su propio `open`/estado, no por rutas),
  `src/lib/` (cliente Supabase, formato, un módulo `*Api.js` por dominio de
  datos).
- No queda ningún dato de muestra en el proyecto — `src/lib/sampleData.js`
  se eliminó una vez que las secciones quedaron conectadas a Supabase (ver
  `CLAUDE.md`). Si algún día se agrega una sección nueva antes de tener su
  tabla lista, sus datos de ejemplo van en un archivo dedicado bajo
  `src/lib/`, nunca hardcodeados dentro de un componente de página.
