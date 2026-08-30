# Prompt Maestro: Dashboard Financiero Personal

## 🎯 Objetivo general
Construir una **app web interactiva** (React/HTML como artifact) que funcione como panel de control financiero personal, consolidando cuentas, gastos, deudas y metas de ahorro en un único lugar, con gráficos visuales para entender el comportamiento financiero mes a mes.

## ⚙️ Tecnología y persistencia
- App web interactiva (React) como frontend.
- **Backend: Supabase** (Postgres + Auth), para que el dashboard sea **multidispositivo** (mismos datos desde el celular, el computador, etc.).
- La importación de movimientos se hace **subiendo manualmente el archivo CSV exportado de MonIA** cada vez que el usuario quiera actualizar los datos (no hay conexión automática con MonIA).
- El CSV de MonIA contiene el histórico completo cada vez que se exporta, así que la app debe **permitir filtrar/seleccionar el mes y año a importar** antes de guardar los datos en Supabase (para no reprocesar todo cada vez).
- Multi-moneda: **COP y USD**. La tasa de cambio es **manual, actualizada de vez en cuando por el usuario** (no automática ni por transacción) — se guarda como un valor editable en el sistema, similar a como lo maneja hoy en su hoja de Google Sheets.
- Todo (cuentas hijas, categorías de deuda, metas) debe ser **totalmente personalizable**: el usuario define nombres y propósitos libremente, no hay categorías fijas de fábrica más allá de unas sugeridas iniciales.

### 📄 Estructura real del CSV de MonIA
Columnas confirmadas (con ejemplo real):
```
date, purpose, amount, currency, category, emoji, creator, creator_name, tags, timezone, id
2026-03-24T14:59:00Z, "Viaje en Uber", -5474.0, COP, "Transporte", 🚌, , , "uber", "America/Bogota", "C7B10078-..."
```
- `date`: fecha/hora en UTC (ISO 8601)
- `purpose`: descripción del gasto
- `amount`: monto (negativo = gasto, posiblemente positivo = ingreso)
- `currency`: moneda de la transacción (COP, USD, etc.)
- `category`: categoría asignada en MonIA (ej. Transporte, Salida a comer, Ocio, Mekato, Suscripciones, etc. — son personalizadas por el usuario dentro de MonIA)
- `emoji`: ícono de la categoría
- `creator` / `creator_name`: quién registró el gasto (relevante si en el futuro hay más de un usuario, ej. pareja)
- `tags`: etiquetas libres separadas por `;`
- `timezone`: zona horaria
- `id`: identificador único del registro (**clave para detectar duplicados** al reimportar CSVs que se solapen en fechas)

---

## 🧩 Estructura de secciones

### 1. Panel general (resumen total)
- Balance total consolidado (suma de todas las cuentas, convertido a una moneda base)
- **Patrimonio neto**: activos totales (suma de cuentas) menos deudas totales, con su evolución mes a mes en gráfico de línea.
- Ingresos vs. gastos del mes actual, comparado con el mes anterior
- Distribución del dinero por cuenta (gráfico de torta/dona)
- Alertas rápidas: deudas próximas a vencer, metas atrasadas, categorías que superaron el presupuesto, **gastos fijos próximos a vencer**
- Tendencia de los últimos 6-12 meses (línea de ingresos, gastos y ahorro neto)
- **Tabla comparativa mes a mes**: vista tabular (no solo gráfico) con ingresos, gastos, ahorro neto y patrimonio neto por mes, para comparar rápidamente varios meses a la vez.

### 2. Cuentas (sistema de cuenta "madre" + cuentas "hijas")
- **Aclaración de modelo**: no hay dos capas separadas (banco vs. propósito) — cada cuenta hija **es directamente un banco o medio de pago real**, y ese medio ya tiene implícito su propósito (ej. la cuenta en Nequi se usa para transporte, la de Nubank para suscripciones, etc.). Así, el mapeo de categorías del CSV apunta directo a la cuenta hija real.
- **Cuenta madre**: Bold. Recibe el ingreso principal.
- **Cuentas hijas** (personalizables, punto de partida conocido): Dale, Nequi, Rappi, Nubank, Efectivo — el usuario puede agregar, renombrar o eliminar cuentas hijas libremente desde la app.
- Cada cuenta hija tiene: saldo actual, monto asignado mensual (presupuesto/tope), % usado.
- **Distribución mensual**: al inicio de cada mes el usuario define manualmente cuánto se destina de la cuenta madre a cada hija. El sistema **recuerda la distribución del mes anterior** y la propone como plantilla editable (no 100% automático, pero con memoria de patrón).
- Gráfico tipo Sankey o de flujo mostrando cómo se reparte el dinero desde la madre hacia las hijas cada mes.
- Historial de transferencias entre cuentas.
- **Gastos fijos recurrentes**: dentro de una cuenta hija tipo "gastos fijos" (o transversal a todas), se pueden registrar pagos recurrentes (arriendo, servicios, suscripciones) con: nombre, monto, día de vencimiento, y frecuencia (mensual/anual).
  - **Flujo al iniciar el mes**: cuando el usuario arma el presupuesto/distribución del nuevo mes, si la sección de gastos fijos queda vacía (nada seleccionado todavía), el sistema muestra una advertencia ("No has definido gastos fijos para este mes") y **sugiere automáticamente los gastos fijos del mes anterior** (retroalimentación con el histórico). El usuario decide, uno por uno, si los mantiene tal cual, los ajusta, o no los incluye este mes.
  - El panel general muestra una alerta cuando alguno está próximo a vencer o si ya pasó la fecha sin marcarse como pagado.

### 3. Gastos diarios (importados desde MonIA)
- Importación manual del CSV de MonIA (ver estructura real arriba). Al subir el archivo, la app permite **elegir el mes/año a importar** (o rango de fechas) desde el histórico completo del CSV.
- **Detección de duplicados** usando el campo `id` del CSV, para poder resubir el mismo archivo sin duplicar transacciones ya guardadas en Supabase.
- **Motor de asignación de cuenta (3 niveles de confianza, priorizando siempre el dato explícito sobre la especulación)**, ya que casi todas las categorías pueden repartirse entre varias cuentas/bancos según el gasto puntual:
  1. **Tag de banco/cuenta (única fuente confiable, sin especulación)**: si la transacción trae un tag reconocido como medio de pago (ej. `rappi`, `nequi`, `dale`, `nubank`, `efectivo`), se asigna esa cuenta automáticamente — este es el dato real, no una suposición.
  2. **Categoría 100% inequívoca** (muy pocas, ej. "Suscripciones" → Nubank): se asigna automático solo cuando la categoría históricamente **siempre** fue a una única cuenta.
  3. **Categoría ambigua sin tag de banco (la mayoría de los casos)**: el sistema **no asigna nada en automático** para evitar especular — la deja marcada como "pendiente de banco" y muestra las cuentas posibles según el histórico como sugerencia ordenada por frecuencia, pero requiere que el usuario confirme manualmente cuál fue. Cada confirmación se guarda para mejorar el orden de sugerencias futuras (aprendizaje incremental), aunque nunca se auto-asigna sin tag mientras la categoría siga siendo ambigua.
  - **Mapeo inicial de referencia** (guía de posibles cuentas por categoría, actualizada y a seguir ajustando dentro de la app):

| Categoría | Cuenta(s) posibles | Ambigua |
|---|---|---|
| Anita de mi corazón | Dale / Efectivo | Sí |
| Aportes | Dale / Efectivo | Sí |
| Compras | Rappi / Efectivo | Sí |
| Cuidado personal | Rappi / Efectivo | Sí |
| Deuda o cuadre | Sin cuenta (histórico de descuadres) | — |
| Donativo | Efectivo / Dale | Sí |
| Educación | Dale / Nubank | Sí |
| Medicina | Dale / Nequi / Efectivo | Sí |
| Mekato | Rappi / Efectivo | Sí |
| Mercado | Cualquiera | Sí |
| Ocio | Efectivo / Nequi / Rappi | Sí |
| Préstamo | Nequi / Efectivo | Sí |
| Regalo - festividades | Dale / Efectivo | Sí |
| Ropa | Rappi / Efectivo | Sí |
| Salida a comer | Rappi / Dale / Efectivo | Sí |
| Servicios | Dale / Nequi / Efectivo | Sí |
| Suscripciones | Nubank | No |
| Tarjeta | Nubank / Rappi | Sí |
| Transporte | Nequi / Rappi | Sí |
| Viaje | Rappi | No |

- **Detección de patrones y pagos repetitivos**: además de que el usuario defina manualmente sus gastos fijos, el sistema analiza el histórico de transacciones importadas y **sugiere candidatos a gasto fijo/recurrente** cuando detecta el mismo monto (o descripción muy similar) repitiéndose mes a mes — el usuario decide si confirmarlo como fijo o ignorarlo.
- **Análisis por tags**: además de la categoría, se desglosa el gasto usando el campo `tags` del CSV (ej. "uber", "comida", "alcohol", "parches"), permitiendo ver gasto total por etiqueta específica, no solo por categoría general.
- Comparación gasto real vs. presupuesto asignado, por categoría y por cuenta hija.
- Gráfico de gasto mensual por categoría (barras apiladas o treemap).
- Alertas cuando una categoría se dispara respecto al promedio histórico.
- **Sin tags de banco:** cuando un movimiento no tenga un tag del banco se dejará en blanco y al entrar en la app/web se recordara que hay un movimiento sin tag para ser modificado, redireccionando específicamente a cuál o cuáles son.

### 4. Deudas / préstamos
Seguimiento con nivel de detalle intermedio-alto, incluyendo:
- Acreedor / nombre de la deuda
- Monto total y monto restante
- Tasa de interés (si aplica)
- Cuota mensual
- Calendario de cuotas con fechas (al menos las próximas, no necesariamente todo el cronograma completo desde el inicio)
- Gráfico de progreso de pago por deuda (barra de avance)
- Proyección de cuándo terminaría de pagarse cada deuda
- Vista combinada: deuda total vs. patrimonio total (salud financiera general)

### 5. Metas de ahorro y ahorro con propósito
Se manejan dos variantes, ambas dentro de la misma sección:

**a) Ahorro con propósito** (el más importante para tu caso):
- Vive dentro de una cuenta hija específica (ej. "Ahorro pendiente", "Ahorro en pareja").
- No es solo un número estático: tiene un **historial de aportes** (fecha + monto de cada vez que se le añade dinero), para poder ver cómo ha ido creciendo.
- Puede tener o no un monto objetivo definido (algunos ahorros son "hasta donde se pueda", otros tienen una meta clara).
- Gráfico de crecimiento acumulado en el tiempo (línea o barras por mes).

**b) Meta puntual** (independiente de una cuenta):
- Nombre, monto objetivo, monto actual, fecha límite (opcional).
- No necesariamente ligada a una cuenta hija — el usuario actualiza el avance manualmente.
- Gráfico tipo barra de progreso o termómetro.
- Proyección simple: "a este ritmo, la cumplirás en X meses" (basada en el historial de aportes si existen).

En ambos casos se debe poder ver: % completado, próximo aporte sugerido (si hay meta con fecha), y comparación entre lo planeado vs. lo realmente aportado mes a mes.

---

## 🔐 Autenticación
- Uso individual (un único usuario, no hay pareja con login propio).
- Login simple vía Supabase Auth (email/password) para proteger los datos y que sean accesibles desde cualquier dispositivo de forma segura.
- El usuario **aún no tiene proyecto de Supabase creado** — se necesita una guía paso a paso para crearlo antes de construir la app.

## 🎨 Estilo visual
Mixto: debe mostrar toda la información importante de un vistazo, pero organizada con jerarquía visual clara (tarjetas, espaciado, colores por estado) para que no se sienta saturado ni "ostigante".

**Directriz de diseño: inspirado en iOS Human Interface Guidelines (HIG)**, para que se sienta nativo/adaptado al sistema y no "una web metida en un marco de teléfono". Aunque el uso principal probablemente sea desde el celular, **la app es multidispositivo (PC, iPad, celular) y el frontend debe ser completamente responsive**, adaptando el layout a cada formato (no solo escalando lo mismo):
- **Celular**: navegación tipo tab bar inferior, vistas apiladas, formularios en modales/sheets de pantalla completa.
- **iPad / tablet**: aprovechar el espacio con layouts de múltiples columnas (ej. lista + detalle lado a lado), sidebar de navegación en vez de tab bar si el ancho lo permite.
- **PC / escritorio**: layout tipo dashboard clásico con sidebar fija, más densidad de información visible a la vez (varias tarjetas/gráficos en una sola vista sin necesidad de hacer scroll excesivo), aprovechando mouse/teclado (hover states, atajos).
- En los tres casos se mantiene la misma jerarquía visual, tipografía escalable, iconografía consistente (estilo SF Symbols) y micro-animaciones de feedback al interactuar — solo cambia cómo se organiza el espacio.
- *Nota:* si en algún punto se construye o mantiene este proyecto desde Claude Code, se puede instalar la skill `wondelai/skills/ios-hig-design` (`npx skills add wondelai/skills/ios-hig-design --global`) para que el agente aplique estas convenciones de forma más rigurosa durante el desarrollo.

## 📌 Pendientes menores (no bloquean el desarrollo, se configuran dentro de la app)
1. Nombres y propósitos definitivos de las cuentas hijas — se crean directamente en la app, ya que es 100% personalizable.
2. Estructura de las deudas actuales — se cargan directamente en la app con el formulario ya definido (monto, tasa, cuota, calendario).

## 📲 Fase 2 (opcional, post-MVP): registro rápido vía Apple Shortcuts
- **Alcance específico**: este Shortcut **no registra transacciones ni movimientos sueltos** — su único propósito es agilizar la **asignación inicial de saldos de cada mes** (la distribución desde la cuenta madre hacia las cuentas hijas que hoy se hace manualmente al empezar el mes).
- Shortcut de iOS que envía esos valores de inicio de mes **directamente a Supabase** vía su API REST auto-generada (POST con JSON), sin pasar por el dashboard.
- Esto permite fijar la distribución mensual en segundos desde el celular (ej. con Siri o desde la pantalla de inicio) en vez de entrar manualmente a la app cada vez.
- El registro de transacciones día a día (fuera de esta asignación inicial) sigue siendo vía importación del CSV de MonIA (o, a futuro, la Fase 3 de registro manual mencionada abajo — **no es de implementación cercana**).
- *No se recomienda* intentar leer datos en vivo desde un archivo de Numbers (Shortcuts no tiene esa acción nativa); si se quisiera usar Numbers, tocaría exportarlo como CSV y parsearlo, similar al flujo de MonIA — más pasos, menos "automático" de lo ideal. Se deja como posible variante a evaluar más adelante si la Ruta A no es suficiente.

## 🔭 Visión a largo plazo (no prioritaria, evaluar más adelante)
- **Fase 3 (lejana)**: si el flujo con MonIA + CSV + Shortcut funciona bien, evaluar agregar un formulario de registro manual de gastos diarios directamente en la app (monto, categoría, tag, nota), para eventualmente **reemplazar MonIA por completo** y que este dashboard sea la única app de finanzas personales.
- Esto no requiere cambios de diseño ahora: la tabla de transacciones en Supabase se construye desde el inicio de forma genérica (no atada solo a "importado de CSV"), así que soportar entrada manual en el futuro es solo agregar una pantalla, no rediseñar la base de datos.

## 🚀 Próximos pasos
1. Confirmar este prompt como versión final (o ajustar lo que falte).
2. Guía paso a paso para crear el proyecto de Supabase (URL + anon key + tablas).
3. Diseñar el esquema de tablas en Supabase (accounts, transactions, category_mappings, debts, savings_goals, exchange_rate).
4. Construir el dashboard (React) conectado a Supabase.
