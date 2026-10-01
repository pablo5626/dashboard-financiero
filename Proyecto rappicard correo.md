# Proyecto RappiCard: registrar el gasto desde el correo de confirmación

Estado: **investigación terminada (22-sep-2026), sin implementar.** Este documento reúne el
análisis de viabilidad y el diseño propuesto para un Shortcut de iPhone. No se tocó ningún
archivo del proyecto (`.claude/rules/shortcuts-ios.md` queda sin cambios) ni se armó ningún
`.shortcut` real todavía.

## Veredicto

**Detectar directamente un pago de Apple Pay no es posible en iOS estándar** — Shortcuts no
tiene ningún disparador de automatización del tipo "transacción de Apple Pay" ni puede leer
notificaciones de otras apps (sandboxing; ni siquiera apps de terceros como Toolbox Pro pueden
en iOS, solo en macOS).

Lo que sí es viable y **cuesta $0**: RappiCard manda un correo de confirmación con formato
estructurado por cada compra (Monto / Método de pago / No. de autorización / Comercio / Fecha
de la transacción). Un Shortcut puede dispararse con la automatización nativa "Cuando recibo un
correo", parsear ese texto con expresiones regulares, mostrar una alerta de confirmación y
guardar el gasto con el mismo patrón login→insert que ya usan "Gasto rápido"/"Transferencia
rápida" en `.claude/rules/shortcuts-ios.md`.

Decisiones ya conversadas con el dueño: las compras de RappiCard se registran como gasto de la
cuenta **"Rappi"** ya existente (no se crea cuenta ni Deuda nueva), y el atajo **pide
confirmación** antes de insertar — no guarda a ciegas.

## Opciones comparadas

| Opción | Costo | Riesgo / esfuerzo | Veredicto |
|---|---|---|---|
| **Automatización "Correo recibido" de Shortcuts + regex** | $0 | Depende de que el formato del correo no cambie; hay que confirmar el remitente exacto a mano | **Recomendada** |
| Automatización "Mensaje recibido" (SMS) | $0 | No aplica a RappiCard: notifica por correo, no por SMS. Serviría para un banco que sí mande SMS | Descartada para este caso |
| Apps de lectura de notificaciones (Toolbox Pro y similares) | De pago | En iOS no tienen acceso al centro de notificaciones de otras apps (solo existe en macOS); no es viable sin jailbreak | Descartada |
| Atajo manual (Toque posterior / Action Button) | $0 | Ya existe en `shortcuts-ios.md` ("Gasto rápido") — cero riesgo de parseo, pero no es automático | Buen respaldo si falla el parseo del correo |
| Android: Tasker / MacroDroid leyendo notificación o correo | De pago (Tasker) o freemium (MacroDroid) | Android sí permite leer notificaciones de cualquier app (`NotificationListenerService`), así que ahí es *más* viable que en iOS — se podría enganchar directo a la notificación del banco, sin depender del correo | Fuera de alcance de esta iteración; queda documentado como posibilidad futura si el usuario prueba la app en Android |

## Riesgos y hechos que condicionan el diseño

1. **Remitente exacto sin confirmar.** La captura compartida solo muestra la marca "RappiCard"
   en el cuerpo del correo, no la dirección del remitente — hay que abrir un correo real y
   copiar el `From:` exacto para el filtro de la automatización.
2. **Separador de miles.** El monto colombiano usa `.` como separador de miles (`$16.102` =
   dieciséis mil ciento dos, no una fracción) — hay que quitar los puntos antes de convertir el
   texto a número, o el atajo interpretaría mal el valor.
3. **Zona horaria de la fecha.** El correo trae `Fecha de la transacción` en hora local de
   Bogotá (UTC-5) sin indicarlo. La base espera `occurred_at` en UTC/ISO 8601, así que hay que
   sumarle 5 horas antes de mandarlo — mismo cuidado que ya tiene `transfer_date` en
   "Transferencia rápida" (ver `shortcuts-ios.md`).
4. **Idempotencia.** A diferencia de "Gasto rápido" (una ejecución manual = una compra real),
   una automatización de correo puede dispararse dos veces por el mismo mensaje si el cliente de
   correo reprocesa la bandeja (sync de IMAP). Usar el **número de autorización** del correo como
   `monia_id: "rappicard-<autorizacion>"` (en vez de timestamp+random) apoya la deduplicación en
   el `unique(user_id, monia_id)` que ya existe en `transactions`, sin ningún cambio de esquema.
5. **Cuenta destino.** Confirmado con el dueño: va como gasto de la cuenta "Rappi" ya existente,
   la misma que usa el CSV de MonIA para movimientos con tag `rappi`. No se trata como tarjeta de
   crédito/deuda separada.
6. **Confirmación obligatoria.** El atajo muestra una alerta con el monto y el comercio
   detectados antes de insertar (con *Mostrar Cancelar*), igual que "Transferencia rápida" — así
   un correo mal parseado (o que no sea realmente una compra) no carga un gasto sin que el
   usuario lo vea primero.
7. **Alcance limitado a RappiCard.** El formato de correo no es uniforme entre bancos/tarjetas;
   sumar otro emisor requeriría su propio filtro de remitente y su propio regex, replicando este
   mismo diseño.

## Diseño propuesto

```
Correo de RappiCard → Automatización "Cuando recibo un correo" (remitente = RappiCard)
  → Obtener texto plano del correo
  → 4x "Buscar texto usando expresión regular": Monto, Comercio, Fecha, No. de autorización
  → Limpiar puntos de miles del monto; sumar 5h a la fecha (Bogotá → UTC)
  → Mostrar alerta "¿Registrar gasto de $<monto> en <comercio> (RappiCard)?" (Cancelar disponible)
  → Login (paso 1 común de shortcuts-ios.md) → access_token
  → POST /rest/v1/transactions (account_id = uuid de "Rappi", monia_id = rappicard-<autorizacion>)
  → Mostrar notificación "Gasto registrado: $<monto> en <comercio>"
```

**Regex sugeridos** (a probar contra un correo real, capturando texto plano — el HTML puede
cambiar el espaciado):
- Monto: `Monto[\s\S]*?\$([\d.,]+)`
- Comercio: `Comercio[\s\S]*?\n\s*([A-Za-zÀ-ÿ0-9 ]+)`
- Fecha: `Fecha de la transacción[\s\S]*?(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})`
- No. de autorización: `No\. de autorización[\s\S]*?(\d+)`

**Body del insert** (mismo estilo que "Gasto rápido" en `shortcuts-ios.md`):
```json
{
  "monia_id": "rappicard-<Autorizacion>",
  "occurred_at": "<FechaTexto + 5h, ISO 8601>",
  "purpose": "<Comercio>",
  "amount": <-1 * MontoTexto sin puntos>,
  "currency": "COP",
  "account_id": "<uuid de la cuenta Rappi, hardcodeado igual que en Gasto rápido>",
  "assignment_level": 3,
  "assignment_confirmed": true,
  "origin": "manual"
}
```

## Ruta

Diseño cerrado en una sola fase — no hay pasos previos pendientes como en el proyecto de
WhatsApp. Para implementarlo, cuando el dueño lo pida:
1. Confirmar el remitente exacto abriendo un correo real de RappiCard.
2. Armar el Shortcut a mano en Atajos siguiendo el flujo de arriba, probando cada regex contra
   el texto real (el texto plano de un correo HTML no siempre coincide 1:1 con lo que se ve en
   pantalla).
3. Si el dueño quiere, documentarlo formalmente como nueva sección de
   `.claude/rules/shortcuts-ios.md` — pendiente hasta que lo pida explícitamente.

## Verificación (al implementar)

- Reenviar un correo real de RappiCard y confirmar que la alerta muestra el monto y el comercio
  correctos (sin puntos de miles pegados al número, comercio sin saltos de línea sobrantes).
- Confirmar que el gasto aparece en Gastos → Movimientos con cuenta "Rappi", fecha/hora correcta
  (ya ajustada a UTC) y el monto negativo esperado.
- Reenviar el mismo correo una segunda vez y confirmar que **no** se duplica el gasto — el
  insert con `monia_id` repetido debe ser rechazado por `unique(user_id, monia_id)`.
- Si se suma otro banco/tarjeta más adelante, repetir este mismo proceso con su propio formato de
  correo y su propio regex.
