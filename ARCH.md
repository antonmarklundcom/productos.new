# ARCH.md — Tienda PY: Technical Architecture

**Stack:** Next.js 16 (App Router, TS) · **Hostinger Node.js** · **Hostinger MySQL + Drizzle ORM** · Cloudinary (images + receipts) · Tailwind + shadcn/ui · Zustand · Zod
**Currency:** PYG only, stored as `BIGINT` integers. No decimals anywhere in the money path.
**Timezone:** all business logic in `America/Asuncion`; all timestamps stored UTC (`timezone: "Z"` on the pool).
**Language:** Spanish (Paraguayan voseo) UI, `dd/mm/yyyy`.

> **Why not Supabase/Vercel:** the user already pays for Hostinger with free Node.js slots and a proven deploy playbook. One host, one bill, one debugged deploy flow. See `nextjs-deploy-hostinger` skill for the deploy mechanics — this doc is the app.

---

## 1. Security model (read this first — it's short)

**The browser never talks to the database.** Every request is `browser → Next.js server → MySQL`. There is no Postgres RLS here and none is needed; MySQL doesn't have it and the attack surface it defends against doesn't exist in this topology.

The entire security model is four rules:

1. **Never trust the client about money or identity.** Prices, totals, stock and order ownership are always re-read from the DB server-side. The cart in the browser is a *wish list*, not a source of truth.
2. **Every mutating server action calls a guard first.** `requireAdmin` / `requireStaff` / `requireOwner` for admin routes (see the permission matrix below), `requireOrderAccess(orderNumber, token)` for buyer routes. Hiding a button is UX, not security.
3. **Buyers are anonymous, identified by an unguessable token.** No accounts in v1.
4. **Secrets live in `.env` on the server only.** Anything `NEXT_PUBLIC_*` is public by definition.

### How a buyer accesses their order (no login)

| Path | How |
|---|---|
| **Primary — the WhatsApp link** | `/pedido/PY-000123?t=<32-byte random token>`. Token stored in `orders.access_token`, compared with `crypto.timingSafeEqual`. This is the exact URL pasted into WhatsApp. |
| **Fallback — lookup form** | `/pedido/buscar`: order number + the phone number used on the order. Rate-limited (5 attempts / 15 min / IP), generic error message so it can't be used to enumerate orders. On success, redirects to the tokenized URL. |

Forcing registration before a first purchase is the single biggest conversion killer in PY e-commerce, so **the guest checkout above is the main path and does not change**.

Desde la FASE 2 hay cuentas de cliente **opcionales**, detrás de
`TIENDA.cuentasClientes` (apagado por defecto). Lo que hay que saber:

| | Panel | Cliente |
|---|---|---|
| Tabla | `users` | `customers` |
| Cookie | `ecom_admin` | `ecom_cliente` |
| Secreto | `SESSION_SECRET` | `CUSTOMER_SESSION_SECRET` |
| Guard | `requireAdminSession` | `requireCustomerSession` |
| Duración | 8 h | 30 días |

Tablas, cookies y secretos **separados**, no por prolijidad: si compartieran
cookie, un bug de rol convertiría a una compradora en staff. No hay ningún
camino desde `customers` hacia `/admin` — la tabla ni siquiera tiene columna de
rol.

`orders.customer_id` es nullable para siempre: lo pone la server action leyendo
**la cookie**, nunca el navegador. Un `customerId` que viajara en el input
dejaría atar la compra propia a la cuenta de cualquiera.

**`customers.phone_verified_at` y por qué existe vacía.** `/cuenta` muestra los
pedidos por `customer_id`. Los pedidos viejos de invitada que sólo matchean por
teléfono se muestran **únicamente** si ese teléfono está verificado. En esta
fase no hay proveedor de mensajería, así que la columna es siempre NULL y ese
camino está cerrado: sin la condición, registrarse tipeando el WhatsApp de otra
persona muestra su historial completo, con nombre, dirección y el token de
acceso de cada pedido. El login por OTP es lo que la va a escribir.

### Admin
`iron-session` cookie + `users` table (bcrypt hashes, `role` enum `owner | staff | vendedor`). Middleware protects `/admin/*`; **every** server action re-checks the role. No public signup route — the first owner is created by `pnpm create-owner`, el resto se dan de alta desde `/admin/usuarios` (owner-only).

**Los usuarios no se borran, se desactivan.** `order_events.actor_user_id` y `stock_adjustments.actor_user_id` apuntan a esta tabla: el historial de lo que hizo una persona tiene que sobrevivir a su salida del comercio. `is_active = false` corta el acceso igual de rápido (`authenticate()` lo rechaza) y conserva la auditoría. Dos reglas duras, validadas **adentro de la transacción y con la fila bloqueada**, no en el formulario: nadie se desactiva ni se degrada a sí mismo, y no se puede dejar la tienda sin ningún `owner` activo.

`users.last_login_at` la escribe `authenticate()` en el login exitoso y nadie más. NULL es "nunca entró", que es información distinta de "entró hace mucho".

#### Matriz de permisos

Tres roles, tres niveles de confianza. El de abajo nunca puede lo del de arriba.

| | `owner` | `staff` | `vendedor` |
|---|:---:|:---:|:---:|
| Ver pedidos y su ficha | ✅ | ✅ | ✅ |
| Preparar / despachar / entregar | ✅ | ✅ | ✅ |
| Escribir notas internas en un pedido | ✅ | ✅ | ✅ |
| Dar por cobrado, cancelar, vencer, rechazar | ✅ | ✅ | ❌ |
| Editar un pedido sin pagar (cantidades, dirección) | ✅ | ✅ | ❌ |
| Ver montos (totales, IVA, precios) | ✅ | ✅ | ❌ |
| Comprobantes: ver, aprobar, rechazar | ✅ | ✅ | ❌ |
| Productos y variantes (ABM) | ✅ | ✅ | ❌ |
| Ajustar stock a mano | ✅ | ✅ | ❌ |
| Resumen de ventas (`/admin`) | ✅ | ✅ | ❌ |
| Listado de clientes | ✅ | ✅ | ❌ |
| Registrar una devolución | ✅ | ❌ | ❌ |
| Cambiar precios en masa por porcentaje | ✅ | ❌ | ❌ |
| Exports CSV | ✅ | ❌ | ❌ |
| Gestión de usuarios del panel | ✅ | ❌ | ❌ |
| Cupones (ABM) | ✅ | ❌ | ❌ |
| Categorías (ABM) | ✅ | ❌ | ❌ |
| Zonas de envío (ABM) | ✅ | ❌ | ❌ |
| Formas de entrega (ABM) | ✅ | ❌ | ❌ |
| Datos bancarios de la tienda | ✅ | ❌ | ❌ |

Lo que el `owner` no delega tiene siempre el mismo motivo: **el error no se ve y no se puede deshacer**. Una devolución es plata que sale y nadie la revisa después; un CSV es la base de clientes del comercio en un archivo que se lleva quien renuncia; repartir accesos es repartir todo lo anterior. Los tres ABMs que se sumaron en la FASE 2 son de la misma familia: un cupón mal puesto se descubre cuando ya lo usaron cien personas, apagar una categoría le saca de la vidriera a todos sus productos de una vez, y una zona de envío con el precio viejo cobra de menos en cada pedido sin romper nada, sin dejar log y sin que nadie se entere hasta cerrar el mes. Las formas de entrega (FASE 3) entran en la misma familia y por partida doble: además del flete, deciden **con qué se puede pagar**, así que un método mal configurado habilita contra entrega en ciudades donde nadie del comercio va a ir a cobrar — y eso se descubre con el repartidor en la puerta, no en una pantalla. Los datos bancarios (FASE 2, PR T) son el caso más puro de la familia: quien puede cambiar el número de cuenta al que transfieren las compradoras desvía la facturación entera a otra cuenta sin generar un solo pedido raro — la tienda sigue andando igual y el dueño se entera cuando mira su banco.

Editar un pedido sin pagar (O16, capability `pedidos.editar`) está del lado de `staff` y no del vendedor por la misma línea que separa despachar de cobrar: la pantalla muestra totales, descuento y envío —montos que su rol no ve— y además los **cambia**.

Lo que queda afuera del `vendedor` es todo lo que mueve plata o suelta stock. Le queda el mostrador: ver qué hay que armar y marcarlo despachado — y, desde O5, dejar la nota de lo que le dijeron por teléfono (`pedidos.notas`). Una nota no mueve plata, no mueve stock, no cambia el estado y la compradora no la ve nunca; quien atiende cuando la compradora llama es justamente el vendedor, y esa nota es la que evita el segundo viaje de la moto.

**Cómo se implementa** (la tabla de arriba es la especificación, no la defensa):

| Capa | Archivo | Qué hace |
|---|---|---|
| Guards | `src/lib/session.ts` | `requireAdmin` (los tres), `requireStaff` (owner+staff), `requireOwner`. Tiran `ForbiddenError`. |
| Guards async | `src/lib/admin-guard.ts` | `requireAdminSession` / `requireStaffSession` / `requireOwnerSession` — **primera línea de cada server action**. |
| Transiciones | `src/lib/session.ts` | `assertCanTransitionTo(actor, to)`: `advanceOrder` es la misma acción para los tres roles y lo que cambia es el destino. `VENDEDOR_TRANSITIONS = preparando, enviado, entregado`. |
| Matriz de UI | `src/lib/permissions.ts` | `can(role, capability)` — decide qué botón se dibuja. **Es UX**: esconder un botón no frena nada. |

Nota sobre `VENDEDOR_TRANSITIONS`: el plan lo escribe como "sólo `pagado → enviado → entregado`", pero la máquina de estados (§3) pasa obligatoriamente por `preparando` entre `pagado` y `enviado`. Sin ese destino el rol no podría completar ni una vez el camino que se le asigna, así que los tres del despacho están adentro.

#### Quién hizo qué (`actor_user_id`)

`order_events` y `stock_adjustments` guardan **las dos cosas**:

| Columna | Qué es | Cuándo |
|---|---|---|
| `actor` | El texto de ese momento: `admin:due@tienda.py`, `cron`, `pagopar:webhook`, `buyer` | Siempre |
| `actor_user_id` | FK a `users.id` | Sólo cuando lo disparó una persona del panel |

No es redundancia. `actor` es la **verdad histórica**: no cambia si esa persona
cambia de email, y sobrevive al borrado de su usuario (la FK es
`ON DELETE SET NULL`, porque borrar a alguien no puede borrar el historial de
lo que hizo). `actor_user_id` es para **preguntar**: "todo lo que hizo el
usuario 4 en agosto" no se puede consultar contra un string sin adivinar.

Nullable en los dos sentidos: el histórico anterior a la columna **no se
backfillea** —inventar la atribución del pasado es peor que no tenerla— y hay
escrituras legítimas sin persona detrás (el cron que vence pedidos, el webhook
de Pagopar, la compradora subiendo su comprobante).

`tests/unit/atribucion.test.ts` verifica en CI que toda acción de admin que
dispare una escritura auditada pase el id que ya tiene en la mano.

`tests/unit/admin-guards.test.ts` clava esta tabla acción por acción en CI: una acción nueva que no declare su guard falla el test, y cambiar `requireOwnerSession` por el genérico en la acción de reembolsos también.

---


##### El feed: `/admin/actividad` (FASE 2, PR L)

`order_events` y `stock_adjustments` guardaban todo desde el principio, pero
repartido: los eventos de un pedido sólo se veían abriendo ese pedido, y los
ajustes de stock abriendo esa variante. `/admin/actividad` los junta en un solo
feed paginado, filtrable por persona, por tipo y por fecha. Es de **lectura
pura** —las dos tablas son append-only y nadie las edita— y lo ven `owner` y
`staff`: muestra el trabajo de cada persona con nombre y apellido, o sea
supervisión, no mostrador.

Dos decisiones que valen:

- **El orden y la paginación los hace MySQL sobre el conjunto entero**, con un
  `UNION ALL` que trae sólo `(tipo, id, fecha)`. Traer N filas de cada tabla y
  ordenarlas en memoria funciona en la página 1 y miente en la 2: con 300
  eventos y 3 ajustes en el rango, los eventos tapan a los ajustes y la segunda
  página muestra filas que en un feed real irían antes. Los detalles (número de
  pedido, SKU, nombre del producto) se buscan después y sólo para las filas de
  esa página.
- **El desempate es por `id`, no sólo por fecha.** Dos eventos escritos en la
  misma transacción comparten `created_at` al segundo; sin un segundo criterio,
  MySQL puede devolverlos en distinto orden en cada consulta y entonces una
  fila sale dos veces y otra no sale nunca.

"El sistema" es un filtro de primera clase: son las filas con `actor_user_id`
NULL —el cron, el webhook de Pagopar, la compradora subiendo su comprobante— y
es exactamente lo que se quiere mirar cuando algo cambió y nadie lo tocó. El
desplegable de personas incluye a los usuarios **desactivados**, porque revisar
qué hizo alguien antes de que le cortaran el acceso es justo la consulta que
importa.

## 2. Data model (ERD)

MySQL 8, InnoDB, `utf8mb4`. All money columns `BIGINT UNSIGNED` (integer guaraníes).

```
                              ┌──────────────┐
                              │  categories  │
                              │──────────────│
                              │ id  PK       │
                              │ slug UQ      │
                              │ name         │
                              │ parent_id FK ├──┐ self-ref
                              │ position     │◄─┘
                              └──────┬───────┘
                                     │ 1
                                     │ N
┌────────────────────┐        ┌──────┴────────────┐        ┌──────────────────────┐
│  product_images    │  N   1 │     products      │ 1    N │      variants        │
│────────────────────│◄───────│───────────────────│───────►│──────────────────────│
│ id PK              │        │ id PK             │        │ id PK                │
│ product_id FK      │        │ slug UQ           │        │ product_id FK        │
│ cloudinary_id      │        │ name              │        │ sku UQ               │
│ blur_data_url      │        │ description TEXT  │        │ label ("Talle M")    │
│ alt                │        │ category_id FK    │        │ price_pyg BIGINT     │
│ position           │        │ brand             │        │ compare_at_pyg NULL  │
└────────────────────┘        │ iva_rate  10|5|0  │        │ on_hand INT UNSIGNED │◄── stock lives here
                              │ is_active         │        │ is_active            │
                              │ published_at      │        └───────┬──────────────┘
                              │ FULLTEXT(name,    │                │ 1
                              │          descr)   │                │ N
                              └───────────────────┘      ┌─────────┴──────────────┐
                                                         │  stock_reservations    │
                                                         │────────────────────────│
                                                         │ id PK                  │
                                                         │ variant_id FK          │
                                                         │ order_id FK            │
                                                         │ qty INT                │
                                                         │ expires_at DATETIME    │
                                                         │ state: held|consumed|  │
                                                         │        released        │
                                                         │ IDX(variant_id,state,  │
                                                         │     expires_at)        │
                                                         └────────────────────────┘

┌───────────────────────────────┐
│            orders             │
│───────────────────────────────│        ┌────────────────────────────┐
│ id PK                         │ 1    N │        order_items         │
│ order_number  UQ  "PY-000123" ├───────►│────────────────────────────│
│ access_token  UQ  (32 bytes)  │        │ id PK                      │
│ status ENUM (see §3)          │        │ order_id FK                │
│ customer_name                 │        │ variant_id FK  (RESTRICT)  │
│ customer_phone  +5959XXXXXXXX │        │ name_snapshot              │
│ customer_email NULL           │        │ sku_snapshot               │
│ doc_type ENUM: RUC|CI|NINGUNO │        │ unit_price_pyg BIGINT      │
│ doc_number  (DV-validated)    │        │ qty INT                    │
│ is_consumidor_final BOOL      │        │ iva_rate TINYINT           │
│ ship_city / ship_barrio       │        │ line_total_pyg BIGINT      │
│ ship_address / ship_reference │        └────────────────────────────┘
│ ship_maps_url NULL            │
│ subtotal_pyg  BIGINT          │        ┌────────────────────────────┐
│ shipping_pyg  BIGINT          │ 1    N │         payments           │
│ total_pyg     BIGINT          ├───────►│────────────────────────────│
│ iva_10_pyg / iva_5_pyg        │        │ id PK                      │
│ payment_method ENUM           │        │ order_id FK                │
│ reserved_until DATETIME       │        │ provider: pagopar|spi|cod  │
│ invoice_status ENUM  ◄────────┼─ FASE 2│ provider_ref               │
│ invoice_cdc / invoice_pdf_url │        │ amount_pyg BIGINT          │
│ created_at / paid_at          │        │ status: pending|paid|      │
│ IDX(status,created_at)        │        │         failed|refunded    │
│ IDX(customer_phone)           │        │ raw_payload JSON           │
└───────────┬───────────────────┘        │ UQ(provider, provider_ref) │
            │ 1                          └─────────┬──────────────────┘
            │ N                                    │ 1
┌───────────┴────────────────┐                     │ N
│         receipts           │           ┌─────────┴──────────────────┐
│────────────────────────────│           │      payment_events        │
│ id PK                      │           │────────────────────────────│
│ order_id FK                │           │ id PK                      │
│ cloudinary_id (private)    │           │ provider                   │
│ mime / bytes               │           │ event_key                  │
│ uploaded_at                │           │ payload JSON               │
│ review: pending|approved|  │           │ received_at                │
│         rejected           │           │ UQ(provider, event_key) ◄──┼─ idempotency
│ reviewed_by FK users       │           └────────────────────────────┘
│ reviewed_at / note         │
└────────────────────────────┘           ┌────────────────────────────┐
                                         │      order_events          │  audit log
┌────────────────────────────┐           │ id, order_id, from_status, │
│           users            │           │ to_status, actor, reason,  │
│ id, email UQ, password_hash│           │ created_at                 │
│ role ENUM: owner|staff     │           └────────────────────────────┘
│ created_at                 │
└────────────────────────────┘           ┌────────────────────────────┐
                                         │       shipping_zones       │
                                         │ id, name, cities JSON,     │
                                         │ price_pyg BIGINT,          │
                                         │ free_threshold_pyg NULL    │
                                         └─────────────┬──────────────┘
                                                       │ referenciada por id
                                                       │ (zone_ids JSON)
                                         ┌─────────────┴──────────────┐
                                         │      shipping_methods      │
                                         │ id, slug UQ, name          │
                                         │ kind: courier|local|retiro │
                                         │ pricing: zona|fijo         │
                                         │ fixed_price_pyg NULL       │
                                         │ zone_ids JSON ([] = todas) │
                                         │ allowed_payment_methods    │
                                         │      JSON (nunca vacío)    │
                                         │ description, is_active,    │
                                         │ position                   │
                                         └────────────────────────────┘
                                   orders.shipping_method_id → este id
                                   (nullable, ON DELETE SET NULL), y
                                   orders.shipping_method_name (snapshot)
```

### Cupones y descuentos (FASE 2, PR G)

La identidad del pedido pasa a ser:

```
total_pyg = subtotal_pyg − discount_pyg + shipping_pyg
```

Reglas, todas verificadas por `pnpm reconcile`:

1. **El descuento sale del subtotal, nunca del envío.** El flete es un costo
   real; una promoción de la tienda no puede convertirlo en pérdida.
2. **El navegador manda el código, jamás el monto.** El descuento lo calcula
   `computeOrderTotals` en el servidor, contra la tabla `coupons`.
3. **Todo entero.** El porcentaje se aplica con `Math.floor` — ante medio
   guaraní, el redondeo favorece a quien paga la promoción.
4. **El descuento se topea al subtotal.** Un cupón de ₲100.000 sobre una compra
   de ₲80.000 descuenta ₲80.000: nunca deja un total negativo ni empieza a
   pagar el envío.
5. **El IVA se sigue desglosando por línea.** El descuento se reparte entre las
   líneas en proporción a lo que pesa cada una (`distributeDiscount`, con el
   resto a la línea más grande para que la suma cierre exacta) y el IVA sale de
   cada base descontada con el mismo `ivaIncluded` de siempre.
6. **El umbral de envío gratis se mira contra el subtotal sin descontar.** Si
   no, un cupón le sacaría a la compradora el envío gratis que ya tenía en
   pantalla — un cupón nunca puede empeorar el total.

`coupons.times_used` se incrementa **adentro de la transacción que crea el
pedido y con la fila bloqueada** (`SELECT … FOR UPDATE`), igual que el stock:
sin eso, dos checkouts simultáneos gastan dos veces un cupón de un solo uso. La
validación previa no decide nada por sí sola — decide la re-lectura con el
candado tomado.

El pedido guarda `coupon_code` como **snapshot** además de la FK: si el dueño
borra el cupón (`ON DELETE SET NULL`), ese pedido tiene que seguir explicando de
dónde salió su descuento.

Controles cruzados nuevos: `descuento_sin_cupon` (y su inverso),
`descuento_mayor_al_subtotal` y `usos_del_cupon_no_cuadran`.

### Money invariants
- Every `*_pyg` column is `BIGINT UNSIGNED`. **No `DECIMAL`, no `FLOAT`, ever** — guaraníes have no céntimos.
- Display: `new Intl.NumberFormat('es-PY', { style:'currency', currency:'PYG', maximumFractionDigits:0 })` → `₲ 1.234.567`.
- `line_total_pyg = unit_price_pyg * qty`, `total_pyg = subtotal_pyg + shipping_pyg` — asserted in the same server function that writes them, and by a nightly reconciliation query.
- Prices are **IVA incluido** (PY consumer convention). Included IVA per line = `round(line_total * rate / (100 + rate))`, summed into `iva_10_pyg` / `iva_5_pyg`. Never added on top of the displayed price.

#### Devoluciones: el ledger, no un estado (O7)

Hasta O7 una devolución era `payments.status = 'refunded'` y nada más: no
quedaba ni el monto ni quién la autorizó, y **un comercio que devuelve una
remera de un pedido de tres no tenía dónde escribirlo**. Ahora cada devolución
—total o parcial— es una fila en `refunds`, append-only como el resto de la
auditoría, y `payments.refunded_pyg` es el acumulado.

El acumulado es una denormalización deliberada: la decisión "¿puedo devolver
₲50.000 más?" se toma con la fila bloqueada en una sola transacción, y un
`SUM()` sobre el ledger adentro de ese lock es exactamente la carrera que el
lock existe para evitar. El precio es que se puede separar del ledger, y por
eso `pnpm reconcile` verifica tres igualdades en cada corrida:

| Invariante | Qué se rompe si falla |
|---|---|
| `payments.refunded_pyg = Σ refunds.amount_pyg` | El próximo reembolso se calcula contra un número que no es la verdad. |
| `refunded_pyg ≤ amount_pyg` | Se devolvió más de lo que entró. |
| `status = 'refunded' ⇔ refunded_pyg = amount_pyg` | Un pago marcado devuelto al que le falta plata en el ledger, o uno con todo devuelto que sigue figurando como cobrado — y por lo tanto aparece en los controles de "plata que entró". |

**Un parcial no mueve el estado del pedido.** Es su caso de uso: la compradora
se queda con dos de las tres remeras y ese pedido sigue su curso. Deja igual su
rastro en la historia del pedido, con `from = to` y el prefijo
`devolución parcial ₲`, y el control de aristas imposibles reconoce ese prefijo
en vez de reportarlo (la constante la comparten `payment-recovery.ts` y
`reconciliation.ts`, justamente para que no se puedan separar). Sólo el
movimiento que **completa** el total marca `payments.status = 'refunded'`.
Con `refundPayment({ allowSettled: true, ... })`, desde la ficha y sólo para
owner, lleva un pedido `pagado`, `preparando`, `enviado` o `entregado` a
`reembolsado`, con el motivo `pago devuelto: <reason>`. El ledger, el pago y
la transición se escriben en una sola transacción. `allowSettled` es `false`
por defecto: la lista de pagos colgados sigue rechazando el total si el
pedido revivió. Para pedidos fuera de la cadena del cobro, el total sigue
llevando a `cancelado`. **Sólo se entra a `reembolsado` por `refundPayment`**:
`advanceOrder` lo rechaza y los botones de cambio de estado no lo ofrecen.
El stock no vuelve solo; la mercadería devuelta se repone con un ajuste de
stock manual, auditado.

#### `price_adjustments`: por qué los precios también tienen auditoría (O7)

`variants.price_pyg` es una sola cifra que se pisa. Sin una fila por cambio, la
pregunta "¿por qué esta variante vale ₲180.000 si la semana pasada valía
₲150.000?" no tiene respuesta.

Importa sobre todo por la acción masiva: subir un 20 % a doscientas variantes
de un click es la operación más fácil de arrepentirse del panel. El cálculo es
entero y con el redondeo explícito (`precio × (100 + %) / 100`, multiplicando
antes de dividir, redondeado a ₲100 o ₲1.000), **nunca da ₲0** —el piso es el
propio redondeo— y `compare_at_pyg` no se toca: si el precio tachado subiera
con el resto, el descuento que muestra la vidriera sería siempre el mismo y no
significaría nada.

### Columnas de la compra que no son plata

`orders` guarda además tres cosas que no entran en la cuenta pero se deciden
en el mismo formulario:

| Columna | Por qué es así |
|---|---|
| `marketing_opt_in` **nullable** | Tres estados, no dos: `NULL` = no se preguntó, `false` = dijo que no, `true` = aceptó. Un `NOT NULL DEFAULT false` mezcla el primero con el segundo, y el consentimiento es lo único que no se puede completar retroactivamente. `marketing_opt_in_at` guarda cuándo contestó. **El MVP no manda nada**: no hay proveedor de mensajería en el stack. |
| `is_gift` **NOT NULL** | Acá `false` y "no contestó" sí son lo mismo: un pedido que nadie marcó no es un regalo. `gift_note` sólo se escribe si `is_gift`, para que destildar la casilla no deje un mensaje viejo colgado. |
| `tracking_carrier` / `tracking_code` / `tracking_url` **nullables** (O5) | El seguimiento del envío. Se escriben **adentro de la transacción de `transitionOrder`** y sólo con destino `enviado`; cualquier otro destino con tracking tira `TrackingNotAllowedError`. Partirlo en un `UPDATE` aparte crearía el estado imposible de un pedido despachado sin guía —o con la guía del envío anterior— cuando la segunda escritura falla. Los tres pueden faltar por separado: una moto propia no tiene número de guía y un courier chico no da link. La cadena vacía entra como `NULL`, para que ningún lector tenga que acordarse de tratarla como ausente. |

#### `order_notes` — lo que el mostrador anota (O5)

Tabla propia, append-only, **nunca visible para la compradora**: "llamó, pasa a
retirar el jueves", "el timbre no anda". Hoy eso vive en el grupo de WhatsApp
del local y se pierde.

Tabla y no un `order_events` con `from = to`, porque **una nota no es una
transición**: meterla ahí obligaría a que todo lo que lee la historia de
estados —`pnpm reconcile`, la máquina de estados de §3, el timeline del
comprador— aprendiera a ignorar filas que no son cambios de estado, y bastaría
con que uno se olvidara para que una nota apareciera como un movimiento del
pedido. Donde sí se mezclan es en `/admin/actividad`, que las suma como tercer
origen del `UNION ALL` (`nota`) con el mismo desempate por `id`.

Cuerpo 1..1000 trimmed, `actor` + `actor_user_id` como el resto de la
auditoría, `ON DELETE CASCADE` contra el pedido. El dominio
(`src/domain/order-notes.ts`) re-lee que el usuario siga activo aunque el
guard ya lo haya hecho: la cookie firmada sigue siendo válida hasta que expira,
así que a quien le cortaron el acceso hace un minuto todavía le anda la sesión.

### Qué se ve en la vidriera (FASE 2, PR J)

Un producto sale a la calle cuando se cumplen **tres** condiciones, no dos:
`products.is_active`, `products.published_at IS NOT NULL` y
`categories.is_active` de la categoría a la que pertenece. Eso es el filtro
`PUBLISHED()` de `src/db/queries.ts`, y lo comparten la home, la página de
categoría, la ficha de producto, el buscador, el filtro de marcas y el sitemap.
Toda consulta que lo use tiene que hacer `innerJoin(categories)`.

La tercera condición entró con el ABM de categorías. Antes el filtro miraba
sólo el producto, y desactivar una categoría dejaba la tienda incoherente: la
categoría desaparecía del menú y `/categoria/<slug>` devolvía 404, pero sus
productos seguían apareciendo en la home, en el buscador y en el sitemap, con
una miga de pan que llevaba derecho a ese 404. Mientras la tabla la escribía
sólo el seed casi no pasaba; con un botón en el panel iba a pasar el primer
día.

Consecuencia para el dueño, y la pantalla se la dice con el número exacto antes
de confirmar: **apagar una categoría apaga todos sus productos.** No borra
nada — los productos quedan como estaban y vuelven solos al reactivarla.

### Destacados, categorías con foto y "avisame cuando haya stock" (O6, O7)

Tres piezas chicas de schema, agregadas por O5/O6/O7, que no tienen entidad
propia en el diagrama de arriba porque son columnas sueltas o tablas sin
relaciones nuevas:

- **`products.is_featured`** (bool, default `false`, índice
  `(is_featured, published_at)`): lo elige el dueño a mano desde el panel.
  `getFeaturedProducts(limit)` los devuelve; si no hay ninguno, cae al mismo
  criterio que la home de siempre (`getCatalog({ limit })`, orden por
  posición de categoría y nombre) — **no** "los más nuevos" a secas, para que
  una tienda que recién trae la migración no vea moverse su portada.
- **`categories.description` / `image_cloudinary_id` / `image_alt`**: texto y
  foto opcionales de la página de categoría (`f_auto,q_auto`, folder
  `categorias/` bajo el prefijo de Cloudinary de la tienda). Sin ninguno de
  los tres, la página es bit a bit la de antes.
- **`variants.reorder_point`** (`int unsigned` NULL): umbral de "stock bajo"
  por variante; `NULL` usa el default global (3). `lowStockVariants` lo
  respeta con `COALESCE` en el SQL — y con `CAST(... AS SIGNED)` en la
  comparación, porque `on_hand - reorder_point` en aritmética sin signo tira
  `ER_DATA_OUT_OF_RANGE` en MySQL 8 apenas el resultado sería negativo (que es
  justo el caso que la consulta busca; MariaDB no lo reproduce — ver
  `KNOWN-ISSUES.md`).
- **`stock_alerts`** (`id`, `variant_id` FK cascade, `phone`, `created_at`,
  `notified_at` NULL; `UNIQUE(variant_id, phone)`): "avisame cuando haya
  stock" de la vidriera. `subscribe()` rechaza si la variante **ya** tiene
  disponibilidad (no es un embudo de marketing, es un aviso puntual);
  `notifyBackInStock()` marca `notified_at` **antes** de mandar el WhatsApp
  (mismo patrón que `login-tokens`), así un envío que falla no se reintenta
  ni duplica. Se dispara post-commit cuando `on_hand` cruza de 0 a > 0
  (`adjustStock`, importación de catálogo) y además lo barre el cron del
  resumen diario, para el caso de una reserva vencida que liberó stock sin
  ningún ajuste manual detrás. Purga a los 90 días desde `runMaintenance`.

### Zonas de envío: quién las escribe (FASE 2, PR K)

`shipping_zones` la edita el `owner` desde `/admin/envios`, y el dominio
sostiene tres reglas que existen porque cada una es una forma de perder plata
sin enterarse:

- **Una ciudad va en una sola zona.** `quoteShipping` se queda con la primera
  coincidencia por `position`, en silencio: con "Luque" en dos zonas, el flete
  depende del orden de las filas y el dueño que corrigió el precio en la zona
  equivocada no lo sabe nunca.
- **Una zona sin ciudades es válida**: nunca matchea exacto, así que sólo puede
  salir sorteada como "la más cara", que es justo el comodín que cubre el
  interior.
- **No se puede apagar la última zona activa.** Sin ninguna, `quoteShipping`
  devuelve `sin_zonas` con envío ₲0 — la tienda pasa a regalar el flete de todo
  el país sin que ningún cartel lo diga. Que una tienda recién clonada arranque
  así está bien; que una que cobra ₲35.000 llegue ahí de un clic, no.

Editar una zona **no toca los pedidos en vuelo**: el flete quedó copiado en
`orders.shipping_pyg` cuando se creó cada pedido.

### Métodos de envío: cómo se entrega decide con qué se paga (FASE 3)

`shipping_zones` contesta *cuánto sale llegar a esa ciudad*. Le faltaba la otra
mitad: **de qué formas se entrega**. Hasta acá el medio de pago era un enum
suelto del pedido, sin relación con la entrega, así que "contra entrega" quedaba
ofrecido en todo el país — incluido el interior, donde nadie del comercio va a
estar en la puerta para cobrar. Y un comercio que tiene courier nacional *y*
moto propia *y* retiro en el local no podía modelar ninguna de las tres.

`shipping_methods` es una fila por forma de entregar:

| Columna | Qué decide |
|---|---|
| `kind` (`courier` \| `local` \| `retiro`) | La regla del dominio. `retiro` no viaja: ignora zonas y cuesta ₲0 siempre. |
| `pricing` (`zona` \| `fijo`) + `fixed_price_pyg` | De dónde sale el precio. `zona` reusa `shipping_zones` **con su umbral de envío gratis**; `fijo` cobra su tarifa plana, sin umbral (una tarifa de barrio no depende del monto de la compra). |
| `zone_ids` JSON | A qué zonas aplica. **Vacío = todas las zonas activas**, que es el default. |
| `allowed_payment_methods` JSON | El subconjunto de `PAYMENT_METHODS` que habilita. **Nunca vacío.** |

**La tabla vacía no es un caso borde: es el estado de toda tienda ya clonada.**
Sin filas, `quoteShippingMethods` devuelve un único método implícito
(`id: null`, "Envío a domicilio") con el precio de la zona y los tres medios de
pago — o sea el checkout exacto de antes. Nadie tiene que configurar nada para
seguir vendiendo igual, y el checkout ni siquiera dibuja la pregunta nueva
mientras la única opción sea la implícita.

Tres reglas que valen la pena:

- **Una ciudad cotizada "por descarte" no habilita la moto del barrio.** Un
  método con `zone_ids` declarados aplica sólo si la ciudad cayó en una de esas
  zonas **de forma exacta**. Cuando la ciudad no está en ninguna lista se cobra
  la tarifa más cara (`ShippingQuote.match = "mas_cara"`), y eso no la convierte
  en una ciudad donde el comercio reparte: ofrecerle contra entrega ahí es
  prometer una visita que nadie va a hacer.
- **El precio del envío no depende de cómo se paga.** Si el navegador no eligió
  método, `selectShippingMethod` toma **el primero por `position`**, no "el que
  acepte el medio de pago que mandó". Si ese primero no acepta ese pago, el
  pedido no se crea y se dice por qué — mucho mejor que cobrar un flete distinto
  en silencio.
- **Quedarse sin métodos activos es legítimo**, al revés que con las zonas. Sin
  ninguno se vuelve al implícito, que cobra la zona: no se regala nada. Por eso
  no hay regla de "el último activo".

`createOrder` re-valida el método **adentro de su transacción** (activo, aplica
a la ciudad, acepta el `payment_method` elegido) y re-cotiza el precio del lado
del servidor. Lo que viaja del navegador es un **id**, nunca un monto; lo que se
cobra sale de `computeOrderTotals`, la misma función que corrió la cotización
(§1 regla 1). Un método inválido es un error del dominio
(`ShippingMethodRejectedError`, `PaymentMethodNotAllowedError`), no un 500.

El pedido guarda `shipping_method_id` (nullable, `ON DELETE SET NULL`) **y**
`shipping_method_name` como snapshot, con el mismo criterio que `coupon_code`:
si el dueño renombra o borra "Moto Asunción", ese pedido tiene que seguir
diciendo cómo se entregó. El precio sigue viviendo donde siempre,
`orders.shipping_pyg`, y editar un método **no toca los pedidos en vuelo**.

Se configura desde `/admin/envios` (owner-only, misma pantalla que las zonas) y
sale en el aviso de pedido nuevo al comercio y en la ficha de `/admin/pedidos`.
`pnpm preflight` avisa —sin bloquear, y es el único de sus controles que lee la
base— si hay métodos activos cuyas zonas están todas apagadas: están prendidos,
se ven prendidos, y no le aparecen a nadie.

### Datos bancarios: dos fuentes con precedencia (FASE 2, PR T)

A dónde transfieren las compradoras vivía sólo en `BANCO_*` del entorno, y eso
hacía que corregir un dígito del número de cuenta fuera un cambio en el hPanel
más un Redeploy a mano — una llamada al desarrollador para arreglar el dato del
que depende el método de pago principal de la tienda.

Ahora sale de `getDatosBancarios()` (`src/lib/comercio.ts`), que lee **en este
orden**:

1. La tabla `bank_details` — singleton con el patrón de `setup_state` (una sola
   fila, `id` siempre 1, columnas explícitas), que el `owner` edita desde
   `/admin/banco`.
2. Los `BANCO_*` del entorno, de fallback.

El orden es lo que hace que una tienda que ya está vendiendo no cambie en nada
el día que actualiza el template: tabla vacía ⇒ manda el entorno.

**Esto es copy de display, no plata.** No entra en `computeOrderTotals` ni en
ningún total: lo consumen la página del pedido, `order-messages.ts` y el
listado de "por cobrar". Cambiarlo cambia lo que una pantalla dice, nunca
cuánto paga alguien.

Dos reglas en el dominio (`src/domain/admin-bank.ts`), las dos porque **una
cuenta a medias es peor que ninguna**:

- **Todos-o-nada** en los cinco campos de texto. Media cuenta cargada mostraría
  un banco sin número, y esa transferencia se hace mal. Sin los cinco, la
  página avisa que faltan los datos en vez de inventar — el criterio de siempre.
- **El RUC se valida con su dígito verificador** (`validateRuc`, módulo 11 de la
  DNIT). Es el único de los cinco que se puede verificar solo, y un RUC mal
  tipeado no rompe nada de este lado: rompe la transferencia de otra persona, en
  el banco.

El QR del SPI se sube a un folder **público** de Cloudinary (`banco/`), nunca a
`comprobantes/`, que es `authenticated` y sólo se sirve firmado. El tipo de
archivo se valida por los bytes, igual que las fotos de producto.

`pnpm preflight` sigue siendo env-only y **no toca la base a propósito** (se
corre en el servidor de producción), así que desde ahí los `BANCO_*` vacíos
pasaron a **advertir** en vez de bloquear: pueden estar legítimamente vacíos con
la tabla cargada. El aviso que sí sabe es el cartel de `/admin`, que lee la base
y aparece cuando no hay datos en ninguna de las dos fuentes.

### La cotización de envío no cobra

`computeOrderTotals(items, ciudad, { executor, shippingMethodId })` es **la**
cuenta del pedido: subtotal re-preciado, flete del método de envío elegido —que
por default sale de la zona—, IVA incluido del flete, total. La usan dos caminos
y a propósito no hay un tercero:

1. `quoteCartShipping` — server action pública, sólo lectura. No crea pedido,
   no reserva stock, no toca `on_hand`. Es lo que ve la compradora antes de
   confirmar.
2. `createOrder` — la vuelve a llamar **adentro de su transacción**, con el
   executor de esa transacción, y cobra lo que salga de ahí.

El total cotizado **no se cobra nunca**: es la misma función corriendo dos
veces, y lo que se cobra es lo que sale de la segunda (§1 regla 1).

Lo que sí viaja de vuelta es el total que ella tenía **en pantalla**, para
poder comparar. Si no coincide con el recalculado, `createOrder` tira
`TotalChangedError` adentro de la transacción y antes de escribir: no queda
pedido, ni reserva, ni número de pedido consumido. La pantalla muestra el
número nuevo y ella confirma otra vez. El número del navegador se compara,
nunca se cobra — mismo criterio que `expectedPrices` en `priceCart`.

Existe porque el umbral de envío gratis hace que el total **no** sea monótono
en el precio: un producto de ₲500.000 con envío gratis desde ₲500.000 que el
comercio baja a ₲490.000 cae abajo del umbral y pasa a pagar flete, o sea
₲515.000. Producto más barato, total más caro. Cobrar eso sin avisar es
indistinguible de un error de la tienda.

El progreso hacia el envío gratis (`free-shipping.ts`) devuelve un estado y no
un número, porque `free_threshold_pyg` es nullable y por zona: antes de que la
compradora ponga su ciudad puede no existir ninguna respuesta verdadera, y
"indefinido" se dibuja con la aclaración en vez de con una promesa.

### Stock: holds, not decrements
`on_hand` is the physical count and only changes when money confirms. What the storefront shows is:

```
disponible(variant) = on_hand − SUM(reservations.qty WHERE state='held' AND expires_at > NOW())
```

A **hold** is placed when the order is created (45 min for Pagopar, 24 h for bank transfer, 7 days for COD). COD money arrives at the door, days after the order; a 24 h hold expired orders whose packages were already prepared. The hold still expires after 7 days so forgotten orders cannot block stock forever. Availability is computed live, so a failed cron job can never strand inventory. A nightly job only garbage-collects old rows.

Overselling is prevented at the write: the reservation insert runs inside a transaction that does `SELECT … FOR UPDATE` on the variant row and re-checks availability before committing.

---

### Errores del dominio: código, no prosa (FASE 2, PR S)

Los errores que **una persona lee** se lanzan con una clave del catálogo, no
con su texto: `throw new CheckoutError("error.checkout.carritoVacio")`. La base
`DomainError` (`src/domain/errors.ts`) arma el `message` con esa clave, así que
todo lo que ya leía `error.message` —los formularios, los logs,
`adminActionError`— sigue funcionando sin cambios, y además queda el `code`
para poder preguntar *qué* pasó sin comparar prosa.

El motivo no es estético: con la prosa adentro de cada `throw`, los textos que
la compradora ve quedan repartidos por veinte archivos de dominio, entre
transacciones y bloqueos de fila, y quien traduce tiene que ir a buscarlos ahí.

**Lo que no se traduce**: los errores que sólo lee un desarrollador siguen
siendo `Error` a secas con su mensaje técnico. `qty inválida para la variante
3` o `Transición inválida para el pedido 12: pagado → pendiente_pago` no van a
un catálogo — nadie los va a leer en guaraní, y un stack trace tiene que decir
exactamente qué pasó.

## 3. Order state machine

```
                    ┌──────────────────────────────────────────┐
                    │                                          ▼
  pendiente_pago ──────────────► pagado ──► preparando ──► enviado ──► entregado
      │      │   ▲                  ▲
      │      │   │ (admin aprueba)  │
      │      ▼   │                  │
      │  esperando_verificacion ────┘        ← comprobante subido (SPI/QR)
      │      │
      │      └──► rechazado ──► esperando_verificacion (nuevo comprobante)
      │               ├──► pagado                 (cobrado desde el panel)
      │               ├──► vencido                (cron, reserved_until pasado)
      │               └──► cancelado              (manual)
      ▼
   vencido   ◄── pasó reserved_until sin pago
      │
      └──► cancelado                          (manual, en cualquier estado pre-pago)
       pagado | preparando | enviado | entregado ──► reembolsado
                                    (sólo refundPayment, pasando por el ledger)
```

Un pedido `rechazado` conserva su reserva para volver a subir un comprobante
(`→ esperando_verificacion`) o darlo por cobrado desde el panel (`→ pagado`).
También vence por cron al pasar `reserved_until` (`→ vencido`, igual que
`pendiente_pago`) o se cancela manualmente (`→ cancelado`); ambos liberan la
reserva. No vuelve a `pendiente_pago`.

Las cuatro aristas a `reembolsado` sólo se recorren desde `refundPayment`,
al completar el total en el ledger (sección 2). No son cambios de estado
directos del panel. Para un pedido ya despachado, la devolución no repone
stock: la mercadería que vuelve requiere un ajuste manual, auditado.

Every transition goes through **one** function, `transitionOrder(orderId, to, actor, reason)`, which:
1. opens a transaction and `SELECT … FOR UPDATE` on the order,
2. rejects any edge not in the allow-list (so a duplicate or late webhook can never drag `enviado` back to `pagado`),
3. on `→ pagado`: marks reservations `consumed` and decrements `variants.on_hand` in the same transaction,
4. on `→ vencido | cancelado`: marks reservations `released`,
5. on `→ enviado`: escribe el seguimiento del envío (`tracking_carrier`,
   `tracking_code`, `tracking_url`) en el **mismo** `UPDATE` que el estado,
6. writes an `order_events` row.

No UI or route ever runs a raw `UPDATE orders SET status = …`.

**La arista a `enviado` es la única que acepta `options.tracking`** (O5).
Cualquier otro destino con tracking puesto tira `TrackingNotAllowedError` antes
de abrir la transacción: cargar una guía al cancelar un pedido no es una
operación con sentido, y aceptarla en silencio deja el dato escrito donde nadie
lo va a mirar hasta que aparezca en el lugar equivocado. El aviso ENVIADO a la
compradora (`order-customer-notifications.ts`) lee esas tres columnas de la
fila ya commiteada y suma courier, guía y link cuando existen; sin ninguno de
los tres, el texto es exactamente el de antes de O5.

**Editar un pedido no es una transición** (O16). `editPendingOrder`
(`src/domain/edit-order.ts`) cambia cantidades, dirección, envío y totales de
un pedido que sigue en `pendiente_pago`: el estado no se mueve, así que **no**
pasa por `transitionOrder` y `orders.status` conserva su único escritor. Lo que
deja es una fila en `order_events` con `from = to` y el prefijo constante
`EDIT_ORDER_REASON_PREFIX`, el mismo mecanismo del reembolso parcial — y, como
aquél, `reconcile` lo reconoce por ese prefijo para no reportarlo como arista
imposible. Los totales que escribe los sigue verificando `findTotalMismatches`
con la identidad de siempre: `total = subtotal − descuento + envío`.

Sólo se edita lo que todavía no se cobró: `pendiente_pago`, sin un pago `paid`,
y **nunca con tarjeta** — ahí el monto ya está comprometido en Pagopar y la
verificación de monto del webhook (§4) es la red que atrapa un cobro que no
coincide; editar el total a mano sería romperla. Las cantidades sólo bajan o se
quitan (subir es un pedido nuevo), el `unit_price_pyg` que la compradora vio no
se toca, `reserved_until` no se extiende, y las reservas de stock bajan con las
líneas para que lo que ya no se vende vuelva a estar disponible.

**El cupón se re-valida contra el subtotal nuevo, pero sólo por el mínimo de
compra.** Si con las cantidades nuevas el pedido ya no llega al mínimo, el
cupón se quita, el descuento vuelve a 0 y la pantalla lo dice (`couponRemoved`)
— nunca en silencio. Lo que **no** se re-chequea es vigencia ni usos: ese
control responde "¿se le puede dar este cupón a alguien ahora?", y acá la
pregunta es otra; empezando por el uso que este mismo pedido ya consumió, le
subiría el total a una compradora que sólo pidió mandar una remera menos. Cuando
el cupón se quita por mínimo de compra, **se devuelve el uso**: se bloquea la
fila del cupón y se decrementa `times_used` sin bajar de cero, en la misma
transacción. Si la fila ya no existe, no hay nada que decrementar. Así coincide
con reconcile, que cuenta los pedidos que siguen apuntando al cupón.

---

## 4. Pagopar v2 flow

```
Browser            Next.js (Hostinger)         Pagopar               MySQL
   │                     │                       │                    │
   │ POST /api/orders    │                       │                    │
   │────────────────────►│ re-price cart from DB (client is ignored)   │
   │                     │──────── tx: order + items + holds ─────────►│
   │                     │                       │                    │
   │                     │ token = sha1(PRIVATE_KEY + order_number + total_pyg)
   │                     │ POST /api/comercios/2.0/iniciar-transaccion │
   │                     │──────────────────────►│                    │
   │                     │  { hash_pedido, ... } │                    │
   │                     │◄──────────────────────│                    │
   │                     │──────── payments row (provider_ref = hash_pedido)
   │ redirect → checkout │                       │                    │
   │◄────────────────────│                       │                    │
   │ ────────────────── paga ──────────────────► │                    │
   │                     │                       │                    │
   │                     │  POST /api/webhooks/pagopar                 │
   │                     │◄──────────────────────│  (puede llegar antes
   │                     │                       │   del redirect, y N veces)
   │                     │ 1. guard token en querystring               │
   │                     │ 2. expected = sha1(PRIVATE_KEY + hash_pedido)
   │                     │ 3. timingSafeEqual vs token recibido        │
   │                     │ 4. INSERT IGNORE payment_events (provider,event_key)
   │                     │    affectedRows === 0 → replay → 200 y salir │
   │                     │ 5. verificar amount === orders.total_pyg    │
   │                     │ 6. transitionOrder(→ pagado)                │
   │                     │ 7. responder 200 en el formato que espera Pagopar
   │ /pedido/[n] hace polling → el estado cambia a "pagado" solo       │
```

**Hash rules that will cost you an afternoon if ignored:**

- `sha1(private_key + order_id + total)` — `total` must be the **integer PYG string exactly as sent**: `"150000"`. Every JS money habit pushes you toward `toFixed(2)`; `"150000.00"` produces a completely different digest and Pagopar rejects it.
- `order_id` = `orders.order_number` (immutable, human-readable), never an internal id.
- The webhook token is `sha1(private_key + hash_pedido)` — a **different input**. Two separate helpers, two unit-test vectors, no shared function.
- Compare with `crypto.timingSafeEqual` on equal-length buffers.
- **The webhook response envelope Pagopar expects has changed between doc revisions.** Confirm against the current v2 docs and pin an integration test against the sandbox during PR #3. Do not trust any remembered shape, including the one in this document.
- Respond within ~5 s or Pagopar retries. Do the slow work after responding, not before.
- Register the webhook URL over **HTTPS on the real domain** — Hostinger provides the certificate; Pagopar will not call `localhost` (use a tunnel in dev).

### 4.1 The payment that arrives after the order died

The cron cancels unpaid orders once `reserved_until` passes. Pagopar's notice can
land a second later — the buyer paid at 14:59:58 and the sweep ran at 15:00:00.
Both systems behaved correctly and the money is now in the merchant's account for
an order that is `vencido`. This is not a rare edge case; with a 45-minute hold on
card payments it will happen.

**The policy, in the order the rules are applied:**

1. **The payment is recorded before anything else, and the recording is never
   rolled back.** `payment_events` gets the raw notice, `payments` goes to `paid`.
   Whatever happens to the order afterwards, the transaction commits. Losing the
   record of a payment that really happened is the only unrecoverable outcome
   here: everything else can be fixed by a human who can *see* what occurred.
2. **The order revives only if the goods are still there.** `vencido → pagado` is
   a legal edge in the state machine, but entering `pagado` re-secures stock first
   (see below). If the last unit was sold while the order was expired, the
   transition throws, the order stays `vencido`, and nothing is oversold.
3. **The owner is told, without depending on a flag anyone has to remember to
   set.** `findUnmatchedPayments()` derives the list from the data — a `paid`
   payment whose order is not in `pagado|preparando|enviado|entregado|reembolsado`
   — and the admin dashboard shows it at the top in red. A boolean column would
   have been cheaper and would eventually drift; a query over the two tables that
   already hold the truth cannot.
4. **A `cancelado` order never revives automatically.** A person cancelled it on
   purpose, so the software does not overrule them. The money still shows up in
   the same list, for the same refund.

**What the owner can do about it.** The list is not read-only: each row carries
the two actions it implies. **Retry** re-runs the revival — `vencido → pagado`
through `transitionOrder`, which re-secures stock first, so it either revives
the order or leaves everything exactly as it was. It is safe to press as often
as the merchant restocks; a failed retry writes nothing. **Mark as refunded**
sets `payments.status = 'refunded'` and moves the order to `cancelado` with the
reason in `order_events`, in one transaction — the software does not move money,
it records that the owner already did.

Both re-read payment and order under `SELECT … FOR UPDATE` instead of trusting
the id the form submitted. The screen was rendered minutes ago and anything
could have happened since: the other owner already refunded it, the cron moved
the order, a sale took the last unit. Deciding on what the page said is deciding
on stale data. Concretely, a refund is refused if the order came back to life in
the meantime, and a retry on an already-revived order is a no-op rather than an
error — two owners pressing the same button at the same time produce exactly one
stock decrement and one `order_events` row.

**Why the stock re-check lives inside `transitionOrder` and not in the webhook.**
There are three ways into `pagado` — the Pagopar webhook, the owner approving a
transfer receipt, and the manual button in the panel — and any of them can be the
one that runs after the goods are gone. A check placed in the caller is a check
someone will forget to copy into the fourth caller. Putting it in the one function
that owns the `pagado` edge makes it structurally impossible to decrement
`on_hand` for stock that no longer exists.

**The reverse case falls out of the same rule.** An order can also still be
`pendiente_pago` with its reservation rows technically `held` but past
`expires_at`, because the cron has not run yet. Availability is computed live
(§2), so the storefront has already been offering that unit to everyone else.
Consuming those rows would decrement `on_hand` on the strength of a promise that
expired. `secureStockForPayment()` therefore releases the order's stale holds
first and re-acquires what it needs against live availability, taking
`SELECT … FOR UPDATE` on the variant and on the competing reservation rows. Either
it can secure every line or it secures none and throws — it verifies the whole
order before it writes anything, so a half-reserved order is not a state that can
exist.

**What the buyer sees.** A recovered order looks like any other paid order; the
`order_events` row records why (`pago tardío recuperado`). An unrecoverable one
stays `vencido` on the buyer's page, which is honest — the merchant owes them a
refund, and pretending the order is alive would be worse than saying nothing.

---

## 5. Manual SPI / QR + WhatsApp stream (the zero-fee path)

1. Order created → `pendiente_pago`, `reserved_until = NOW() + 24h`.
2. Confirmation page shows: Banco, Titular, RUC, nro. de cuenta, **the exact ₲ total with a copy button**, and the SPI QR image. Copy buttons on every field — typing an account number on a phone is where orders die.
3. Buyer uploads the comprobante → server validates MIME + size → uploads to a **private Cloudinary folder** (signed delivery URLs only) → `receipts` row → `esperando_verificacion`.
4. One-tap WhatsApp button: `https://wa.me/595XXXXXXXXX?text=` + `encodeURIComponent(message)`. Message contains order number, total, and the tokenized order URL. Keep under ~1500 chars — long deeplinks truncate on iOS.
5. Owner checks the receipt against the bank statement in `/admin`, clicks **Aprobar** → `transitionOrder(→ pagado)`, which also writes the `payments` row (below).

**Contra entrega (COD)** starts in `pendiente_pago`, minus the receipt: the owner confirms on delivery. Its reservation lasts **7 days**, because money arrives at the door days after ordering; 24 h expired orders with packages already prepared. Forgotten orders still expire after 7 days to release stock. COD receives no payment reminder because nothing is due before delivery.

### 5.2 The owner hears about the order from the server, not from the buyer

Step 4 above is the buyer's choice: a `wa.me` link she may or may not tap. That
made the shop's only reliable notification a human habit — a paid transfer could
sit unseen for a day. So the server also sends its own message
(`src/domain/order-notifications.ts`), through the same `MessageSender` as the
login code, to the shop's `WHATSAPP_NUMBER`, with a second Meta template
(`WHATSAPP_CLOUD_TEMPLATE_PEDIDO_NUEVO`).

Three properties, in order of importance. **It cannot fail or delay a
checkout**: it is fired after the order is committed, without `await`, with its
own timeout, and `notifyOwnerNewOrder` never throws — the buyer's order can
never be lost because Meta is down. **Missing variables switch it off**, like
every other integration here. And **it always leaves a trail**: sent or failed,
a row lands in `order_events` (`actor: "sistema"`, `from_status = to_status`, reason
`aviso_dueno_enviado` / `aviso_dueno_fallido: …`), because a notification that
disappears silently is worse than none — the owner would read "no messages" as
"no orders".

#### 5.2.1 The buyer hears back too (`order-customer-notifications.ts`)

O2 only told the merchant. The buyer never got anything from the server —
only the `wa.me` links she could choose to tap. `notifyCustomerOrderEvent`
closes that gap with three notices, one per moment she actually cares about:
**confirmado** (right after the order is written — same moment `createOrder`
commits, so it fires from `createOrder` itself, not from `submitCheckout`),
**pagado** (entering `pagado`, whichever of the three ways money arrives:
approved transfer, Pagopar, or COD), and **enviado** (entering `enviado`).
Same rules as the owner's aviso — never blocks or delays the write that
triggers it, missing template switches that one notice off, every attempt
leaves an `order_events` row (`aviso_cliente_<kind>` / `aviso_cliente_<kind>_fallido: …`)
— plus one more: **each of the three templates is required even for the dev
console sender.** The owner's aviso is foundational (any channel is fine, so
dev can see it print with nothing but `WHATSAPP_NUMBER` configured); these
three are independent per-store decisions ("do I want a WhatsApp when I
confirm? when I get paid?"), so a store that configured none of them has to
behave exactly like a store that predates this feature, in dev too — nothing
printed to the console, nothing written to `order_events`.

**Where the hook lives.** `pagado` and `enviado` are entered through
`transitionOrder()` from several unrelated callers (the admin panel, receipt
approval, Pagopar's webhook, the late-payment recovery flow) — hooking each
caller individually is exactly the kind of thing a fifth caller forgets, so
the notice fires once, centrally, right after `transitionOrder`'s own write
resolves. When `transitionOrder` runs nested inside a caller's own
transaction (`options.executor`), that moment is a hair before the caller's
transaction actually commits; `notifyCustomerOrderEvent` never touches that
transaction's connection (it opens its own). Its ordinary `SELECT` on `orders`
does not block on the row lock and can read the previous snapshot, so the
target status is passed as a parameter for the notice's `order_events` row.
Notices use `from_status = to_status` and the shared `aviso_` reason prefix;
reconciliation also recognizes historical notices with `from_status NULL`. `confirmado` has
no transition to hook (the order is born in `pendiente_pago`), so it fires
from `createOrder()` once its own transaction has actually returned —
after the real commit, no caveat needed.

**Idempotency.** A given order can only ever enter `pagado` once and
`enviado` once — the state machine (§3) has no edge back into either — so in
practice each notice fires at most once per order already. `notifyCustomerOrderEvent`
still checks for an existing `aviso_cliente_<kind>` success row before
sending, as a second, cheap guard against firing the same hook twice.

#### 5.2.2 Los dos avisos programados de O6

Además de los que cuelgan de un evento del pedido, hay dos que los dispara el
reloj o el inventario. Comparten todas las reglas de arriba (post-commit, con
timeout, la plantilla es el interruptor, nunca hacen fallar lo que los
disparó) y agregan una propia: **son idempotentes contra un cron que puede
correr dos veces**.

| Aviso | Quién lo dispara | Qué lo hace idempotente |
|---|---|---|
| **Resumen diario** al dueño (`daily-digest.ts`) | `/api/cron/resumen-diario` | `claimJob('resumen_diario', { onceEvery: 'dia' })`: una corrida exitosa por día calendario de **Asunción**, decidida con `SELECT … FOR UPDATE`. Se mira `last_ok_at` y no `finished_at`, para que un intento fallido a las 8:00 pueda reintentarse a las 8:15. |
| **"Volvió a haber stock"** a la compradora (`stock-alerts.ts`) | `adjustStock` post-commit cuando la disponibilidad cruza de 0 a >0, la importación con `pisarStock`, y el barrido del cron | `notified_at` se marca **antes** de mandar (`UPDATE … WHERE notified_at IS NULL` + lectura de confirmación, el patrón de `login-tokens.ts`). Un envío que falla deja la fila marcada igual: se pierde un aviso, y eso es preferible a un reintento que le manda diez mensajes a la misma persona. |
| **Recordatorio de pago** a la compradora (`payment-reminders.ts`, O15) | `runMaintenance`, el cron de `vencer-pedidos` que ya corría cada 15 min — **después** de vencer, así un pedido recién vencido nunca recibe "podés pagar hasta las…" | `orders.payment_reminder_sent_at` se marca **antes** de mandar (`UPDATE … WHERE payment_reminder_sent_at IS NULL`, y sólo con `affectedRows = 1` sale el mensaje). Un envío que falla queda marcado igual, por el mismo motivo: un recordatorio de menos es tolerable, dos son spam. |

El recordatorio sale **una sola vez por pedido**, cuando a un `pendiente_pago`
le quedan menos de 6 h de `reserved_until`, y lleva número, total, hora límite
en Asunción y el link tokenizado a su pedido — ningún dato bancario: ésos ya
están en esa página, y el mensaje no es el lugar para repetirlos. Contra
entrega sí pasa por `pendiente_pago`, pero se excluye explícitamente porque no
tiene nada que pagar antes de recibir: el aviso es para transferencia y tarjeta abandonada en Pagopar. Sin
`WHATSAPP_CLOUD_TEMPLATE_CLIENTE_RECORDATORIO` la feature está apagada y no
consulta ni una fila.

El barrido del cron existe por un caso que el disparo post-ajuste no puede
cubrir: la disponibilidad que libera una **reserva vencida** no tiene ninguna
escritura detrás de la cual colgarse.

`job_runs` es la tabla que sostiene las dos formas de "no ahora" (una por día,
y el lock con expiración que usa el backup de O8). El lock **vence**: un
proceso que muere no llama a `finishJob`, y un lock eterno deja el trabajo
apagado sin que nadie se entere.

### 5.1 A manual payment is still a payment

For a while `payments` only ever held Pagopar rows, because Pagopar was the
only path with an external system to record. An approved transfer receipt and a
confirmed COD reached `pagado` with no row at all: the money arrived and the
table that exists to record money arriving never heard about it. That is not a
cosmetic gap. It cost the reconciliation its most valuable cross-check —
`pedido_cobrado_sin_pago` had to be scoped to `payment_method = 'tarjeta'`,
which is to say switched off for the two paths the store actually gets paid
through.

**Entering `pagado` writes the payment row, in the same transaction.**
`recordManualPayment()` runs inside `transitionOrder`, next to the stock
re-check and for the same reason (§4.1): there are three ways into `pagado`,
and a record the caller has to remember to write is a record the fourth caller
will not write. If it were a second step, a process that dies in between would
leave the order charged and the payment unrecorded — precisely the mismatch
this exists to make impossible.

| `orders.payment_method` | `payments.provider` | who writes it |
|---|---|---|
| `transferencia` | `spi` | `transitionOrder`, on entering `pagado` |
| `contra_entrega` | `cod` | `transitionOrder`, on entering `pagado` |
| `tarjeta` | `pagopar` | `startPagoparCheckout` before redirecting; the webhook flips it to `paid` |

**`provider_ref` is the order number.** Nobody issues a transaction id for a
bank transfer or for cash in hand, so the reference has to come from something
that already identifies the charge without ambiguity. `orders.order_number` is
immutable, unique, and is what the owner has in front of them when they look
for the transfer on the bank statement. Because it is derivable from the order,
`UNIQUE(provider, provider_ref)` now *means* something — "one manual charge per
order per provider" — and a double-click, a retry, or an order re-entering
`pagado` collides with that index instead of duplicating the money. The insert
is `INSERT IGNORE`: an existing row is never overwritten, so a payment someone
already marked `refunded` cannot be resurrected by the order passing through
again.

**The invariant, restored.** `pedido_cobrado_sin_pago` no longer filters by
payment method: a settled order without a `paid`-or-`refunded` payment row is a
finding, whatever it was paid with. (`refunded` counts as recorded — refunding
money does not erase that it arrived.) Orders charged before this existed are
completed by `pnpm backfill:pagos-manuales`, a dry-run-by-default script rather
than a migration: the schema is applied with `drizzle-kit push`, which never
runs the files in `drizzle/`, so a backfill living there would run in the test
suite and never on the merchant's server.

---

## 5.3 Observabilidad y copias de seguridad (O8)

**Sin Sentry ni ningún SDK de terceros** (plan-operacion §1.3). Un SDK de
observabilidad es una dependencia de runtime con acceso a todo lo que pasa por
el servidor, que manda datos afuera por defecto y que hay que auditar en cada
actualización. Lo que el comercio necesita cabe en tres piezas propias:

| Pieza | Qué hace | Qué **no** hace |
|---|---|---|
| `src/lib/log.ts` | Una línea JSON por evento, con `reqId`. Redacta por **nombre de campo** (`phone`, `token`, `secret`, `password`, …) antes de serializar. | No manda nada a ningún lado. |
| `src/proxy.ts` | Genera o respeta el `x-request-id`, lo pone en la respuesta y en un `AsyncLocalStorage` para que el logger lo lea sin pasarlo a mano. | No confía en el valor de afuera: lo valida antes de repetirlo (un id con saltos de línea inyecta líneas falsas en el log). |
| `src/instrumentation.ts` | `onRequestError`: siempre una línea de log; **sólo con `ERROR_REPORT_URL`** (https), además un POST con `{message, stack, path, method, reqId, sha}`, con timeout y tope de 10/min. | Sin la variable, **nada sale de la máquina**. Nunca viajan teléfonos, nombres, tokens de pedido, cookies ni variables de entorno. |

La redacción por nombre y no por vigilancia de cada llamador es la decisión que
importa: un log en un hosting compartido lo lee cualquiera con acceso al
hPanel, y el teléfono de una compradora ahí es una filtración aunque nadie la
mire. Un test greppea que no queden `console.*` sueltos en `src/domain` ni en
`src/app/api`, con una sola excepción documentada (el sender de consola de dev,
cuyo trabajo *es* imprimir por consola).

### El backup

`pnpm backup` (mysqldump desde la máquina de Anton) era el único camino y
dependía de que alguien se acordara. `/api/cron/backup` es el que corre solo.

El entorno manda: **no hay `mysqldump` en el slot de Hostinger** y **hay poca
RAM**, así que el dump es JavaScript — `SELECT *` paginado **por clave
primaria** (con `OFFSET`, una fila insertada a mitad del dump corre el resto y
una fila se salta o se duplica), escrito como JSON Lines a un gzip en
streaming. La lista de tablas es explícita (`BACKUP_TABLES` en `schema.ts`) y
ordenada por dependencia: restaurar en ese orden nunca choca contra una FK, y
una tabla nueva que nadie decidió incluir hace fallar un test en vez de quedar
afuera en silencio.

Sube a Cloudinary como `raw` + **`authenticated`**: un backup en una carpeta
pública es la base de datos entera del comercio servida por CDN a quien adivine
la URL. Retención de 14 días, porque una cuenta llena deja de aceptar la copia
de hoy. Si falla, el dueño recibe un WhatsApp — un backup que falla en silencio
da la tranquilidad sin dar la copia.

`scripts/restore-backup.ts` **sólo corre contra una base cuyo nombre contenga
`restore` o `test`**, el mismo candado que `TEST_DATABASE_URL`, y sin flag para
saltearlo: un `pnpm restore` con el `.env` de producción cargado por accidente
borraría la tienda en vez de recuperarla. Hay un test de round-trip (dump →
restore → mismas filas), porque un backup que no restaura es un archivo, no una
copia de seguridad.

### `/api/version`

Contesta "¿tomó el redeploy?" con `{sha, builtAt, node}`, **detrás del mismo
`CRON_SECRET`**. El SHA del build es información de reconocimiento: con el repo
público, le dice a cualquiera qué commit exacto está corriendo. `/api/health`
sigue siendo el endpoint abierto y sigue sin decir ni una versión.

## 6. Images & performance on PY mobile networks

- **Cloudinary** for everything. Product images public with `f_auto,q_auto` transformations; receipts in a **private/authenticated** folder, admin views them via signed URLs.
- Do **not** store uploads on the Hostinger filesystem — a git-based redeploy can wipe them.
- Blur placeholders stored in `product_images.blur_data_url`; `next/image` with `unoptimized` (Cloudinary already does the work) and long cache headers.
- Catalog pages use ISR (`revalidate`); only live availability is fetched client-side.
- Budget: LCP < 2.5 s on Slow-4G.
- **Client JS, measured (S12, 2026-09-06 — Next 16.3.4/Turbopack, `next build && next start`, real gz bytes of same-origin `<script>` responses, no fallback):**

  | Página | Medido | Techo que bloquea CI (`tests/e2e/presupuesto.spec.ts`) |
  |---|---|---|
  | `/` | 219.9 KB gz | **245 KB** |
  | `/producto/<slug>` | 229.6 KB gz | **260 KB** |
  | `/checkout` | 224.2 KB gz | **255 KB** |

  Muy por encima de la cifra de 120 KB que este documento tenía antes de
  medir — esa cifra **no** era una medición, era una aspiración, y quedó
  obsoleta en cuanto alguien puso un runner real a contarla. El techo de
  arriba es medido + 10 %: una alarma contra que el bundle **crezca más**, no
  un objetivo de performance. El culpable principal (documentado en
  `KNOWN-ISSUES.md`): varios componentes cliente del panel importan un
  *valor* (no sólo un tipo) desde `@/db/schema` — como `schema.ts` define
  cada tabla con `mysqlTable(...)` a nivel de módulo (una llamada con
  efecto), ningún bundler puede tree-shakear el resto del archivo ni su
  `import` de `drizzle-orm`, así que esas pantallas cargan el ORM entero
  (~17 KB gz) para leer un array de strings. El arreglo (mover los arrays de
  enum a un archivo sin `drizzle-orm`) está fuera de los límites de las
  fases Sonnet — queda para una fase con permiso sobre `src/db/**`.
- MySQL pool `connectionLimit: 8` — Hostinger caps concurrent connections per user; a bigger pool causes random `ER_CON_COUNT_ERROR` under load.

---

## 7. FASE 2 (not built in MVP): FacturaPY integration

The store MVP issues **no legal invoices**. But the schema is already invoice-complete — RUC/CI with DV validation, `iva_rate` per line, per-rate IVA subtotals — so connecting it later is roughly one day of work, not a remodel.

**Direction of the integration: FacturaPY exposes the API, the store calls it.** The store must never touch FacturaPY's database or Prisma layer.

### Contract to build against

```
POST  https://facturapy.example/api/public/invoices
Header: Authorization: Bearer <API_KEY>        (per Company, hashed at rest, scoped)
Body:
{
  "external_ref": "PY-000123",                 // orders.order_number — idempotency key
  "issued_at":    "2026-07-29T14:03:00-03:00",
  "customer": {
    "doc_type": "RUC" | "CI" | "NINGUNO",
    "doc_number": "80012345-6",
    "name": "Comercial San Roque S.A.",
    "email": "...", "phone": "+595981123456",
    "is_consumidor_final": false
  },
  "payment_method": "transferencia" | "tarjeta" | "efectivo",
  "currency": "PYG",
  "items": [
    { "sku":"CAM-M-AZ", "description":"Camisa azul talle M",
      "qty":2, "unit_price_pyg":110000, "iva_rate":10 }     // IVA INCLUIDO
  ],
  "shipping_pyg": 25000,
  "total_pyg": 245000
}

202 → { "invoice_id":"...", "status":"QUEUED" }
```

Async by design — SIFEN can take time. Two ways back:

```
POST  <STORE_URL>/api/webhooks/facturapy          ← FacturaPY calls the store
      { "external_ref":"PY-000123", "invoice_id":"...",
        "status":"APPROVED"|"REJECTED", "cdc":"01800...", "kude_url":"https://..." }

GET   /api/public/invoices/:id                    ← polling fallback
```

Store side needs only: `orders.invoice_status` (`none|queued|approved|rejected`), `invoice_cdc`, `invoice_pdf_url`, an "Emitir factura" button in `/admin/pedidos/[id]`, and a webhook receiver reusing the same idempotency table (`payment_events` pattern).

**Legal note, not a technical one:** issuing a legal factura requires the *merchant's* own **timbrado from DNIT**, and for electronic invoicing a digital certificate + SIFEN habilitación tied to their RUC. That authorization belongs to the merchant, not to the software. The DNIT rollout phases move — verify current requirements with a contador before making any compliance claim to a client.
