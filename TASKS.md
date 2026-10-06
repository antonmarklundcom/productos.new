# TASKS.md — Sprint activo: **cierre de bloqueos de terceros**

La FASE 1 (PR #1 a #5 — schema, vidriera, checkout SPI/QR, admin y Pagopar) y
la **FASE 2 entera** (PR A a U de `PLAN.md` — roles, cuentas de cliente,
cupones, los ABMs que faltaban del panel, i18n y `pnpm nueva-tienda`) están
mergeadas en `main`. `pnpm demo` deja la base en un estado
mostrable con un pedido en cada estado (ver README). Lo único que queda sin
marcar en este archivo son ítems que dependen de que alguien fuera de este
repo entregue algo: una cuenta, un dominio, credenciales o datos reales del
comercio. La sección **"Bloqueado por terceros"** de abajo los junta todos en
un solo lugar con quién tiene que resolver cada uno — antes había que
peinar los cinco PRs para armar esa lista.

Stack: Next.js 16 + Drizzle + **Hostinger MySQL** + **Hostinger Node.js** + Cloudinary.
Marcá `[x]` al terminar. Cada bloque es un commit.

---

## Bloqueado por terceros

Ningún ítem de esta tabla se resuelve escribiendo código: cada uno espera
una decisión, una cuenta o un dato que sólo puede dar quien se nombra en la
columna "Lo desbloquea". Se listan una sola vez acá aunque aparezcan
marcados como pendientes en varias secciones más abajo.

| Bloqueo | Lo desbloquea | Dónde aparece |
|---|---|---|
| Cuenta de Hostinger + slot Node.js libre, y confirmar que el plan incluye Node.js | Dueño del proyecto | §0, §2, DoD PR #1, DoD PR #4 |
| Dominio / subdominio de la tienda | Dueño del proyecto | §0 |
| Datos bancarios reales (banco, titular, RUC, nro. de cuenta) + imagen del QR SPI | Dueño del comercio (con su banco) | §0, §9 |
| Número de WhatsApp del comercio | Dueño del comercio | §0 |
| Credenciales de Pagopar (`PAGOPAR_PUBLIC_KEY` / `PAGOPAR_PRIVATE_KEY`) + `PAGOPAR_BASE_URL` de la API 2.0 | Pagopar (alta de comercio) | §0 |
| Confirmar el sobre exacto de la respuesta del webhook contra la doc v2 vigente | Pagopar (acceso a la doc actualizada) | §21 |
| Túnel HTTPS + registrar la "URL de respuesta" en el panel de Pagopar, para probar de punta a punta | Pagopar (panel del comercio) — depende de las credenciales de arriba | §21 |
| Cuenta de Cloudinary (o folders separados en una existente) | Dueño del proyecto | §0 |
| Fotos reales de cada producto | Dueño del comercio (catálogo fotográfico real) — los placeholders sólo evitan la caja gris en la demo, no reemplazan esto | §8 |
| Lighthouse mobile ≥ 90 medido de verdad | Depende del deploy a Hostinger (primer bloqueo de esta tabla) | §8 |

---

## 0. Decisiones bloqueantes (antes de escribir código)
- [ ] **Qué cuenta de Hostinger y qué slot Node.js** usa este proyecto (hay 10 slots por cuenta — verificar cuáles están libres)
- [ ] Confirmar que el plan de Hostinger incluye **Node.js** (los planes sólo-PHP no sirven para Next.js)
- [ ] Dominio / subdominio para la tienda
- [x] **Métodos de pago del MVP: SPI/QR manual + contra entrega.** Pagopar queda para el PR #5, post-lanzamiento
- [ ] Datos bancarios reales (Banco, titular, RUC, nro. de cuenta) + imagen del QR SPI — necesarios recién en el PR #3
- [ ] Número de WhatsApp del comercio en formato `+5959XXXXXXXX`
- [ ] **Credenciales de sandbox de Pagopar** (`PAGOPAR_PUBLIC_KEY` / `PAGOPAR_PRIVATE_KEY`) + la URL base de la API 2.0 — ahora sí bloquean: son lo único que falta para confirmar el formato de la respuesta del webhook (§21)
- [ ] Cuenta de Cloudinary (o reusar la de inmobiliaria con folders separados)

---

## 1. Scaffold
- [x] `npx create-next-app@latest` — TS, App Router, Tailwind
- [x] `shadcn` init + button, dialog, input, form, table, badge, sheet, select, sonner
- [x] `tsconfig`: `strict: true`, `noUncheckedIndexedAccess: true`
- [x] ESLint + Prettier + husky pre-commit (typecheck + lint)
- [x] `vitest` + `@testing-library/react` corriendo en CI

## 2. Base de datos (Hostinger MySQL)
- [ ] Crear DB + usuario en hPanel; guardar credenciales en el gestor de contraseñas *(bloqueado — requiere acceso a Hostinger)*
- [ ] **Remote MySQL**: whitelistear la IP de desarrollo *(ídem)*
- [x] `DATABASE_URL` en `.env.local` — apunta al MySQL local de `docker-compose.yml` en dev; Hostinger se conecta recién en el deploy
- [x] ⚠️ `tsx` **no** carga `.env` solo → usar `import 'dotenv/config'` al inicio de cada script
- [x] `drizzle.config.ts` (dialect `mysql`, schema `./src/db/schema.ts`, out `./drizzle`)
- [x] `src/db/index.ts` — pool único, `connectionLimit: 8`, `timezone: "Z"`

## 3. Schema — `src/db/schema.ts`  *(Opus 5)*
- [x] ENUMs: `order_status`, `payment_method`, `payment_provider`, `payment_status`, `receipt_review`, `doc_type`, `user_role`, `invoice_status`
- [x] `categories` (self-FK, `slug` UQ) · `products` (`slug` UQ, `iva_rate TINYINT` ∈ {10,5,0}, `published_at`, FULLTEXT) · `product_images` · `variants` (`price_pyg BIGINT UNSIGNED`, `on_hand INT UNSIGNED`)
- [x] `orders`: `order_number` UQ, `access_token` UQ, todos los montos `BIGINT UNSIGNED`, `reserved_until`, columnas `invoice_*` (nullables, sin usar en el MVP)
- [x] `order_items` con snapshots de nombre / sku / precio / iva_rate
- [x] `payments` con `UNIQUE (provider, provider_ref)`
- [x] `payment_events` con `UNIQUE (provider, event_key)` ← **idempotencia de webhooks**
- [x] `receipts`, `stock_reservations`, `order_events`, `users`, `shipping_zones`
- [x] Índices: `orders(status, created_at)`, `orders(access_token)`, `orders(customer_phone)`, `orders(doc_number)`, `stock_reservations(variant_id, state, expires_at)`
- [x] ✅ Verificar: **ningún** `float` / `decimal` en columnas de dinero

## 4. Lógica de dominio  *(Opus 5)*
- [x] `transitionOrder(orderId, to, actor, reason)` — transacción + `FOR UPDATE` + tabla de aristas permitidas + escribe `order_events`
- [x] Tests: `enviado → pagado` falla · doble `→ pagado` es no-op · `→ pagado` descuenta `on_hand` una sola vez
- [x] `getAvailability(variantId)` = `on_hand − Σ(reservas held no vencidas)`
- [x] `reserveStock(orderId, items)` — transacción, `FOR UPDATE` sobre las variantes, re-chequea disponibilidad antes de commitear
- [x] `nextOrderNumber()` → `PY-000123` (contador dedicado, **nunca `COUNT(*)`**); test de concurrencia
- [x] Grep final: `UPDATE orders SET status` no debe existir fuera de `transitionOrder`

## 5. Utils PY + tests  *(Opus 5)*
- [x] `formatGs(1234567)` → `"₲ 1.234.567"` (`Intl` `es-PY`, `maximumFractionDigits: 0`)
- [x] `validateRuc("80012345-6")` → DV módulo-11; casos con CI; RUC `44444401-7` para consumidor final
- [x] `normalizePhonePY("0981 123 456")` → `"+595981123456"`
- [x] `ivaIncluded(110000, 10)` → `10000` — redondeo **por línea**, no sobre el total
- [x] `waLink(phone, text)` con `encodeURIComponent` + límite de longitud
- [x] Fechas: `dd/mm/yyyy`, zona `America/Asuncion` en toda la UI

## 6. Auth + Cloudinary
- [x] `users` (email UQ, `password_hash` bcrypt, `role`), `iron-session`, `requireAdmin(session)`
- [x] Script `create-owner.ts` — **sin ruta pública de registro**
- [x] Cloudinary: folder `productos/` público, folder `comprobantes/` privado/authenticated (config + `signedReceiptUrl()` — sin flow de upload todavía)
- [x] `uploadReceipt()` con validación MIME (`jpeg|png|pdf`), ≤ 5 MB, ≤ 3 por pedido (`src/app/actions/receipt.ts`, usado por `src/components/receipt-upload.tsx`; validación en `src/domain/receipts.ts`)
- [x] `signedReceiptUrl()` con TTL corto para el admin

## 7. Zod + seed
- [x] `lib/schemas.ts`: `CartItemSchema`, `CheckoutInputSchema` (refine `doc_number` según `doc_type`), `AdminProductInput`
- [x] `scripts/seed.ts` idempotente (`onDuplicateKeyUpdate` por slug/sku): 4 categorías, 24 productos, variantes, stock, zonas de envío
- [x] `pnpm db:push` / `db:seed` / `db:studio`

---

## Definition of done del PR #1
- [x] `pnpm typecheck && pnpm lint && pnpm test` verde
- [ ] Catálogo sembrado visible desde un Server Component conectado a Hostinger MySQL — ✅ verificado contra MySQL local (`docker compose up -d`); falta la cuenta de Hostinger (bloqueante §0)
- [x] `transitionOrder` cubierto por tests, incluyendo transiciones inválidas
- [x] `.env.example` completo · `.env.local` ignorado (`git check-ignore .env.local` lo confirma)
- [x] Ningún secreto con prefijo `NEXT_PUBLIC_`

---

# PR #2 · Storefront, Catalog & Cart

## 8. Vidriera
- [x] Layout: header + badge del carrito, footer, nav mobile, botón flotante de WhatsApp, metadata `es-PY`
- [x] `/` home: hero, destacados, grilla de categorías (ISR)
- [x] `/categoria/[slug]`: filtros (precio, marca), orden, paginación server-side
- [x] `/producto/[slug]`: galería, selector de variante, disponibilidad, nota "IVA incluido", JSON-LD Product
- [x] Primitivas: `ProductCard`, `PriceTag`, `StockBadge`, `QuantityStepper`
- [x] Carrito Zustand con `persist` + migración versionada, líneas por variante
- [x] Slide-over del carrito: editar, quitar, subtotal, "Seguí comprando" / "Ir al checkout"
- [x] **Revalidación del carrito** — re-precia y re-chequea stock en el servidor; avisa "cambió el precio / se quedó sin stock"
- [x] Búsqueda con `FULLTEXT` (+ fallback a `LIKE` para términos cortos)
- [x] Pipeline de imágenes de Cloudinary con placeholders
- [x] Estados vacíos / loading / error, `not-found.tsx`
- [ ] Lighthouse mobile ≥ 90 perf/a11y en la ficha de producto *(medir con el sitio desplegado)*
- [ ] Fotos reales de producto en Cloudinary *(el seed no trae fotos: se ve una ilustración placeholder por categoría — `public/placeholders/` — en vez de la caja de color de antes)*

---

# PR #3 · Checkout: SPI/QR manual + contra entrega

## 9. Núcleo del checkout *(Opus 5)*
- [x] **`createOrder`** — re-precia todo desde la DB, inserta pedido + ítems + reservas en UNA transacción, acuña `access_token`, `reserved_until` según el método
- [x] Envío por zona desde `shipping_zones` + umbral de envío gratis
- [x] **Subida de comprobante** — MIME por bytes (no por el `type` del navegador), ≤ 5 MB, ≤ 3 por pedido, Cloudinary privado, fila en `receipts`, → `esperando_verificacion`
- [x] **Guard de `/pedido/[order_number]?t=`** — comparación de token en tiempo constante; token inválido y pedido inexistente devuelven el mismo 404
- [x] **`/pedido/buscar`** — nro. + teléfono, 5 intentos / 15 min / IP, mensaje de error genérico, redirige a la URL tokenizada
- [x] `/checkout` con formulario (nombre, WhatsApp, RUC/CI con DV, ciudad/barrio/dirección, método de pago)
- [x] Timeline del pedido desde `order_events`
- [x] Página SPI/QR con datos bancarios y botones de copiar — lee `BANCO_*` del entorno (`src/lib/comercio.ts`); sin configurar, muestra un aviso en vez de inventar un banco o un RUC *(datos reales del comercio siguen pendientes — TASKS.md §0)*
- [x] Botón "Enviar comprobante por WhatsApp" con mensaje pre-armado (nro. de pedido, total, URL tokenizada)
- [x] Notificación al dueño de un pedido nuevo — link `wa.me` de un toque desde `/admin/pedidos`, sin SMTP

---

# PR #4 · Admin & Hardening

## 10. Auth del panel *(Opus 5)*
- [x] Login `/admin/login` + `iron-session` reusando `requireAdmin()` del PR #1
- [x] Proxy (`src/proxy.ts`, el ex `middleware.ts` de Next 16) protegiendo `/admin/*`, con `?next=` validado contra redirect abierto
- [x] **Rol re-chequeado adentro de cada server action** (`requireAdminSession()`), no sólo en el borde de la ruta
- [x] Rate limit del login por IP **y** por email; mensaje genérico que no distingue "no existe" de "contraseña incorrecta"
- [x] Test que grepea cada `export async function` de `src/app/actions/admin-*.ts` y falla si le falta el guard

## 11. Pedidos
- [x] `/admin/pedidos`: filtros por estado/método/fecha, paginación server-side, tarjetas usables en celular
- [x] Búsqueda por nro. de pedido (con o sin `PY-`), WhatsApp (cualquier formato) y RUC/CI (con o sin guion)
- [x] `/admin/pedidos/[id]`: ítems, desglose de IVA, datos del cliente, timeline de `order_events`, botón wa.me con el link tokenizado
- [x] Acciones de estado conectadas **sólo** a `transitionOrder`; se ofrecen únicamente las aristas válidas
- [x] Confirmación con motivo para lo que no se puede deshacer (cancelar, rechazar, reembolsar)

## 12. Comprobantes *(Opus 5)*
- [x] Preview con URL firmada de TTL corto, pedida al tocar "Ver" y no embebida en el HTML del listado
- [x] Aprobar/rechazar en una transacción: marca el comprobante y mueve el pedido por `transitionOrder`
- [x] Motivo obligatorio para rechazar (lo lee el comprador)
- [x] Tests: aprobar descuenta stock una vez · dos comprobantes del mismo pedido no descuentan dos veces · transición inválida deja el comprobante intacto

## 13. Productos
- [x] `/admin/productos`: ABM con búsqueda y paginación; alta en `/admin/productos/nuevo`
- [x] Variantes con precio en ₲ **entero** (`step=1`, sin decimales) y SKU único
- [x] Subida de fotos a Cloudinary público, con MIME validado **por los bytes** (SVG excluido a propósito)
- [x] Ajuste de stock con motivo obligatorio, auditado en la tabla nueva `stock_adjustments` (delta con signo + antes/después + actor)
- [x] El ajuste va por delta y no por total absoluto: dos conteos simultáneos se acumulan en vez de pisarse

## 14. Resumen
- [x] Ventas del día y del mes en ₲ con `formatGs`, contando **sólo** lo ya cobrado
- [x] Cortes de día/mes en hora `America/Asuncion`, no UTC (un pedido de las 21:00 cuenta en su día)
- [x] Pedidos esperando verificación y pendientes de pago
- [x] Stock bajo medido sobre lo **disponible** (`on_hand − reservas vigentes`), no sobre lo físico

## 15. Cron
- [x] `GET|POST /api/cron/vencer-pedidos` protegida por `CRON_SECRET` con `timingSafeEqual` + rate limit
- [x] Vence los pedidos sin pago pasados de `reserved_until`, uno por uno vía `transitionOrder` (nunca un UPDATE masivo)
- [x] GC de reservas resueltas de más de 30 días; nunca borra una `held`
- [x] Libera reservas huérfanas de pedidos vencidos/cancelados
- [x] Sin `CRON_SECRET` configurado la ruta responde 503, no 200

## 16. Revisión de seguridad *(Opus 5)*
- [x] Guard verificado por test en cada server action de admin (y que el guard sea lo **primero** que corre)
- [x] Rate limits: login (IP + email), búsqueda de pedidos (ya del PR #3), cron
- [x] Cabeceras: CSP con nonce por request (sin `unsafe-inline` en scripts), HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, `poweredByHeader: false`
- [x] Panel servido con `no-store` + `noindex`
- [x] Scan de secretos commiteados (PEM, AWS, GitHub, Cloudinary, URLs de MySQL con contraseña) y de `NEXT_PUBLIC_` mal usado
- [x] Logs sin secretos: el cron loguea cantidades, nunca el valor probado ni ids de pedido
- [x] `?next=` del login sólo acepta rutas internas de `/admin` (redirect abierto cerrado)
- [x] Verificado en un navegador real: el CSP con nonce no rompe la hidratación y el panel no scrollea horizontal en 390 px

## 17. Auditoría del dinero *(Opus 5)*
- [x] Grep del repo entero: cero `float`/`DECIMAL`/`NUMERIC` en columnas de dinero — confirmado contra el DDL **y** contra `information_schema` de la base viva
- [x] Cero `toFixed`/`parseFloat`/literales decimales en el camino del dinero, verificado por test
- [x] IVA redondeado **por línea**, con el caso que distingue las dos implementaciones fijado en un test (3 × ₲33.333 → 9090 por línea vs 9091 sobre el total)
- [x] Query de reconciliación: `subtotal = Σ(line_total)`, `total = subtotal + envío`, `line_total = precio × cantidad`, todo en enteros dentro de MySQL
- [x] `pnpm reconcile` para correr a mano o desde el cron nocturno; sale con código 1 si algo no cuadra
- [x] Tests de la reconciliación en las dos direcciones: un pedido normal cuadra, y un descuadre inyectado se detecta

## Definition of done del PR #4
- [x] `pnpm typecheck && pnpm lint && pnpm test` verde (259 tests)
- [x] `pnpm build` sin warnings
- [x] Ciclo completo probado en un navegador a 390 px: login → filtrar → aprobar comprobante → el pedido queda `pagado` con su auditoría → salir
- [ ] Deploy a Hostinger, smoke test en producción y script de backup de la DB *(PLAN.md 4.11 — bloqueado: necesita la cuenta de Hostinger)*

---

# PR #5 · Pagopar *(post-MVP, no toca el schema)*

## 18. Cliente de Pagopar *(Opus 5)*
- [x] `pagoparAmount()` — el total viaja como **string entero exacto** (`"150000"`, nunca `"150000.00"`); rechaza decimales, negativos y notación científica
- [x] `requestToken()` = `sha1(PRIVATE_KEY + order_number + total)`, con `order_number` (nunca el id interno)
- [x] `webhookGuardToken()` = `sha1(PRIVATE_KEY + hash_pedido)` — **función aparte**, otra entrada, otro vector de test
- [x] `iniciarTransaccion()` con request/response tipados y el sobre `{respuesta, resultado}` parseado
- [x] Timeout por intento (`AbortSignal.timeout`) + reintentos con **jitter completo**; 5xx y cortes de red se reintentan, 4xx no
- [x] `startPagoparCheckout()` deja la fila de `payments` con `provider_ref = hash_pedido` **antes** del redirect — sin eso, el aviso que llega temprano no tiene a qué pedido aplicarse
- [x] `PAGOPAR_BASE_URL` sin default en el código: una URL "por si acaso" manda los datos del comercio al host equivocado

## 19. Webhook `POST /api/webhooks/pagopar` *(Opus 5)*
- [x] Guard en el querystring: `sha1(PRIVATE_KEY + hash_pedido)` comparado con `timingSafeEqual`; 401 genérico que no distingue "falta el token" de "está mal"
- [x] Idempotencia: `INSERT IGNORE` en `payment_events (provider, event_key)`; `affectedRows === 0` → repetido → 200 y afuera
- [x] La clave de idempotencia lleva el estado además del hash: si fuera sólo el hash, un primer aviso de "no pagado" taparía para siempre el "pagado" que viene después
- [x] Verificación de **monto contra `orders.total_pyg`** antes de transicionar (comparación de enteros, sin floats)
- [x] `transitionOrder(→ pagado)` — nunca un `UPDATE` directo
- [x] El `INSERT IGNORE` y la transición van en **una sola transacción**: si el proceso muere en el medio, el reintento rehace el trabajo en vez de descartarlo como repetido
- [x] Un pedido en estado final (`enviado`, `cancelado`) responde 200 y queda logueado, sin arrastrarlo de vuelta ni entrar en bucle de reintentos
- [x] Presupuesto de 4 s (`withDeadline`) por debajo de los ~5 s de Pagopar; el corte es seguro porque la transacción es atómica
- [x] Rate limit por IP, holgado (120/min): tirar un aviso legítimo cuesta un pedido cobrado sin marcar
- [x] Logs sin secretos: nunca `PAGOPAR_PRIVATE_KEY` ni el token recibido; sí el número de pedido cuando el dueño tiene que intervenir
- [x] Sin `PAGOPAR_PRIVATE_KEY` la ruta responde 503, no 200

## 20. Suite del webhook *(Opus 5)*
- [x] Aviso válido → `pagado`, stock descontado, `payments` en `paid`, fila en `order_events` con actor `pagopar`
- [x] Firma alterada → 401, nada cambia, ni siquiera se registra el evento (incluye el caso "firma válida pero de otro pedido")
- [x] Replay ×3 → 200 las tres veces, una sola transición, stock descontado **una sola vez**, una sola fila en `payment_events`
- [x] Monto distinto → 409, pedido intacto; el evento **no** queda registrado para que el aviso corregido pueda procesarse
- [x] Pedido inexistente → 404 con rollback, y el reintento posterior (cuando ya existe la fila de `payments`) sí cobra
- [x] Webhook antes del redirect → cobra igual, y el comprador encuentra el pedido ya pagado cuando vuelve
- [x] Pedido ya enviado → 200, sigue `enviado`, sin transición nueva y sin tocar el stock
- [x] Test de que ningún log imprime la clave privada ni el token recibido

## 21. Formato de la respuesta *(Opus 5)*
- [x] La forma de la respuesta vive en **una sola función** (`webhookResponseBody`), fijada por test
- [x] Test de integración contra el sandbox listo y salteándose solo mientras no haya credenciales (`PAGOPAR_SANDBOX_*` en `.env.example`, vacías)
- [ ] ⚠️ **Confirmar el sobre exacto contra la doc v2 vigente + sandbox.** ARCH.md §4 avisa que cambió entre revisiones; al implementar no había credenciales ni acceso de red a la documentación de Pagopar, así que quedó fijado el sobre `{respuesta, resultado}` que usa el resto de la API 2.0 — **sin confirmar**. Es lo único que falta antes de cobrar de verdad
- [ ] Túnel HTTPS + "URL de respuesta" registrada en el panel de Pagopar para probarlo de punta a punta (Pagopar no llama a `localhost`)

## 22. Pendiente de PR #5 *(Sonnet 5)*
- [x] Método "Tarjeta / Pagopar" en el checkout + página de retorno (PLAN.md 5.5)
- [x] Reserva de 45 min para el método tarjeta (`RESERVATION_TTL_MINUTES.tarjeta`, ya venía del PR #1)

## Definition of done del PR #5
- [x] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` verde (348 tests, 1 salteado: el de sandbox)
- [x] Un webhook repetido no cambia nada; una firma alterada devuelve 401 y queda logueada
- [ ] Compra de sandbox pagada de punta a punta *(bloqueado: faltan credenciales de Pagopar — TASKS.md §0)*

---

# PR #6 · Pago tardío: el aviso que llega después del vencimiento *(Opus 5)*

## 23. Política del pago tardío *(ARCH.md §4.1)*
- [x] Decidida y escrita en ARCH.md §4.1, con el porqué de cada regla
- [x] El pago se registra **siempre** y el registro no se revierte: `payment_events` + `payments` en `paid` commitean aunque el pedido no se pueda salvar
- [x] `vencido → pagado` habilitado en la máquina de estados; `cancelado → pagado` sigue prohibido (lo canceló una persona a propósito)
- [x] El re-chequeo de stock vive **dentro de `transitionOrder`**, no en quien llama: los tres caminos a `pagado` (webhook, comprobante aprobado, botón del panel) quedan cubiertos por construcción
- [x] `secureStockForPayment()` verifica todas las líneas antes de escribir una sola reserva: no existe el estado "medio reservado"
- [x] Caso inverso: una reserva `held` pero vencida se suelta y se vuelve a pedir contra la disponibilidad viva — descontar sobre una promesa vencida sería sobreventa
- [x] Locks en el mismo orden que `reserveStock` (por `variant_id`), o dos pedidos con los mismos ítems se deadlockean cruzados
- [x] El dueño lo ve: `findUnmatchedPayments()` deriva la lista de los datos (pago `paid` + pedido fuera de la cadena del cobro) y el panel la muestra arriba de todo. Sin columna nueva ni flag que alguien tenga que acordarse de escribir
- [x] El webhook contesta 200 en el caso irrecuperable: reintentar no cambia nada, lo que sigue es una devolución

## 24. Tests del pago tardío *(Opus 5)*
- [x] Vencido + hay stock → revive a `pagado`, descuenta una sola vez, `order_events` explica por qué
- [x] Vencido + se vendió el stock → sigue `vencido`, **el pago igual queda `paid`** y el aviso en `payment_events`, sin reservas colgadas
- [x] Cancelado + aviso de pago → sigue `cancelado`, el pago queda registrado para devolver
- [x] `findUnmatchedPayments()` en las dos direcciones: lista la plata colgada, deja afuera la que sí tiene pedido cobrado
- [x] Reserva vencida + ítem vendido → `StockUnavailableError`, `on_hand` intacto
- [x] Reserva vencida + stock libre → cobra y descuenta **una sola vez** (no la vencida más la nueva)
- [x] La reserva viva del propio pedido no se cuenta como competencia (última unidad, reservada por él mismo, se cobra)

---

# PR #7 · `pnpm reconcile` v2: invariantes entre tablas *(Opus 5)*

## 25. Controles cruzados
- [x] Pedido de tarjeta cobrado sin fila de pago acreditada (`pedido_cobrado_sin_pago`)
- [x] Pago acreditado cuyo pedido nunca pasó por `pagado` (`pago_sin_transicion`) — se mira `order_events`, no `orders.status`: importa si la transición **ocurrió alguna vez**
- [x] `payments.amount_pyg ≠ orders.total_pyg` (`monto_del_pago_distinto`)
- [x] Comprobante aprobado que no movió el pedido (`comprobante_aprobado_sin_movimiento`)
- [x] `order_events` con aristas imposibles (`arista_imposible`), incluida la fila que "nace cobrada" (`from_status` NULL hacia algo que no sea `pendiente_pago`) y el evento que no se mueve a ningún lado
- [x] La lista blanca de aristas se arma desde `ORDER_TRANSITIONS`, no escrita a mano en el SQL: una arista nueva la acepta sola y las dos versiones no se pueden separar
- [x] Todo el filtro corre dentro de MySQL con enteros; en JS sólo se transporta el resultado
- [x] `pnpm reconcile` imprime primero los cruzados (más graves) y sigue saliendo con código 1

## 26. Tests de los controles cruzados *(las dos direcciones)*
- [x] Base sana con pedidos cobrados por los dos caminos (tarjeta y transferencia con comprobante aprobado) → no reporta nada
- [x] Cada una de las cinco inconsistencias inyectada a mano → se detecta
- [x] Casos negativos que separan el control de un falso positivo: transferencia cobrada sin fila en `payments`, pago `pending`, pedido ya `entregado`, comprobante `pending`, fila de creación con `from_status` NULL
- [x] Varias inconsistencias distintas a la vez salen todas en el mismo reporte

## 27. Hueco conocido *(cerrado en el PR #10)*
- [x] **Sólo Pagopar escribía en `payments`.** Una transferencia aprobada o un contra entrega llegaban a `pagado` sin ninguna fila de pago, así que `pedido_cobrado_sin_pago` estaba acotado a `payment_method = 'tarjeta'`. Se cerró donde correspondía: en el camino de escritura, no en el control de lectura

---

# PR #10 · El pago manual queda registrado *(Opus 5)*

## 27.1 Camino de escritura *(ARCH.md §5.1)*
- [x] `recordManualPayment()` corre **dentro de `transitionOrder`**, al entrar a `pagado`, en la misma transacción que cobra el pedido: los tres caminos a `pagado` quedan cubiertos sin que ninguno tenga que acordarse de nada
- [x] `transferencia → spi`, `contra_entrega → cod`; `tarjeta` no escribe nada porque esa fila ya la puso `startPagoparCheckout`
- [x] `provider_ref = orders.order_number`: inmutable, único y es lo que el dueño busca en el extracto del banco. Con eso `UNIQUE(provider, provider_ref)` significa "un solo cobro manual por pedido y proveedor"
- [x] `INSERT IGNORE`: idempotente bajo doble click por el índice, no por una lectura previa. Una fila ya existente no se pisa — un pago `refunded` no revive porque el pedido vuelva a pasar por `pagado`

## 27.2 La invariante, sin el parche
- [x] `pedido_cobrado_sin_pago` ya no filtra por método: pedido cobrado ⇒ pago registrado, sin excepciones
- [x] Cuenta como registrado `paid` **o** `refunded`: devolver la plata no borra que entró (un pedido `reembolsado` no está incompleto)

## 27.3 Backfill *(script, no migración)*
- [x] `pnpm backfill:pagos-manuales` completa los pedidos ya cobrados por el camino manual. Ensayo por defecto; `--apply` escribe
- [x] Script y no migración porque el schema se aplica con `drizzle-kit push`, que **no corre los archivos de `drizzle/`**: una migración con el backfill adentro correría en los tests y jamás en el servidor del comercio
- [x] La escritura es un `INSERT ... SELECT`: el monto va de `orders.total_pyg` a `payments.amount_pyg` sin salir de MySQL
- [x] Idempotente por el mismo índice único: correrlo dos veces no duplica y correrlo después de un corte termina lo que faltaba

## 27.4 Tests
- [x] Comprobante aprobado → fila `spi` con el total exacto; contra entrega confirmado → fila `cod`; tarjeta → no aparece una segunda fila
- [x] Comprobante rechazado → ningún pago registrado
- [x] Dos aprobaciones **simultáneas** del mismo comprobante → un solo pago
- [x] Atomicidad: si el cobro falla por falta de stock, no queda ni el pago ni el comprobante aprobado
- [x] Backfill en las dos direcciones: ensayo que no escribe, `--apply` que escribe, segunda corrida que no duplica, y el monto leído como texto crudo desde MySQL para que ningún `Number()` pase por el medio

---

# PR #8 · Suite de concurrencia contra MySQL real *(Opus 5)*

## 28. Carreras cubiertas
- [x] Dos checkouts por la última unidad → uno cobra, el otro pierde con un error de **dominio** (no un `ER_LOCK_DEADLOCK`)
- [x] Diez checkouts sobre tres unidades → se reservan exactamente tres
- [x] Dos carritos con las mismas dos variantes en **orden opuesto** → ninguno se deadlockea (fija el `sort` por `variant_id` de `reserveStock`)
- [x] `reserveStock` contra su propio vencimiento: reserva vencida + cron + comprador nuevo a la vez → una sola reserva viva, sin duplicar la unidad
- [x] Dos reservas simultáneas sobre una reserva recién vencida → entra una sola
- [x] Webhook contra cron sobre el mismo pedido → o `pagado` o `vencido`, nunca un tercer resultado; **el pago queda registrado pase lo que pase**
- [x] Dos avisos idénticos **simultáneos** (el `INSERT IGNORE` bajo contención real, no llamadas secuenciales) → `aplicado` + `repetido`, una fila en `payment_events`, un solo descuento, una sola transición
- [x] Cinco avisos idénticos simultáneos → un solo cobro
- [x] Cobrar y reservar a la vez → `on_hand` nunca queda por debajo de lo real

## 29. Forma de los tests
- [x] Cada operación en su propia conexión del pool, lanzadas con `Promise.all`: en secuencia ninguno de estos bugs aparece
- [x] Se afirma sobre el resultado **agregado**, nunca sobre quién ganó — eso depende del scheduler y no es asunto del test
- [x] Corridos cinco veces seguidas sin flakiness antes de commitear
- [x] Nada que arreglar: las nueve carreras ya se resolvían bien. Los tests fijan las decisiones que las resuelven (`FOR UPDATE` sobre la variante, lectura bloqueante de las reservas, orden de locks por `variant_id`, `INSERT IGNORE` y transición en la misma transacción)

---

# PR #9 · Revisión de seguridad ronda 2 + `pnpm preflight` *(Opus 5)*

## 30. Revisión ronda 2 — lo que se agregó después del PR #4
- [x] **Cobertura que no se queda vieja**: el control descubre `src/app/actions/` y `src/app/api/**/route.ts` por directorio, no por una lista escrita a mano. Una acción o ruta nueva entra sola
- [x] Toda server action llama a algún guard (admin, acceso del comprador o rate limit); `cart.ts` es la única excepción declarada, por ser stateless
- [x] Toda ruta de API verifica firma, secreto o sesión antes de tocar la base
- [x] Webhook de Pagopar: la firma se verifica **antes** de `processPagoparWebhook`, 503 sin clave privada, respuesta `no-store`
- [x] `/dev/pagopar` cerrada por partida doble (render + server action) y con `noindex`
- [x] Candado de producción del modo mock verificado por **comportamiento** desde la revisión (el detalle sigue en `pagopar-mock-mode.test.ts`)
- [x] 🐛 **Encontrado y arreglado**: `submitCheckout` no tenía rate limit. Cada pedido creado reserva stock por 45 min o 24 h sin que nadie pague nada, así que un script dejaba la vidriera en "sin stock" gratis. `CHECKOUT_LIMIT = 20 / 10 min` por IP, holgado para que un NAT familiar no lo note

## 31. `pnpm preflight`
- [x] Un comando que contesta "¿se pierde algo si mañana alguien compra acá?" y sale con código 1 si sí
- [x] Bloquea: sobre del webhook sin confirmar, `BANCO_*` incompletos, `CRON_SECRET` / `SESSION_SECRET` vacíos o cortos, Cloudinary sin configurar, `NEXT_PUBLIC_SITE_URL` sin https en producción, `PAGOPAR_MODE=mock` con `NODE_ENV=production`
- [x] Advierte sin frenar: credenciales de Pagopar faltantes (la tienda cobra igual por transferencia), base local en producción, formato raro del WhatsApp
- [x] `WEBHOOK_ENVELOPE_CONFIRMED` es una **constante del código**, no una variable de entorno: confirmarlo es un hecho sobre el repo, no sobre el servidor
- [x] No toca la base ni la red: se puede correr en producción sin efectos
- [x] Nunca imprime el valor de un secreto — sólo si está y si tiene el largo mínimo, verificado por test
- [x] Tests en las dos direcciones, uno por control: sano → `ok`, roto → `bloquea`

---

# PR #11 · Recuperación de pagos colgados, desde el panel *(Opus 5)*

## 32. Las dos acciones *(ARCH.md §4.1)*
- [x] **Reintentar**: `vencido → pagado` vía `transitionOrder`, que re-asegura el stock primero. Nunca un `UPDATE` crudo. Si la mercadería sigue sin estar, no escribe nada y se puede volver a tocar cuando el comercio reponga
- [x] **Marcar como devuelto**: `payments.status = 'refunded'` + pedido a `cancelado` con el motivo en `order_events`, en una sola transacción. El software no mueve plata: anota que el dueño ya la movió
- [x] Las dos detrás de `requireAdminSession` — una server action es un endpoint HTTP con su propio id y el middleware de `/admin` no la cubre
- [x] Las dos releen pago y pedido con `SELECT ... FOR UPDATE` en vez de confiar en el id del formulario: la pantalla desde la que se hizo click puede tener minutos de viejo
- [x] Las dos idempotentes: el segundo click no escribe y **no es un error**
- [x] `cancelado` no revive ni con el botón (ARCH.md §4.1 regla 4), con un mensaje escrito para el dueño en vez del error de la máquina de estados
- [x] Devolver se **niega** si el pedido revivió mientras la pantalla estaba abierta: cancelar ahí sería cancelar un pedido que alguien está por preparar
- [x] El motivo de la devolución es obligatorio: es lo único que va a explicar esa plata dentro de seis meses

## 33. Tests
- [x] Revive con stock (descuenta una sola vez) · sin stock (no mueve nada y se puede reintentar después) · ya revivido (`changed: false`)
- [x] Devolución: marca `refunded`, cancela, deja el motivo y el actor en `order_events`, y el pago sale solo de `findUnmatchedPayments()`
- [x] Sin motivo no escribe nada; marcar dos veces no duplica el evento
- [x] Un id inexistente en el formulario no rompe nada
- [x] **Concurrencia**: dos dueños tocando "reintentar" a la vez sobre la misma fila → ninguno explota, un solo descuento, una sola fila en `order_events`
- [x] **Concurrencia**: reintentar y devolver a la vez → o pedido cobrado con el pago `paid`, o pedido cancelado con el pago `refunded`. Nunca cobrado con la plata devuelta ni cancelado con el stock descontado

---

# PR #12 · Que el link se comparta, que el envío se sepa antes, y que el pedido colgado se pueda cobrar

## 34. Compartir un producto *(OG)*
- [x] La ficha manda su foto principal recortada a 1200×630 (`c_fill`, la caja de WhatsApp e Instagram)
- [x] `metadataBase` desde `NEXT_PUBLIC_SITE_URL`: sin eso la URL de la imagen sale relativa y ningún scraper la resuelve
- [x] Respaldo del sitio dibujado desde `TIENDA` (`app/opengraph-image.tsx`), no un PNG commiteado que cada tienda nueva se olvidaría de reemplazar
- [x] Producto sin fotos → hereda el respaldo, nunca el rectángulo gris
- [x] NEW-STORE.md decía que había que cambiar un `og-image` de `public/` que no existía — corregido

## 35. Consentimiento de novedades
- [x] `orders.marketing_opt_in` **nullable**: NULL = no se preguntó, false = dijo que no, true = aceptó
- [x] `marketing_opt_in_at` en cualquier respuesta explícita, no sólo en el "sí"
- [x] Casilla sin tildar de entrada, copy que dice quién escribe y por qué
- [x] Se muestra en el panel sólo si hubo respuesta
- [x] **Sin mecanismo de envío**: no hay proveedor de mensajería en el stack y no se quiere uno

## 36. Cotización de envío antes del pedido *(la grande)*
- [x] `computeOrderTotals` — una sola cuenta, usada por la cotización pública y por `createOrder` adentro de su transacción
- [x] Server action de sólo lectura: no crea pedido, no reserva, no toca `on_hand`; con rate limit igual (60/min por IP)
- [x] El total cotizado no viaja de vuelta ni se compara con nada: un precio que cambia en el medio se cobra nuevo
- [x] `ShippingQuote.matched` — la ciudad que no cae en ninguna zona cotiza la tarifa más cara **y la pantalla lo dice**
- [x] Tests: cotizar no escribe nada · cotizado === cobrado hasta el guaraní · guardarraíl de que nadie rehaga la aritmética del otro lado

## 37. Envío gratis: cuánto falta
- [x] Cuatro estados y no un número: `sin_umbral`, `falta`, `alcanzado`, `indefinido`
- [x] Sin ciudad sólo se afirma un número si **todas** las zonas coinciden; una zona sin umbral rompe la uniformidad
- [x] Pasado el umbral más bajo sin saber la zona se dice "puede que tengas", no "tenés"
- [x] El número siempre lo calcula el servidor contra `shipping_zones`

## 38. Consultar por WhatsApp desde el carrito
- [x] Server action porque `WHATSAPP_NUMBER` es del servidor; de paso el total del mensaje sale de la DB re-preciada
- [x] Reusa `comercioWaLink`; test que falla si alguien vuelve a escribir una URL de `wa.me` a mano
- [x] `location.href` y no `window.open`: después de un `await`, Safari en iPhone lo bloquea como popup

## 39. "Es un regalo"
- [x] `is_gift` NOT NULL + `gift_note` que se descarta si el pedido no quedó marcado como regalo
- [x] Visible arriba de todo en el detalle del panel: se mira mientras se arma el paquete
- [x] Copy genérica — esto es el template

## 40. "Por cobrar"
- [x] `pendiente_pago` + `vencido` juntos, del más viejo al más nuevo (`TIMESTAMPDIFF` en MySQL, sin zona horaria de por medio)
- [x] El `wa.me` en la fila y no un click más adentro
- [x] El mensaje lleva banco + total exacto + link tokenizado; sin `BANCO_*` sale sin la parte bancaria en vez de inventarla
- [x] **Nunca itemiza lo comprado**: el tipo de entrada no recibe ítems (aterriza en una pantalla de bloqueo)
- [x] **Nunca toca una reserva**: la disponibilidad se calcula en vivo; reservar para "ayudar" bloquea la unidad al resto en silencio (ARCH.md §2 y §4.1)
- [x] El armado del mensaje se mudó a `src/domain/order-messages.ts`; el detalle del pedido lo reusa

## 41. Recordar el talle elegido
- [x] `localStorage` por producto, sólo preselecciona entre las variantes ya dibujadas y con stock
- [x] `useSyncExternalStore` en vez de un efecto: sin desajuste de hidratación
- [x] Falla blandito (JSON roto, Safari privado, variante que ya no existe) y se queda con los últimos 30 productos
