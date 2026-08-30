# Diseño UI y visualización de datos

## Layout responsive (inspirado en iOS HIG — skill `ios-hig-design`)

- **Móvil (< 768px)**: tab bar inferior con los 5 destinos principales
  (Panel, Cuentas, Gastos, Deudas, Metas), navegación apilada.
- **Tablet/desktop (≥ 768px)**: sidebar fija en vez de tab bar, mayor
  densidad de información por vista.
- Respetar `env(safe-area-inset-*)` (notch, home indicator), touch targets
  mínimos de 44px, escala tipográfica semántica (Large Title / Title /
  Headline / Body / Caption definida como custom properties en
  `src/index.css`), nunca tamaños de fuente sueltos hardcodeados en un
  componente.
- Sin hamburger menu — la navegación siempre es tab bar o sidebar visibles.
- La skill es para iOS nativo (SwiftUI/UIKit); acá solo se traducen sus
  *principios* de layout, tipografía, color/Dark Mode y navegación a
  CSS/React — sus referencias de widgets, extensions, Siri/Shortcuts o
  app-icons no aplican a esta web app.

## Paleta y forma de los gráficos (skill `dataviz`)

- Los tokens de color están en `src/index.css` (`--series-1`…`--series-8`,
  `--status-good/warning/serious/critical`, tokens de superficie/tinta) y
  siguen la paleta validada por `scripts/validate_palette.js` de la skill —
  **no inventar hex nuevos** para series o estados sin revalidar.
- Colores categóricos siempre en el **orden fijo** de los slots (1=azul,
  2=naranja, 3=aqua...), nunca ciclados ni reordenados por conveniencia.
- **Parte-todo → barra horizontal, nunca dona/pie** (ej. "Distribución por
  cuenta" en el Panel general ya sigue esta regla).
- Tendencia en el tiempo → línea; una sola serie usa el hue secuencial
  (azul); 2–3 series usan slots categóricos consecutivos con leyenda.
- Un eje siempre — nunca un gráfico de doble eje Y.
- Todo color de gráfico se pasa como `var(--series-N)` / `var(--status-*)`,
  nunca como hex literal en un componente de página, para que el modo oscuro
  (`prefers-color-scheme` + `[data-theme]`) siga funcionando automáticamente.
