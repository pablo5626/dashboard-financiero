# Comparación con apps de finanzas populares: qué nos falta

Estado: **investigación terminada (22-sep-2026), sin implementar.** Este documento compara la
app contra las funciones que hacen populares a las apps de finanzas líderes (YNAB, Monarch
Money, Copilot, Rocket Money, Goodbudget, más el panorama colombiano/latinoamericano) y lista los
gaps reales, priorizados. No se tocó ningún archivo de código ni `CLAUDE.md`.

## Qué hace popular a las apps líderes

1. **Sincronización bancaria automática (sin CSV ni tipeo).** Es la razón número uno por la que
   la gente deja de usar una hoja de cálculo. YNAB, Monarch, Copilot y Rocket Money conectan
   directo a los bancos (vía agregadores como Plaid) y los movimientos aparecen solos.
2. **Presupuesto zero-based / por sobres, con reglas claras.** YNAB popularizó "cada peso tiene
   un trabajo" (zero-based budgeting); Goodbudget hace lo mismo con sobres virtuales. La
   disciplina del método, no solo el registro, es lo que fideliza a los usuarios de YNAB.
3. **Vista compartida / familiar con un solo login por hogar.** Monarch es hoy la app de
   referencia para parejas y familias: un solo plan cubre el hogar, cada persona tiene su login,
   y hay un dashboard compartido de gasto, metas y patrimonio, con privacidad selectiva sobre
   compras individuales.
4. **Seguimiento y cancelación de suscripciones + negociación de facturas.** Es la marca
   registrada de Rocket Money: detecta cargos recurrentes en el historial bancario, permite
   cancelarlos con un par de toques, y ofrece negociar facturas de cable/celular/seguro a cambio
   de un % de lo ahorrado.
5. **Categorización automática por IA y una interfaz muy pulida.** Copilot se destaca
   específicamente por esto — la IA que categoriza sola es "la mejor de la categoría" según las
   reseñas, y el diseño visual es señalado como razón de compra en sí misma.
6. **Puntaje/salud crediticia integrada.** Fintonic (España/LatAm) y Rocket Money muestran el
   FICO Score o un puntaje de salud financiera propio dentro de la misma app, sin salir a
   consultarlo aparte.
7. **Insights y nudges automáticos.** Alertas de comisiones bancarias, cargos duplicados o
   fraude (Fintonic); resúmenes tipo "gastaste X% más este mes" generados por IA que se adaptan a
   los hábitos del usuario, no solo al presupuesto fijo.
8. **Gamificación: rachas, logros, "Wrapped".** En 2026 es una tendencia medible, no cosmética —
   reportes de la industria hablan de +20-22% en tasa de ahorro y +25% en participación cuando la
   app usa rachas diarias, logros y recaps tipo "tu año en números" (Cleo, Qapital, Acorns).

## Tabla comparativa

| Función | Quién la popularizó | ¿La tenemos? | Notas |
|---|---|---|---|
| Sync bancario automático | YNAB, Monarch, Copilot, Rocket Money | **No** | Hoy es CSV de MonIA + captura manual/voz/foto. Es el gap más grande frente a las líderes (ver más abajo). |
| Zero-based / presupuesto por categoría con alerta de umbral | YNAB | **Parcial** | Tenemos `monthly_budget` por categoría con alertas configurables (`user_settings`), pero no la disciplina "asignar cada peso" de YNAB — el reparto real es madre→hijas, no categoría por categoría. |
| Vista compartida / familiar, un login por hogar | Monarch Money | **No** | La app es single-tenant por diseño: RLS aísla por `user_id`, sin ningún concepto de "hogar" ni logins vinculados. |
| Seguimiento de suscripciones + cancelación + negociación de facturas | Rocket Money | **Parcial** | El detector de "candidatos a gasto fijo" (`GastosDiarios.jsx`) encuentra gastos repetidos y los convierte en `fixed_expenses`, pero no detecta *aumentos* de precio, no cancela nada (no hay integración con el proveedor) ni negocia facturas — eso requeriría datos que la app no tiene motivo para pedir. |
| Categorización automática por IA | Copilot | **Parcial/Sí** | El motor de asignación de cuenta es reglas explícitas (no IA), pero la sugerencia de categoría/tag por descripción (`suggestCategoryForPurpose`) y la captura por voz/foto con Gemini sí usan IA — de hecho vamos más allá que Copilot en el punto de captura (voz y foto de recibo/notificación), no solo en categorizar lo ya importado. |
| Puntaje / salud crediticia | Fintonic, Rocket Money | **No** | No hay ninguna noción de score — tendría sentido solo si se conecta a un buró de crédito real, que no aplica bien en Colombia sin un proveedor local. |
| Alertas de comisiones/cargos duplicados/fraude | Fintonic | **Parcial** | Hay alertas de presupuesto excedido y de anomalía de categoría (gasto 1.5× el promedio), pero no hay detección específica de comisión bancaria o cargo duplicado — sería difícil sin sync bancario real. |
| Insights automáticos tipo "gastaste X% más" | Apps con IA (Cleo, Copilot, Richify) | **Parcial** | La alerta `anomalia_categoria` ya hace justo esto por categoría (1.5× el promedio de 6 meses), pero no hay un resumen narrativo mensual ni comparaciones más amplias (por comercio, por tag). |
| Gamificación (rachas, logros, recap anual) | Cleo, Qapital, Acorns, YNAB | **No** | No existe ningún mecanismo de racha/logro. Es la categoría de función más ajena al espíritu actual de la app (que es deliberadamente "sin inventar datos, sin alarmismo"), pero el dato para un recap anual simple (Panel ya calcula tendencias de 6-12 meses) ya está disponible. |
| Ahorro por redondeo ("round-up") | Acorns, Qapital | **No** | No hay ningún mecanismo de redondeo automático de compras hacia una meta. |
| Registro por voz / IA conversacional | Cleo (chat), Copilot (parcial) | **Sí, y más completo** | Captura por voz con transcripción en vivo + IA, escaneo de recibos/notificaciones con Gemini, y (investigado, sin implementar aún) un bot de WhatsApp — la mayoría de las apps líderes no llegan a este nivel de captura conversacional. |
| Multi-moneda con cuentas reales en varias monedas | Apps de trading/wallets, no las de presupuesto genéricas | **Sí, y mejor que la mayoría** | YNAB/Monarch/Copilot asumen mayormente una sola moneda por cuenta; nuestro modelo de "pockets" (una cuenta con varias monedas reales, cada una con su propio saldo) es más flexible que lo que ofrecen estas apps de EE. UU. |

## Lo que ya tenemos y es competitivo

- **Motor de asignación bancaria por reglas explícitas, sin categorías fijas ni "caja negra".**
  A diferencia de la categorización por IA de Copilot (que a veces se equivoca y hay que
  corregir sin saber por qué), nuestro motor es transparente: tag → historial de categoría → cola
  manual, sin un cuarto nivel probabilístico a propósito.
- **Multi-moneda real con "pockets" por cuenta** (COP/USD/EUR, varias monedas en una sola cuenta
  tipo `arq`) — ninguna de las apps líderes investigadas ofrece este nivel de granularidad para
  quien maneja varias monedas dentro de la misma cuenta bancaria.
- **Captura conversacional (voz + foto + notificaciones bancarias) ya en producción**, con un
  bot de WhatsApp investigado y listo para implementar — más cerca de "hablarle a la plata" que
  la mayoría de las apps de EE. UU., que solo ofrecen categorización automática sobre datos ya
  sincronizados, no captura activa.
- **Ritual mensual madre→hijas + presupuesto por cuenta y por categoría a la vez**, algo que ni
  YNAB (una sola jerarquía de categorías) ni Monarch modelan explícitamente — encaja con el hábito
  colombiano de repartir la plata entre varias cuentas/bancos digitales (Nequi, Dale, Rappi...) en
  vez de tener una sola cuenta con "sobres" internos.
- **Shortcuts de iOS + PWA/APK Android sin fricción de instalación** (no requiere una app nativa
  separada de la web) — cubre el "registro rápido" que Rocket Money/YNAB resuelven con widgets
  nativos, con una superficie de mantenimiento mucho menor (un solo código para web y Android).

## Gaps reales, priorizados

1. **Sync bancario automático — el gap más grande, pero de alto riesgo/dudoso en Colombia hoy.**
   Es la función que más fideliza en las apps líderes. Existe cierta cobertura de agregadores
   tipo Plaid para Bancolombia (el banco más grande del país), pero **no hay evidencia de
   cobertura para las cuentas reales que usa esta app** (Nequi, Dale, Rappi, Pibank, Nubank son
   billeteras/neobancos, no bancos tradicionales con API abierta madura) — habría que confirmarlo
   banco por banco antes de prometer nada, y el costo de un agregador es mensual por cuenta
   conectada. El flujo actual (CSV de MonIA + captura por voz/foto/WhatsApp) ya cubre gran parte
   de la fricción que este sync resolvería en otros países. Largo plazo, no una tarea concreta.
2. **Insights narrativos mensuales.** Ya existe el dato (tendencia de 6 meses, anomalía de
   categoría) — falta una vista tipo "resumen del mes" que lo redacte en una frase en vez de solo
   mostrar el número en el gráfico. Esfuerzo bajo, reutiliza `panelApi.fetchMonthlyTrend` y
   `fetchAlerts`, posible candidato para una llamada de IA corta (mismo patrón que `voice-parse`).
3. **Vista compartida/familiar.** Hoy la app es estrictamente single-tenant (RLS por `user_id`,
   sin ningún concepto de "hogar"). Es un cambio de modelo de datos no trivial (tabla de
   miembros de hogar, políticas RLS nuevas, decisión de qué se comparte y qué queda privado) —
   alto esfuerzo, solo tiene sentido si el uso deja de ser un solo dueño.
4. **Seguimiento de aumento de precio en gastos fijos.** El detector de "candidatos a gasto fijo"
   ya existe; comparar el monto de una recurrencia mes a mes para avisar "tu Netflix subió de
   $X a $Y" es una extensión chica sobre datos que ya se calculan, esfuerzo bajo-medio.
5. **Notificaciones push nativas (fuera de la app).** Hoy las alertas solo se ven al abrir el
   Panel. Como TWA/PWA, push real requiere Service Worker + Web Push (o FCM en el APK) — factible,
   pero es infraestructura nueva (suscripción del navegador, envío desde una Edge Function o cron)
   que hoy no existe en absoluto.
6. **Ahorro por redondeo.** Fácil de calcular (diferencia entre el monto real y el redondeo hacia
   arriba), pero solo tiene sentido combinado con una transferencia automática a una meta — sin
   sync bancario real, sería solo un número simbólico, no un movimiento real de plata. Esfuerzo
   bajo, valor cuestionable en este contexto.
7. **Gamificación (rachas, logros).** Es lo más alejado del tono actual de la app ("nunca
   inventar datos, nunca alarmar sin motivo"), pero el dato para algo simple (racha de días con al
   menos un movimiento registrado, o un recap anual como el que ya casi arma `PanelGeneral.jsx`
   con su comparativa año a año) ya existe. Bajo esfuerzo si se limita a algo discreto, sin
   convertir la app en un juego.
8. **Puntaje de salud crediticia.** No aplica bien sin datos de un buró de crédito real
   colombiano (Datacrédito/CIFIN) al que la app no tiene ni debería pedir acceso hoy — descartado
   por ahora, no por esfuerzo sino porque no hay una fuente de datos confiable a la mano.

## Fuentes

- [Budgeting Apps Comparison 2026 — Ramsey](https://www.ramseysolutions.com/budgeting/budgeting-apps-comparison) ·
  [NerdWallet: Best Budget Apps for 2026](https://www.nerdwallet.com/finance/learn/best-budget-apps) ·
  [Monarch vs YNAB](https://www.monarch.com/compare/ynab-alternative)
- [Rocket Money review — The Motley Fool](https://www.fool.com/money/personal-finance/rocket-money-review/) ·
  [Best Subscription Management Apps — Rocket Money](https://www.rocketmoney.com/learn/personal-finance/best-subscription-management-apps) ·
  [Rocket Money review — CNBC Select](https://www.cnbc.com/select/rocket-money-review/)
- [Best Family Budgeting Apps 2026 — WalletHub](https://wallethub.com/answers/b/family-budget-app-2140884553/) ·
  [Best Family Budgeting Apps — BudgetLabs](https://www.budgetlabs.io/blog/best-budgeting-app-for-families) ·
  [Envelope Budgeting Apps 2026 — Plan & Multiply](https://www.planandmultiply.com/en/blog/envelope-budgeting-2026-digital-evolution)
- [Fintonic — quiénes somos](https://www.fintonic.com/es-ES/quienes-somos/) ·
  [DolarApp — Colombia Fintech](https://colombiafintech.co/miembros/dolarapp/) ·
  [Ualá — Wikipedia](https://en.wikipedia.org/wiki/Ual%C3%A1)
- [Open Banking in Colombia — Open Banking Tracker](https://www.openbankingtracker.com/country/colombia) ·
  [Bancolombia — Open Banking Tracker](https://www.openbankingtracker.com/provider/bancolombia)
- [Gamification for Personal-Finance Apps — Trophy](https://trophy.so/blog/gamification-for-personal-finance-apps) ·
  [Gamification in fintech — 11:FS](https://www.11fs.com/article/gamification-in-fintech-financial-literacy-or-just-engagement)
