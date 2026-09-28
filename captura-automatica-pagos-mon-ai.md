# Captura automática de pagos (Apple Pay / Google Pay) → MON AI

Investigación y guía de implementación para registrar automáticamente en MON AI las transacciones que se hacen con Apple Pay (iOS) o Google Pay / notificaciones bancarias (Android), sin intervención manual.

---

## 0. Resumen del problema

MON AI hoy guarda todo en `localStorage` del navegador (single-file HTML/JS). Eso significa que **ninguna automatización externa puede escribir ahí directamente** — ni Shortcuts en iOS ni MacroDroid/Tasker en Android pueden tocar el `localStorage` de una pestaña de navegador. Por eso cualquier solución de captura automática necesita un **backend intermedio** (una función serverless — Supabase Edge Function, Cloudflare Worker, etc.) que reciba los datos por HTTP y los deje disponibles para que MON AI los sincronice al abrir la app.

Esa pieza de backend es común a **todas** las soluciones de abajo.

---

## 1. iOS — Apple Pay (Shortcuts)

### Hallazgo clave
No es necesario (ni posible) leer notificaciones de otras apps en iOS — Apple lo bloquea por sandboxing/privacidad, sin excepción para apps de terceros. **Pero sí existe un trigger nativo dedicado a transacciones de Apple Pay** dentro de la app Shortcuts, que no depende de leer notificaciones: es un *Intent* que el sistema dispara directamente tras cada pago.

### Cómo configurarlo
1. Shortcuts → pestaña **Automatización** → **Nueva Automatización**.
2. Buscar **Wallet** (o aparece como "Transacción" / "Transaction" según versión de iOS).
3. Elegir las tarjetas/métodos de pago a monitorear.
4. Opcional: filtrar por categoría de comercio o por comercio específico ("Filter Merchants").
5. Elegir **"Ejecutar inmediatamente"** ("Run Immediately") — evita que iOS pida confirmación cada vez.
6. Elegir o crear el Shortcut que se ejecutará. Ese Shortcut recibe como **Shortcut Input** un diccionario con:
   - `Amount` (Cantidad de la divisa)
   - `Merchant` (Comercio)

### Dentro del Shortcut
- Agregar acción **"Obtener contenido de URL"** (Get Contents of URL):
  - Método: `POST`
  - URL: tu endpoint (ej. `https://tu-backend.workers.dev/transacciones`)
  - Body: JSON `{"amount": <Cantidad de la divisa>, "merchant": <Comercio>, "origen": "apple_pay"}`

### Problemas conocidos (reportados por otros que lo implementaron)
- **Bug de iOS 17**: en un punto release, Apple rompió la selección directa del sub-valor `Amount` desde "Shortcut Input" dentro de la acción "Ejecutar Shortcut". Workaround: guardar el input completo en una variable y extraer el campo con **"Obtener valor de diccionario"** en vez de seleccionarlo directo desde el picker.
- **Valores vacíos/flaky**: a veces llega `Merchant = " "` y `Amount = 0.0`. La causa más común reportada: **Wallet necesita datos móviles habilitados** → Ajustes → Apps → Wallet → Datos móviles → activar.
- Para depurar: se puede ejecutar la automatización manualmente metiendo un monto y comercio fijos y darle Play, para confirmar que el resto del flujo (el POST) funciona antes de probar con un pago real.
- Confirmado que funciona también pagando con Apple Watch (se estabilizó en una actualización posterior de iOS 17).

### Alternativas para iOS si el trigger de Wallet no fuera suficiente
- **SMS**: si el banco (Nu) envía SMS de confirmación, usar automatización "Cuando reciba un mensaje" filtrando por remitente, parsear el texto con regex, y hacer el mismo POST.
- **Email**: regla de Mail + automatización "Cuando reciba un correo de X" con la misma lógica.
- **Share Sheet manual**: mantener presionado el banner de notificación → Compartir → apuntar a un Shortcut propio (no es automático, pero es un atajo rápido de un toque).
- **Open Finance / agregador (Belvo)**: Colombia ya tiene marco regulatorio de Open Finance (Circular 004 de 2024). Belvo opera en el país conectando más de 10 entidades (confirmado con Nequi; falta verificar si Nubank Colombia ya está en su catálogo de instituciones vía su endpoint público `listinstitutions`). Es la ruta más robusta a nivel de datos reales de transacciones, pero implica costo/integración con su API (mezcla de scraping con credenciales y open finance nativo según el banco).

---

## 2. Android — Google Pay / notificaciones bancarias

### Hallazgo clave
Android **sí permite** que una app con el permiso "Acceso a notificaciones" (`NotificationListenerService`) lea el contenido de **cualquier notificación del sistema**, incluidas las de apps de terceros como Nu o Google Pay. Esto es más flexible que iOS: no hace falta un trigger dedicado por wallet, se puede leer la notificación bancaria directamente, sin pasar por SMS.

**Precedente real**: BudgetBakers (app Wallet) usa exactamente este mecanismo — escucha las notificaciones del paquete `com.google.android.apps.walletnfcrel` (Google Pay), parsea comercio/monto/moneda, y crea automáticamente el registro de transacción.

### Opción A — MacroDroid (recomendada, más simple)
1. Nueva Macro → Disparador: **"Notification Received"**.
2. Filtrar por la app de origen (Nu, o Google Pay si se prefiere capturar ahí).
3. Opcional: filtrar por texto contenido (ej. "APROBADA").
4. Acción **"Regex"** (variable local) para extraer monto y comercio del texto de la notificación (ej. del texto "Tu compra en ANIMAL BUENA MESA por $50.000,00... ha sido APROBADA").
5. Acción **HTTP Request (POST)** al mismo webhook del backend, con `{"amount": ..., "merchant": ..., "origen": "notificacion_android"}`.
6. Nota: MacroDroid además soporta capturar parámetros de query en su propio trigger de Webhook, útil si se quiere un flujo bidireccional.

### Opción B — Tasker + plugin AutoNotification
- Tasker solo no expone bien el contenido detallado de notificaciones de terceros; se necesita el plugin **AutoNotification** (de Joao Dias, el mismo autor de Tasker), que expone título, texto completo y app de origen como variables (`%anTitle`, `%antext`, etc.).
- Perfil: Evento → Plugin → AutoNotification → filtrar por paquete de Nu (verificar el nombre exacto del paquete de la app colombiana, ej. algo tipo `com.nu.production.co`).
- Tarea: extraer variables con regex nativo de Tasker → acción **HTTP Request** (nativa en Tasker desde hace varias versiones, ya no requiere plugin aparte).

### Ventaja adicional en Android
Como se lee la notificación de Nu directamente (no un trigger genérico de "Wallet"), también se capturan transacciones que no pasen por Google Pay — pagos con tarjeta física, transferencias, etc. — cualquier cosa que Nu notifique, no solo Apple/Google Pay.

---

## 3. Backend intermedio (requisito común)

Sin importar el sistema operativo, se necesita un endpoint HTTP propio que:
1. Reciba el POST con `{amount, merchant, origen}`.
2. Lo guarde en una tabla/colección (Supabase, Cloudflare Worker + KV/D1, etc.).
3. Exponga esos registros "pendientes de sincronizar" para que MON AI los consulte al abrir (ya que no puede recibir el POST directo por vivir en `localStorage`).

---

## 4. Pendientes / próximos pasos a decidir

- [ ] Confirmar si Nubank Colombia ya está en el catálogo de instituciones de Belvo (alternativa de datos oficiales vs. notificaciones).
- [ ] Elegir tecnología del backend intermedio (Supabase Edge Function vs. Cloudflare Worker).
- [ ] Definir el regex exacto para el formato de texto de las notificaciones de Nu Colombia.
- [ ] Decidir iOS (Shortcuts) vs. Android (MacroDroid/Tasker) como plataforma prioritaria, o implementar ambas en paralelo.
- [ ] Verificar el nombre exacto del paquete de la app Nu Colombia para filtrar notificaciones en Android.
