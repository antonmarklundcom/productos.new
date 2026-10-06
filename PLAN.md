# PLAN.md — Tienda PY · FASE 2

Este archivo queda como historial de la FASE 2, ya cerrada. `fable/plan.md`
(endurecimiento), `fable/plan-operacion.md` (la tienda después del
lanzamiento) y `fable/plan-crecimiento.md` (deuda de dominio, recordatorio de
pago, edición de pedido, kit de temas, dependencias) son historial también,
con las seis fases O14–S19 de este último mergeadas en dos ventanas.
`fable/REVIEW.md` (2026-09-11) es el origen de `fable/plan-crecimiento.md`; la
última revisión de maquinaria es `fable/REVIEW-2026-09-13.md` (ya aplicada) y
la auditoría del template, `fable/TEMPLATE-REVIEW.md` (2026-09-19). La próxima
arranca desde `fable/PROMPT.md`.

**Stack (locked):** Next.js 16 + Drizzle + **Hostinger MySQL** + **Hostinger Node.js slot** + Cloudinary.
No Supabase, no Vercel, no Cloudflare. Deploy mechanics live in `DEPLOY.md` and the `nextjs-deploy-hostinger` skill.

**Estado:** la **FASE 2 está terminada y mergeada** — PR A a U, con CI verde completo en cada uno. El plan original (PR #1–#5: schema, vidriera, checkout, admin, Pagopar) y los PRs de endurecimiento #6–#12 ya estaban antes; el historial completo vive en `TASKS.md`. Lo que queda abierto no es código de este repo: son las cuentas y los datos de terceros que lista `TASKS.md` §"Bloqueado por terceros". Este archivo queda como el registro de qué se construyó en la FASE 2 —cuentas de cliente opcionales, roles de verdad, cupones, los ABMs que faltaban del panel, UX de la vidriera, i18n por tienda y el arranque automatizado de una tienda nueva— y de por qué cada decisión salió como salió.

**Objetivo de la FASE 2:** que el template sea *vendible* — que el dueño administre su tienda entera (usuarios, categorías, zonas) desde el navegador sin llamar al desarrollador, que la tienda pueda tener clientes con cuenta (para perks y marketing) **sin obligar a nadie a registrarse**, y que una tienda nueva pueda salir en otro idioma cambiando un solo archivo.

Task tags: **[Opus 5]** = schema, plata, auth/sesiones, guards, review final · **[Sonnet 5]** = UI, rutas, formularios, ABMs, extracción de strings.

**Ejecución en dos chats, para poder ir AFK:**

- **CHAT 1 (Opus 5):** PR A–G — maquinaria: roles, cuentas de cliente, cupones. Todo lo que toca auth, sesiones o plata.
- **CHAT 2 (Sonnet 5):** PR H–S — UX de vidriera, ABMs del panel, feed de actividad, i18n. Arranca **después** de mergear el chat 1.

Dentro de cada chat: abrir el PR, esperar CI verde completo (unitarios **e integración** contra MySQL), mergear, seguir con el próximo. Los PRs sin dependencia entre sí pueden ir en paralelo; los `depende de:` no.

---

## Guardarraíles (leer antes de escribir una línea)

Los seis de `README.md` §"Reglas no negociables" siguen vigentes y tienen tests que los verifican en CI. Para la FASE 2 se suman:

1. **Todo lo nuevo es opcional con default seguro.** Cada feature nueva visible (cuentas de cliente, login sin contraseña, cupones, hero de la home) va detrás de un flag en `src/config/tienda.ts` o de "cero filas = invisible". Con todos los flags apagados la tienda se comporta **exactamente** como hoy. El PR E agrega un test de CI que arranca con todos los flags apagados y verifica que nada nuevo se renderice.
2. **El split maquinaria/piel es sagrado** (NEW-STORE.md). Todo esto es maquinaria (`src/domain`, `src/lib`, `/admin`, checkout) salvo el hero de la home (PR O, piel). `template:diff` tiene que seguir marcando bien.
3. **Guards primero, siempre.** Toda server action nueva de `/admin` llama a su guard en la primera línea. Si un PR agrega una función guard nueva (`requireVendedorSession`, `requireCustomerSession`), **el mismo PR** actualiza el regex de `tests/unit/admin-guards.test.ts`.
4. **Clientes ≠ usuarios del panel.** Tabla propia (`customers`), sesión propia con **cookie propia** (nunca la del admin), rate limit en el login, y el error de login jamás distingue "no existe" de "contraseña incorrecta" — igual que `authenticate()` hoy.
5. **Descuentos son plata.** Los cupones pasan por `computeOrderTotals` y por los invariantes de `pnpm reconcile` (extenderlos en el mismo PR). El navegador nunca calcula un descuento.
6. **Merge sólo con CI verde completo.** "Verde" = typecheck + lint + unitarios + integración (contenedor MySQL) + build + drift de migraciones. Nunca mergear con sólo los unitarios.
7. **Migraciones versionadas** (`pnpm db:generate`), nunca `db:push` contra una base con pedidos reales. `/api/setup/init` las corre solo en el próximo deploy — no hay trabajo manual de base.

---

# CHAT 1 — Opus 5 · maquinaria: roles, cuentas, cupones

## PR A — Higiene (sin dependencias, chico) — **hecho**
*Branch: `feat/higiene-docs`*

| # | Task | Model |
|---|---|---|
| A.1 | Docs: "Next.js 15" → "Next.js 16" en ARCH.md/TASKS.md/README.md donde aparezca | Sonnet 5 |
| A.2 | **Una sola fuente de labels de estado**: unificar `ORDER_STATUS_LABEL` (`src/components/admin/labels.tsx`) y el `STATUS_LABEL` inline de `src/app/pedido/[orderNumber]/page.tsx` en un módulo compartido (puede conservar la variante "para el comprador" y "para el panel", pero en un solo archivo). Prerrequisito del i18n del chat 2 | Sonnet 5 |
| A.3 | Campo de email en el checkout: el schema ya lo acepta (`CheckoutInputSchema`), pero el `<Input>` nunca se renderizó y siempre viaja vacío. Agregarlo **opcional**, con label honesto ("por si tu WhatsApp falla") | Sonnet 5 |

**Exit:** `rg "Next.js 15"` sin resultados; un solo módulo exporta labels de estado; un checkout con email lo persiste en `orders.customer_email`.

## PR B — Roles de verdad: owner / staff / vendedor — **hecho**
*Branch: `feat/roles-reales` · Sin dependencias*

Hoy `requireOwnerSession()` existe pero **nadie la llama**: owner y staff pueden lo mismo, incluidos reembolsos. Este PR cablea los dos niveles y agrega el tercero.

| # | Task | Model |
|---|---|---|
| B.1 | Migración: `USER_ROLES = ['owner', 'staff', 'vendedor']` + `users.last_login_at` | **Opus 5** |
| B.2 | Matriz de permisos (documentarla en ARCH.md §1): **owner** = todo + gestión de usuarios, reembolsos (`markPaymentRefunded`), borrado de productos/variantes, edición de categorías y zonas, exports CSV · **staff** = pedidos, comprobantes (aprobar/rechazar), productos, ajustes de stock · **vendedor** = ver pedidos y transicionar sólo `pagado → enviado → entregado`; sin comprobantes, sin precios, sin stock, sin dashboard de plata, sin exports | **Opus 5** |
| B.3 | Cablear: `requireOwnerSession()` en las acciones owner-only; nuevo `requireStaffSession()` (owner+staff, excluye vendedor) en las de plata/stock/productos; `requireAdminSession()` queda para lo que los tres pueden. Actualizar el regex de `admin-guards.test.ts` en este mismo PR | **Opus 5** |
| B.4 | UI por rol: ocultar en el panel los botones/nav que el rol no puede usar (la defensa real son los guards; esto es UX) | Sonnet 5 |
| B.5 | Tests: por cada acción, el rol de abajo recibe `ForbiddenError`; `authenticate()` actualiza `last_login_at` | **Opus 5** |

**Exit:** un `staff` que intenta reembolsar recibe error prolijo; un `vendedor` sólo ve pedidos y los marca enviados/entregados.

## PR C — `/admin/usuarios` (depende de: B) — **hecho**
*Branch: `feat/admin-usuarios`*

La página que hace al template vendible: el dueño gestiona a sus empleados sin SSH ni llamarte.

| # | Task | Model |
|---|---|---|
| C.1 | Página owner-only: listar usuarios del panel (email, nombre, rol, activo, último login), crear (email + contraseña temporal + rol), desactivar/reactivar, resetear contraseña, cambiar rol | Sonnet 5 |
| C.2 | Server actions con `requireOwnerSession()`; reglas duras: no podés desactivarte a vos mismo, ni desactivar/degradar al último owner activo | **Opus 5** |
| C.3 | `pnpm create-owner` queda como bootstrap del primer owner; documentar en README que el resto se crea desde el panel | Sonnet 5 |

**Exit:** flujo completo probado: owner crea un staff, el staff entra, el owner lo desactiva y el staff ya no entra.

## PR D — Atribución auditable (depende de: B, chico) — **hecho**
*Branch: `feat/actor-user-id`*

| # | Task | Model |
|---|---|---|
| D.1 | Migración: `order_events.actor_user_id` y `stock_adjustments.actor_user_id` (FK nullable a `users.id`); las escrituras nuevas lo completan junto al `actor` de texto que ya existe (no se backfillea el histórico) | **Opus 5** |

**Exit:** un evento nuevo de admin queda con FK consultable, no sólo el string `admin:email`.

## PR E — Cuentas de cliente (flag, apagado por defecto) (paralelo con B) — **hecho**
*Branch: `feat/cuentas-clientes`*

**El checkout como invitado no se toca.** La cuenta es un upsell ("guardá tus datos para la próxima"), nunca una pared. Con `TIENDA.cuentasClientes: false` (el default) nada de esto se renderiza.

| # | Task | Model |
|---|---|---|
| E.1 | Migración: tabla `customers` (id, `phone` único normalizado PY, `email` único nullable, `password_hash` nullable, nombre, `marketing_opt_in`, `is_active`, `created_at`, `last_login_at`) + `orders.customer_id` (FK nullable). **Separada de `users`** — un cliente jamás pisa el panel | **Opus 5** |
| E.2 | Sesión de cliente: iron-session con **cookie y secreto propios** (`customer_session`), `requireCustomerSession()`. Registro y login con **teléfono O email** + contraseña (bcrypt, mismos helpers), rate-limited, error genérico que no revela si la cuenta existe. Sin verificación de email/SMS en esta fase (no hay proveedor de envío) — documentar la limitación | **Opus 5** |
| E.3 | Flag `cuentasClientes` en `tienda.ts`: apagado ⇒ las rutas `/cuenta/*` devuelven 404 y el header no muestra nada. **Test de CI "flags apagados = tienda de hoy"** (guardarraíl 1) | **Opus 5** |
| E.4 | UI: `/cuenta` (mis pedidos — por `customer_id` y también los pedidos viejos que matcheen el teléfono verificado de la cuenta —, mis datos), login/registro, entrada discreta en el header | Sonnet 5 |
| E.5 | Checkout logueado: prefill de nombre/WhatsApp/email/dirección, el pedido queda con `customer_id`. Checkout invitado: idéntico a hoy, con un "¿querés guardar tus datos?" opcional post-pedido | Sonnet 5 |
| E.6 | Panel: `/admin/clientes` muestra si el comprador tiene cuenta y su opt-in de marketing; export CSV de clientes con opt-in (owner-only) — la lista de marketing que hoy no existe | Sonnet 5 |

**Exit:** con el flag apagado, snapshot de la tienda idéntico a `main`; con el flag prendido, registro → compra logueada → historial en `/cuenta`, y el invitado compra igual que siempre.

## PR F — Login sin contraseña, pre-armado (depende de: E) — **hecho**
*Branch: `feat/login-sin-password`*

Pre-construido para todas las tiendas, **inactivo hasta que la tienda tenga con qué mandar mensajes**: mandar un OTP por WhatsApp requiere WhatsApp Cloud API (credenciales + número verificado de Meta) — eso es lo que una tienda nueva "tiene que verificar antes de usarlo".

| # | Task | Model |
|---|---|---|
| F.1 | Maquinaria de OTP/magic-link: token de un solo uso, hasheado en DB, expira a los 10 min, rate-limited, invalida los anteriores | **Opus 5** |
| F.2 | Interfaz `MessageSender` con dos implementaciones: `whatsappCloud` (usa `WHATSAPP_CLOUD_*` del env) y `consola` (dev). Sin credenciales ⇒ la opción no se ofrece en el login — jamás un botón que no puede funcionar | **Opus 5** |
| F.3 | UI del flujo + sección en NEW-STORE.md y `.env.example`: qué pide Meta y cómo prenderlo por tienda | Sonnet 5 |

**Exit:** en dev (sender `consola`) el flujo completo anda; sin credenciales el login sólo ofrece contraseña.

## PR G — Cupones (depende de: B; `solo_clientes` degrada sin E) — **hecho**
*Branch: `feat/cupones`*

| # | Task | Model |
|---|---|---|
| G.1 | Migración: `coupons` (código único, tipo `porcentaje`/`monto_fijo` — el monto en **Gs enteros**, jamás float —, mínimo de pedido, vigencia, límite de usos global y por cliente, `solo_clientes`, activo) + `orders.coupon_id` + columna de descuento en el desglose | **Opus 5** |
| G.2 | Dominio: validación y aplicación **dentro de `computeOrderTotals` en el server**, redondeo de IVA por línea intacto; extender los invariantes de `pnpm reconcile` con el descuento en el mismo PR | **Opus 5** |
| G.3 | Checkout: campo "código de descuento" plegado, feedback claro (vencido/mínimo no alcanzado/agotado), el desglose muestra el descuento; `solo_clientes` exige sesión de cliente (con el flag de cuentas apagado esos cupones simplemente no validan) | Sonnet 5 |
| G.4 | `/admin/cupones` (owner-only): ABM + usos consumidos. Cero cupones = nada visible en el checkout | Sonnet 5 |
| G.5 | Tests de concurrencia: dos checkouts simultáneos no gastan dos veces un cupón de un solo uso (`FOR UPDATE`, como el stock) | **Opus 5** |

**Exit:** `pnpm reconcile` cuadra con pedidos con descuento; el cupón agotado pierde la carrera limpiamente.

**Cierre del chat 1:** cumplido — A–G mergeados con CI verde completo (unitarios e integración contra MySQL), `/security-review` corrido sobre el acumulado, `pnpm reconcile` cuadrando y `pnpm preflight` bloqueando lo que tiene que bloquear.

---

# CHAT 2 — Sonnet 5 · UX, ABMs, i18n (arranca con el chat 1 mergeado)

## PR H — Skeletons (sin dependencias) — **hecho**
`loading.tsx` para `/` reusando `ProductCardSkeleton` (antes sólo `/buscar` lo tenía).

**Corrección de alcance:** el plan pedía además `/categoria/[slug]` y `/producto/[slug]`, y esas dos **no llevan `loading.tsx` a propósito** — decisión ya tomada y comentada en el código desde el PR de las fichas. Las dos deciden su 404 en el cuerpo (`notFound()`), y el Suspense de un `loading.tsx` manda el shell —y con él un HTTP 200— antes de que se sepa si la página existe: un producto borrado respondería 200 con la pantalla de 404, que es exactamente lo que hace que Google indexe fantasmas. El esqueleto de la home no tiene ese problema porque la home siempre existe.

## PR I — SEO técnico (sin dependencias) — **hecho**
`src/app/sitemap.ts` (home + categorías activas + productos publicados, con el mismo filtro `PUBLISHED()` de la vidriera) + `robots.ts` (bloquea `/admin`, `/api`, `/checkout`, `/pedido`, `/cuenta`, `/dev`) + JSON-LD `BreadcrumbList` e `ItemList` en categoría (producto ya tenía el suyo).

Las piezas puras viven en `src/lib/seo.ts` para que se testeen sin Next ni base. Dos decisiones que valen: sin `NEXT_PUBLIC_SITE_URL` el sitemap sale **vacío** y `robots.txt` no declara `sitemap:` —una URL relativa no le sirve a ningún crawler y un dominio inventado es peor que no publicar—, y el `ItemList` numera desde la página actual (en la página 2 el primer producto es el 13). El test `tests/unit/seo.test.ts` recorre `src/app` y exige que toda ruta de nivel uno que no sea pública esté en `RUTAS_PRIVADAS`: una `/cuenta` nueva que se olvide de la lista se indexaría en silencio.

## PR J — `/admin/categorias` (owner-only) — **hecho**
ABM completo: crear, renombrar, cambiar el slug, reordenar y activar/desactivar. Hasta acá esta tabla la escribía sólo el seed.

**Lo que se descubrió haciéndolo, y cambió el alcance:** el filtro `PUBLISHED()` de la vidriera miraba sólo el producto, así que desactivar una categoría dejaba la tienda incoherente — desaparecía del menú y devolvía 404, pero sus productos seguían en la home, en el buscador y en el sitemap, con una miga de pan que llevaba a ese 404. Mientras la tabla la escribía sólo el seed casi no pasaba; con un botón en el panel iba a pasar el primer día. Ahora `PUBLISHED()` exige además que la categoría esté activa (ARCH.md §"Qué se ve en la vidriera"), y la confirmación de desactivar dice el número exacto de productos que dejan de verse.

El orden se guarda renumerando `0..n-1` adentro de la transacción y no intercambiando posiciones: dos tiendas clonadas del mismo seed pueden tener varias categorías en `position = 0`, y ahí un intercambio no cambia nada nunca.

## PR K — `/admin/envios` (owner-only) — **hecho**
ABM de `shipping_zones`: precio, ciudades, umbral de envío gratis, orden y activar/desactivar. La cotización del checkout ya leía de acá y sigue recalculándose server-side; los pedidos en vuelo conservan el flete que la compradora aceptó (`orders.shipping_pyg`).

Tres reglas nuevas en el dominio, cada una por una forma de perder plata en silencio: una ciudad no puede estar en dos zonas (`quoteShipping` se queda con la primera por `position`, sin avisar), una zona sin ciudades es válida y sirve de comodín del interior, y no se puede apagar la última zona activa (sin ninguna, la tienda cobra ₲0 de flete a todo el país sin que ningún cartel lo diga).

## PR L — `/admin/actividad` (owner y staff) — **hecho**
Feed global paginado de `order_events` + `stock_adjustments`, filtrable por persona (el `actor_user_id` del PR D), tipo y fecha. "¿Qué hizo X hoy?" en una pantalla.

Lo único difícil fue la paginación: son dos tablas y un solo orden. Traer N de cada una y ordenarlas en memoria funciona en la página 1 y miente en la 2 — con 300 eventos y 3 ajustes en el rango, los eventos tapan a los ajustes. El orden y el `LIMIT/OFFSET` los hace MySQL sobre un `UNION ALL` de `(tipo, id, fecha)`, y los detalles se buscan después sólo para las filas de esa página. El desempate va por `id` además de por fecha: dos eventos de la misma transacción comparten `created_at` al segundo, y sin eso una fila aparece dos veces y otra nunca.

Dos detalles que no estaban en el plan y se ganaron el lugar: **"el sistema"** es un filtro (las filas sin `actor_user_id`: el cron, Pagopar, la compradora), y el desplegable de personas incluye a los **desactivados**, porque revisar qué hizo alguien antes de que le cortaran el acceso es justo la consulta que importa.

## PR M — Productos relacionados — **hecho**
"También te puede interesar" en `/producto/[slug]`: misma categoría, en stock, sin el que se está mirando. Sin nada que mostrar, la sección no se renderiza.

El orden mezcla dos señales: **la misma marca primero** (quien mira una Marca X suele estar decidiendo entre Marca X) y después **el precio más parecido**, que es la señal de relevancia más honesta que hay en una góndola — a quien mira algo de ₲80.000 no le sirve que le ofrezcan uno de ₲2.000.000.

El filtro de stock va en dos pasos: `on_hand > 0` en SQL (barato, descarta casi todo) y después, con las reservas ya calculadas por `hydrate`, se caen los que quedaron en cero por holds ajenos. Por eso se piden `limit * 3` candidatos. La comparación de marca usa `<=>` y no `=`: con `=`, dos productos sin marca comparan NULL contra NULL y el CASE se cae siempre.

## PR N — Filtros y búsqueda — **hecho**
Chips de filtros activos con su ✕ (uno por uno; "Limpiar todo" obliga a rehacer los que sí servían), contadores por marca ("Basics PY (12)") y sugerencias as-you-type en el buscador.

Los contadores tienen un test que exige que el número del filtro sea **el mismo** que devuelve el filtro al usarse: si se separan, "Basics PY (12)" lleva a una grilla de 3 y el filtro deja de ser confiable para siempre.

Las sugerencias son `suggestProducts`, que es `searchProducts` **sin `hydrate()`**: esto se dispara con cada tecla y `hydrate` trae variantes, fotos y calcula las reservas de stock de cada producto, nada de lo cual se dibuja en una lista de sugerencias. La server action es pública pero rate-limited por IP (30/min) — cada tecla que se escapa del debounce es un `MATCH … AGAINST` en el mismo slot de Node donde corre el checkout.

El buscador pasó a ser un `<form method="get" action="/buscar">`: sin JavaScript, o mientras el bundle baja en una 3G paraguaya, escribir y apretar Enter lleva igual a los resultados. Las sugerencias son una mejora encima de algo que ya funciona.

## PR O — Hero de la home (piel, config-driven) — **hecho**
Slot `hero` en `tienda.ts`: foto de Cloudinary + título + bajada + un botón. Sin configurar (`hero: null`, el default) la home queda **exactamente** como estaba — el texto que hoy tiene escrito a mano pasó a ser el hero por defecto, así que una tienda que se actualiza no ve ningún cambio.

**Sin carrusel, a propósito.** El plan lo dejaba abierto ("o lista para carrusel simple") y la respuesta es que no: un carrusel es JavaScript, autoplay, gestos y un estado que se sincroniza, o sea maquinaria, en el único lugar de la FASE 2 que es piel. Una portada más ambiciosa se escribe en `src/app/page.tsx`, que es de la tienda y se puede reescribir entero.

Dos bordes que el test fija: sin `CLOUDINARY_CLOUD_NAME` en el entorno —el estado de toda tienda recién clonada— el hero sale de texto y no con un `<img>` roto; y sin categorías cargadas todavía, el hero por defecto sale sin botón en vez de con uno que lleva a un 404.

## PR P–S — i18n por tienda (Nivel A: un idioma por tienda, elegido en `tienda.ts`)
**En serie y al final** (así las features de arriba se extraen una sola vez). No hay switcher para el visitante ni rutas por locale — eso sería un Nivel B futuro sobre esta base. Las URLs quedan en español para siempre (decisión: son parte del template). Moneda y dinero **fuera de alcance**: `money.ts` queda PYG-entero con su `₲` literal.

| PR | Task |
|---|---|
| P | **hecho** — Infra propia, sin librería: `t()` / `tPlural()` síncronas y sin contexto, `TIENDA.lang` elige el catálogo, `es-PY` completo como default **y fallback por clave**. Se descartó next-intl: resuelve rutas por locale y un idioma que cambia por request, y acá el idioma es una constante de build. La consecuencia práctica es que `t()` anda igual en un Server Component, en un `"use client"`, en `generateMetadata` y en un script de Node — un provider de React no serviría para lo último, y medio catálogo vive en `order-messages.ts`, que corre fuera de React. Incluye la extracción de **toda la vidriera de navegación** (header, pie, carrito, fichas, filtros, buscador, home, categoría, producto, 404 y error). Dos tests de CI cierran el círculo: toda clave usada existe, y **ninguna clave del catálogo quedó muerta**. *Branch: `feat/i18n-infra`* |
| Q | **hecho** — Lo transaccional: checkout completo, la página del pedido (datos bancarios, pasos del SPI, comprobante), la vuelta de Pagopar, `/pedido/buscar` y toda la rama `/cuenta/*`. También `coupon-messages.ts`, que era prosa suelta. La vidriera queda sin un solo texto escrito a mano. *Branch: `feat/i18n-vidriera`* |
| R | **hecho** — El panel entero: las 14 pantallas, los 20 componentes, las server actions y los errores de dominio que sólo lee el dueño. Salieron ~500 claves y no 150 — el panel tiene más texto del que parece, sobre todo en las ayudas que explican por qué un botón hace lo que hace. También `order-labels.ts` (las dos vistas de cada estado), `admin-product-sort.ts` y las cabeceras de los CSV. `validatePasswordStrength` pasó a devolver una **clave** en vez de prosa, que era el último helper de `lib/` con texto adentro. *Branch: `feat/i18n-admin`* |
| S | **hecho** — Templates de WhatsApp parametrizados y errores de dominio con **código** en vez de prosa: `DomainError` recibe una clave del catálogo, arma el `message` con ella y guarda el `code`. `error.message` sigue siendo lo que era (lo leen los formularios, los logs y `adminActionError` sin cambiar una línea) y ahora además se puede preguntar *qué* pasó sin comparar strings. Convertidos los que **una persona lee**: checkout, comprobantes, cuentas y OTP. Los que sólo lee un desarrollador (`qty inválida para la variante 3`, transiciones inválidas) siguen siendo `Error` con su mensaje técnico, a propósito: nadie los va a leer en guaraní y un stack trace tiene que decir exactamente qué pasó. *Branch: `feat/i18n-dominio`* |

**Exit del chat 2:** cumplido. Con `lang: "es-PY"` —el default— los textos son los de siempre; el catálogo tiene ~890 claves y cubre la vidriera **y** el panel; los tres tests de CI (toda clave usada existe, ninguna clave muerta, mismos parámetros en todos los catálogos) sostienen que siga siendo cierto. Un segundo idioma es copiar `es-PY.ts`, traducir los valores y agregarlo a `CATALOGOS` — las claves son el contrato y el test no deja mergear uno incompleto.

**Cierre del chat 2:** mismo informe final: hecho, riesgos, ideas.

---

# DESPUÉS DE LOS DOS CHATS — lo que faltaba para que el template se use solo

Los dos PRs que cierran la FASE 2. No estaban en el plan original: salieron de
usar el template desde cero y anotar qué seguía siendo trabajo manual.

## PR T — Los datos bancarios salen del entorno y entran al panel — **hecho**
`/admin/banco` (owner-only): banco, titular, RUC, cuenta, tipo de cuenta y el
QR, editables con la tienda arriba y sin redeploy. Las variables `BANCO_*`
siguen andando como **fallback** —una tienda ya configurada no cambia en nada—
y la fila cargada desde el panel les gana; la precedencia está fijada en
ARCH.md §5.1. El motivo es el de siempre en esta familia de permisos: quien
puede cambiar el número de cuenta al que transfieren las compradoras desvía la
facturación entera sin generar un solo pedido raro (ARCH.md §1), así que es
owner-only y queda auditado.

## PR U — De "Use this template" a preflight verde, sin editar archivos a mano — **hecho**
`pnpm nueva-tienda`: seis preguntas y con eso reescribe la marca de
`tienda.ts`, genera `SESSION_SECRET` / `CRON_SECRET` / `SETUP_SECRET` con
`crypto.randomBytes` (no con `openssl`, que en Windows no existe), escribe
`.env.local`, imprime el bloque exacto del hPanel y corre
`template:diff --marcar`. Idempotente y **nunca regenera un secreto que ya
exista** —uno nuevo cierra todas las sesiones del panel y deja al cron llamando
con la llave vieja—; `--dry-run` no escribe nada y las seis respuestas se
pueden pasar por bandera para correrlo sin TTY.

Se suman `CLOUDINARY_FOLDER_PREFIX` (varias tiendas en una misma cuenta de
Cloudinary dejan de mezclar comprobantes: todas acuñan `PY-000123`) y, en
`/api/setup/init`, el alta de zonas de envío por `{zonas:[...]}` más el reporte
de `preflight()` medido **contra el entorno del servidor**, que es lo que mata
el paso de correr el preflight desde tu máquina contra un `.env` parecido al de
producción.

---

## FASE 3 — deliberadamente afuera (no arrancar sin decisión explícita)

1. **FacturaPY** — contrato listo en `ARCH.md` §7; requiere timbrado/DNIT del comercio.
2. **Nivel B de i18n** — switcher para el visitante, rutas por locale, hreflang. Sobre la base del PR P.
3. **Wishlist y reseñas** — recién tienen sentido con cuentas de cliente maduras y moderación.
4. **Multi-tenant** — agregar `tenant_id` antes, no después.
5. **WhatsApp Cloud API para notificaciones salientes** (pedido confirmado, enviado) — el sender del PR F.2 ya deja la interfaz lista.
6. **Carritos abandonados, devoluciones/RMA.**
