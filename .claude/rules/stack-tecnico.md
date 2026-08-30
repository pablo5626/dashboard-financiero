# Stack técnico

- **Vite + React 18**, JSX plano — **sin TypeScript**. Es un proyecto
  personal de un solo desarrollador; se prioriza velocidad de iteración sobre
  tipado estático. No introducir TS a mitad de camino sin que el usuario lo
  pida.
- **CSS plano con custom properties** (`src/index.css` para tokens globales +
  CSS Modules por componente), **no Tailwind**. Los tokens de color,
  tipografía y espaciado ya cubren lo que Tailwind aportaría; añadir Tailwind
  sería una dependencia redundante para este proyecto.
- **React Router** (`react-router-dom`) para las 5 secciones principales
  (`/`, `/cuentas`, `/gastos`, `/deudas`, `/metas`), navegación por URL real
  (no un simple `useState` de tab activo).
- **Recharts** para gráficos, **`@supabase/supabase-js`** como cliente de
  datos, **`date-fns`** para fechas, **`papaparse`** para parsear el CSV de
  MonIA en el navegador al importar.
- **`src/lib/supabaseClient.js`** es el único punto de creación del cliente
  de Supabase — no instanciar `createClient` en otros archivos.
- Estructura de carpetas: `src/pages/` (una por sección), `src/components/ui/`
  (piezas genéricas: Card, StatTile), `src/components/layout/` (AppShell,
  navegación), `src/lib/` (cliente Supabase, formato, datos de ejemplo).
- Mientras una sección no esté conectada a Supabase, sus datos de ejemplo
  viven en `src/lib/sampleData.js` — no hardcodear datos de muestra dentro de
  los componentes de página.
