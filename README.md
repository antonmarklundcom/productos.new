# Productos — tienda para Paraguay

Tienda en español, precios en guaraníes enteros y seis categorías para un catálogo amplio. La implementación se entrega en un PR hacia `main`, listo para revisión y sin merge, según la última indicación. **Una vez aprobado y fusionado el PR**, desplegá `main` en Hostinger Node.js 22 con `pnpm install --frozen-lockfile`, `pnpm build` y `pnpm start`.

La producción arranca con un catálogo en preparación y sin productos vendibles. La vista previa local contiene **un solo producto demo**, con dos imágenes y un precio ilustrativo, sin stock ni posibilidad de compra.

- [Configuración de Hostinger y apertura](docs/HOSTINGER-STORE.md)
- [Validación, resultados y tareas pendientes](docs/VALIDATION.md)
- [.env.example](.env.example): sólo cinco variables; el archivo privado `.env.hostinger` queda ignorado por Git para completar la base de datos en hPanel.

## Base reutilizable

Base reutilizable para montar tiendas online paraguayas: la maquinaria (pedidos,
stock, pagos, panel) viene hecha y por tienda sólo se cambian marca, diseño,
base y productos — ver **[NEW-STORE.md](./NEW-STORE.md)**.

Guaraníes enteros, español (voseo), WhatsApp-first, mobile-first.

**Stack:** Next.js 16 (App Router, TS) · Drizzle ORM · Hostinger MySQL · Hostinger Node.js · Cloudinary · Tailwind + shadcn/ui · Zustand · Zod

## Documentos

| Archivo                                                  | Qué contiene                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ARCH.md](./ARCH.md)                                     | Modelo de datos (ERD), modelo de seguridad, máquina de estados del pedido, flujos de pago, integración FacturaPY (fase 2)                                                                                                                                                               |
| [PLAN.md](./PLAN.md)                                     | Plan de la FASE 2 (roles, cuentas de cliente, cupones, ABMs, i18n) en dos chats de build, con tareas etiquetadas `[Opus 5]` / `[Sonnet 5]`                                                                                                                                              |
| [TASKS.md](./TASKS.md)                                   | Checklist por PR                                                                                                                                                                                                                                                                        |
| [NEW-STORE.md](./NEW-STORE.md)                           | Checklist para arrancar una tienda nueva desde este template                                                                                                                                                                                                                            |
| [DEPLOY.md](./DEPLOY.md)                                 | Runbook del deploy a Hostinger: git deploy, variables, base, cron, prueba de humo                                                                                                                                                                                                       |
| [.env.example](./.env.example)                           | Las cinco variables imprescindibles (lo que Hostinger precarga en el hPanel)                                                                                                                                                                                                            |
| [docs/ENV-OPCIONAL.md](./docs/ENV-OPCIONAL.md)           | Todas las demás variables, opcionales, con sus trampas documentadas                                                                                                                                                                                                                     |
| `fable/…` (las filas de abajo)                           | Sólo existen en el template: `pnpm nueva-tienda` borra `fable/` en cada tienda, así que ahí estos links no llevan a ningún lado                                                                                                                                                         |
| [fable/REVIEW.md](./fable/REVIEW.md)                     | Revisión de Fable (2026-09-11): diagnóstico completo sobre el que salió `fable/plan-crecimiento.md`. La última de maquinaria es [fable/REVIEW-2026-09-13.md](./fable/REVIEW-2026-09-13.md), ya aplicada (#109); la próxima arranca desde `fable/PROMPT.md`                              |
| [fable/TEMPLATE-REVIEW.md](./fable/TEMPLATE-REVIEW.md)   | Auditoría del template como fábrica de tiendas (2026-09-19): wizard, bootstrap, `template:sync`, CI. Hallazgos T1–T7, todos cerrados                                                                                                                                                    |
| [CHANGELOG.md](./CHANGELOG.md)                           | Versiones del template (`v*`): qué trae cada una y si pide migración. Publicar una versión dispara la distribución a las tiendas                                                                                                                                                        |
| [fable/plan-crecimiento.md](./fable/plan-crecimiento.md) | Plan de deuda de dominio de `KNOWN-ISSUES.md`, recordatorio de pago antes del vencimiento, edición de un pedido sin pagar, kit de tres temas y dependencias. Seis fases O14–S19 en dos ventanas, **todas mergeadas — historial**, igual que `fable/plan-operacion.md` y `fable/plan.md` |
| [fable/plan-operacion.md](./fable/plan-operacion.md)     | Plan de la tienda después del lanzamiento (tracking, notas, remito, resumen diario, backups, acciones masivas, vidriera, CI, distribución a las tiendas). Nueve fases O5–S13, todas mergeadas — **historial**, igual que `fable/plan.md`                                                |
| [fable/plan.md](./fable/plan.md)                         | Plan de endurecimiento anterior (revisión en `fable/REVIEW-2026-09-02.md`), mergeado completo — historial                                                                                                                                                                               |

## Estado

✅ **El template está cerrado.** FASE 1 (PR #1 a #5: schema y dominio, vidriera, checkout SPI/QR + contra entrega, panel del dueño, Pagopar con su modo mock) y sus PRs de endurecimiento, más la **FASE 2 completa** (PR A a U de `PLAN.md`): roles owner/staff/vendedor, `/admin/usuarios`, atribución auditable, cuentas de cliente opcionales, login sin contraseña pre-armado, cupones, los ABMs que faltaban (categorías, zonas, banco), actividad, filtros y búsqueda, hero de la home, i18n por tienda y `pnpm nueva-tienda`.

Una tienda nueva sale de "Use this template" y llega a preflight verde sin editar un archivo a mano — el camino corto está en **[NEW-STORE.md](./NEW-STORE.md)**.

Lo único que falta para vender de verdad no es código de este repo: la cuenta de Hostinger (deploy, DEPLOY.md), los datos bancarios del comercio (se cargan desde `/admin/banco`), el número de WhatsApp, Cloudinary, las credenciales de Pagopar si va con tarjeta y las fotos de producto. Están todos juntos en la sección **"Bloqueado por terceros"** de `TASKS.md`.

## Arrancar en local

```bash
pnpm install
pnpm nueva-tienda                   # marca + secretos + .env.local (NEW-STORE.md §2)
                                     # opcional: PAGOPAR_MODE="mock" para probar tarjeta sin cuenta de Pagopar
docker compose up -d                # MySQL 8 en localhost:3306 (base `ecom`)
pnpm db:push                        # schema + FULLTEXT + FK self-ref + contador
pnpm db:seed                        # 4 categorías, 24 productos, 43 variantes, 4 zonas de envío
pnpm create-owner                   # el primer dueño (el resto, desde /admin/usuarios)
pnpm dev                            # http://localhost:3000 · panel en /admin
```

Para ver la tienda con pedidos de verdad en vez de un catálogo vacío, `pnpm demo`
reemplaza los pasos `db:seed` de arriba — ver la sección de abajo.

### La base de los tests de integración (`TEST_DATABASE_URL`)

Los tests de integración corren contra una base **aparte** que el runner
**borra y recrea en cada corrida**. Por eso no está en `.env.example` (Hostinger
lo lee como plantilla del servidor, y una copia apuntada a la base real la
borraría): agregala a mano en tu `.env.local`, sólo en desarrollo.

```dotenv
# El nombre tiene que contener "test": el runner se niega a tocar otra base.
TEST_DATABASE_URL="mysql://ecom:ecom@localhost:3306/ecom_test"
```

Vacía o ausente, esos tests se saltan solos y los unitarios siguen corriendo.
Nunca la apuntes a la base de una tienda — ver `docs/ENV-OPCIONAL.md`.

| Comando                                      | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | lo que corre CI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm test`                                  | unitarios siempre; los de integración necesitan `TEST_DATABASE_URL` (esa base se borra y se recrea en cada corrida)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `pnpm test:unit`                             | sólo los unitarios (`ui` + `unit`, en paralelo, ~15 s, sin base): lo que corre el hook `pre-push`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `pnpm test:e2e`                              | Playwright contra un `next build` de verdad (`tests/e2e/`): compra de invitado (`compra.spec.ts`), la puerta de `/admin`, el CSP (`csp.spec.ts`), el panel de pedidos —tracking, notas, remito— (`panel.spec.ts`), el panel de productos —markdown, destacado, duplicar, acciones masivas— (`productos.spec.ts`), el presupuesto de JS por página (bloquea, `presupuesto.spec.ts`) y las capturas por PR (`capturas.spec.ts`, sólo al artifact de CI). Necesita `DATABASE_URL` con el catálogo sembrado (`pnpm db:push && pnpm db:seed`) y `OWNER_EMAIL`/`OWNER_PASSWORD` (`pnpm create-owner`) — fable/plan.md §6.1, plan-operacion (historial) §6.4 |
| `pnpm db:studio`                             | Drizzle Studio                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `pnpm db:check`                              | prueba la `DATABASE_URL`: imprime con qué usuario, base, host y puerto conecta (nunca la contraseña) y traduce el error si falla. Primer paso de debugging del deploy (DEPLOY.md §3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `pnpm db:seed -- --reset-stock`              | re-siembra pisando `on_hand`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `pnpm demo`                                  | deja la base en un estado mostrable: catálogo + un pedido en cada estado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `pnpm reconcile`                             | control de caja: los totales de cada pedido (incluido el descuento de cupones) más nueve invariantes entre tablas —desde O7, también que el ledger de devoluciones cuadre con `payments.refunded_pyg`—; sale con código 1 si algo no cuadra                                                                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm backfill:pagos-manuales`               | completa la fila de `payments` de los pedidos cobrados por transferencia o contra entrega **antes** de que eso se registrara solo (ARCH.md §5.1). Ensayo por defecto: agregá `--apply` para escribir                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `pnpm backup`                                | copia comprimida de la base en `backups/` (`--retener N` para la limpieza por antigüedad). Se corre desde tu máquina, no desde Hostinger — DEPLOY.md §7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm restore -- <archivo.jsonl.gz>`         | restaura una copia de `/api/cron/backup`. **Sólo** contra una base cuyo nombre tenga `restore` o `test`: el candado no tiene flag para saltearlo (DEPLOY.md §5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm nueva-tienda`                          | wizard de tienda nueva: marca, secretos, `.env.local` y el bloque de variables del hPanel. Idempotente; `--dry-run` no escribe nada — NEW-STORE.md §2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `pnpm importar:productos lista.csv`          | el catálogo del comercio desde su planilla (formato del export del panel + columnas opcionales). Ensayo por defecto; `--aplicar` escribe, `--pisar-stock` pisa `on_hand` — NEW-STORE.md §4                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm bootstrap:repo --destino ../tienda`    | mete el template en un repo que **ya existe y ya tiene algo adentro** (excluye `.git`, no borra nada, se puede correr de nuevo). `--dry-run` primero — NEW-STORE.md §1b                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm setup:doctor`                          | ¿esta máquina puede correr `pnpm nueva-tienda`? Node, pnpm, Docker, los remotos, y si `main` se quedó atrás de otras ramas. `--skip-docker` en un contenedor o sesión en la nube — NEW-STORE.md §1                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `pnpm template:diff`                         | qué arreglos del template le faltan a esta tienda (`--marcar` para fijar el punto de partida) — NEW-STORE.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `pnpm template:sync`                         | trae a esta tienda la maquinaria del template, archivo por archivo en un commit — NEW-STORE.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `pnpm template:ensayar-distribucion`         | (template) ensaya la distribución contra cada tienda de `tiendas.json`, sin empujar nada — NEW-STORE.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm template:probar-tienda`                | arma una tienda nueva desde HEAD en un worktree temporal (wizard + typecheck + unitarios): se corre antes de publicar una versión — CHANGELOG.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `pnpm db:generate`                           | genera la migración de un cambio de schema                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm preflight`                             | qué falta para cobrar plata de verdad (webhook sin confirmar, `CRON_SECRET`, `PAGOPAR_MODE` en producción); sale con código 1 si algo es inseguro                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### `pnpm demo` — la tienda lista para mostrar

Un solo comando después del quickstart de arriba (`db:push` ya corrido, no hace
falta `db:seed` a mano — `pnpm demo` siembra el catálogo él solo):

```bash
pnpm demo
pnpm dev   # y abrí /admin/pedidos
```

Deja sembrado el catálogo (si todavía no lo estaba) y crea un pedido de
ejemplo — nombre, WhatsApp, dirección paraguayos, no genéricos — en cada
estado de la máquina (ARCH.md §3): `pendiente_pago`, `esperando_verificacion`,
`pagado`, `enviado`, `entregado`, `cancelado`, `vencido`. Suma un octavo
pedido con método tarjeta parqueado en la pasarela simulada de Pagopar
(enciende `PAGOPAR_MODE=mock` él solo, sin tocar `.env.local`) e imprime el
link `/dev/pagopar/<hash_pedido>` al final para pagarlo, rechazarlo o
reenviar el aviso desde ahí.

Idempotente: cada pedido de ejemplo se identifica por el teléfono del
cliente, así que correr `pnpm demo` de nuevo reusa lo que ya existe en vez de
duplicarlo. Se niega a correr con `NODE_ENV=production` — es data de mentira,
no algo para dejar suelto donde hay plata de verdad.

### Demo del pago con tarjeta sin cuenta de Pagopar

`PAGOPAR_MODE="mock"` en `.env.local` levanta una Pagopar simulada en memoria:
sin red, sin credenciales y sin cuenta. El checkout vuelve a ofrecer tarjeta y,
en vez de mandar al comprador a Pagopar, lo manda a `/dev/pagopar/<hash_pedido>`
—una pantalla de esta misma app— con un botón por escenario: pagar, reenviar el
mismo aviso, rechazar, pagar de menos, mandar un aviso sin firma válida.

Lo simulado es **la contraparte, no nuestro código**: cada botón postea un aviso
firmado contra la ruta real `POST /api/webhooks/pagopar`, así que el pedido se
mueve por el mismo camino de siempre (firma → idempotencia → verificación de
monto → `transitionOrder()`). Alcanza para ver el ciclo completo
`pendiente_pago → pagado`, con su fila en `order_events` y el stock descontado.

El simulador **no existe en producción**: con `NODE_ENV=production` el modo se
apaga solo y cada función del simulador tira si alguien la llama igual
(`src/domain/pagopar/mode.ts`). Está probado en
`tests/unit/pagopar-mock-mode.test.ts`, y que el camino mockeado ejercite los
mismos guardarraíles que el real, en `tests/integration/pagopar-mock-flow.test.ts`.

## El panel (`/admin`)

Se entra con la cuenta que crea `pnpm create-owner` — **no hay ruta pública de registro**.

`pnpm create-owner` es el **bootstrap del primer dueño y nada más**: el resto de
los usuarios se crean desde `/admin/usuarios`, sin SSH y sin llamar al
desarrollador. Sirve además como rescate (vuelto a correr con un email que ya
existe, le resetea la contraseña y lo devuelve a `owner` activo), que es la
salida si alguien se queda afuera.

| Ruta                  | Qué hace                                                                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin`              | ventas del día y del mes, comprobantes por revisar, stock bajo                                                                                                                                                                                    |
| `/admin/pedidos`      | accesos rápidos por estado con su cuenta, filtros por método/fecha, búsqueda por nro., WhatsApp o RUC, paginación server-side, descarga CSV de lo filtrado                                                                                        |
| `/admin/pedidos/[id]` | ítems, desglose de IVA, datos del cliente, timeline, botón de WhatsApp, aprobar/rechazar comprobante y —mientras no se haya pagado y no sea con tarjeta— editar el pedido: bajar cantidades, quitar una línea, corregir la dirección (ARCH.md §3) |
| `/admin/productos`    | ABM de productos y variantes, fotos, ajuste de stock con motivo obligatorio (auditado), descarga CSV por variante                                                                                                                                 |
| `/admin/usuarios`     | owner-only: quién puede entrar y con qué rol. Alta, cambio de rol, reseteo de contraseña y activar/desactivar. Nadie se borra — se desactiva, y así el historial de lo que hizo sigue siendo consultable                                          |
| `/admin/cupones`      | owner-only: ABM de códigos de descuento con sus usos consumidos. Cero cupones = el checkout no muestra ningún campo de descuento                                                                                                                  |
| `/admin/clientes`     | quién compró, cuántas veces y cuánto gastó — sale de agrupar los pedidos por WhatsApp. Con las cuentas de cliente prendidas marca además quién tiene cuenta y quién aceptó novedades, y el dueño puede bajar esa lista                            |

### `POST /api/setup/init` — inicializar una tienda recién deployada

El slot de Node de Hostinger no tiene `node` en el PATH y el `pnpm install` por
SSH muere con los ulimits del hosting compartido. Esta ruta hace el setup
**desde adentro de la app que ya está corriendo**, con un curl:

```bash
curl -X POST https://TU-DOMINIO/api/setup/init \
  -H "Authorization: Bearer $SETUP_SECRET" \
  -H "content-type: application/json" \
  -d '{"owner":{"email":"...","password":"..."},"zonas":[…]}'
```

Corre las migraciones versionadas de `./drizzle` (no `db:push`, no drizzle-kit
en runtime), aplica los extras, carga las zonas de envío y crea al dueño
(DEPLOY.md §4 tiene el cuerpo completo; `"seed": true` siembra el catálogo de
ejemplo, sólo para demos).
Migrar es idempotente y corre en cada llamada, así que la misma ruta sirve de
corredor de migraciones en los deploys siguientes; sembrar y tocar al dueño se
cierran con la marca de `setup_state` y piden `{"force":true}` para reabrirse.

Mismo candado que el cron: sin `SETUP_SECRET` responde 503, compara en tiempo
constante, está rate-limited y el 401 no dice por qué. **Terminado el setup, se
borra la variable del hPanel y se aprieta Redeploy** — `pnpm preflight` avisa si
quedó puesta. El paso a paso está en [DEPLOY.md](./DEPLOY.md) §4.

### Cron de Hostinger

Vence los pedidos sin pago que pasaron su `reserved_until` y limpia reservas viejas. En el hPanel, cada 15 minutos:

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://TU-DOMINIO/api/cron/vencer-pedidos
```

La ruta compara `CRON_SECRET` en tiempo constante y está rate-limited. Sin la variable configurada responde 503, nunca 200: una ruta "abierta hasta que la configuren" es una ruta abierta.

### `/api/health` — ¿levantó y llega a la base?

```bash
curl -fsS https://TU-DOMINIO/api/health   # {"ok":true,"db":true}
```

Sin autenticar, para que la pueda llamar el monitoreo. Dos booleanos y nada
más: ni versiones, ni nombre de base, ni el error de MySQL. `db:false` con
`ok:true` es la `DATABASE_URL` mal cargada en el panel — de ahí se sigue con
`pnpm db:check`.

Ojo al configurar el monitor: la ruta devuelve **200 igual con `db:false`**, a
propósito, para distinguir "el proceso murió" de "el proceso vive pero no ve
MySQL". Alertá por la palabra clave `"db":true`, no por el código HTTP
(DEPLOY.md §8).

### `pnpm preflight` — antes de cobrar de verdad

Se corre **en el servidor**, después de configurar las variables: la mitad de lo
que revisa es sobre el entorno donde va a correr, no sobre el repo. Contesta una
sola pregunta —si mañana un desconocido compra acá, ¿se pierde algo?— y sale con
código 1 si la respuesta es que sí, para que un deploy automatizado se frene
solo.

```bash
pnpm preflight
```

Bloquea con: `TIENDA.nombre` todavía en el placeholder del template ("TiendaPY"
en el header y en cada link compartido no es un deploy, es un papelón), el sobre
de la respuesta del webhook de Pagopar sin confirmar (TASKS.md §21 — sólo si hay
credenciales de Pagopar cargadas: sin ellas no hay tarjeta ni webhook y queda en
advertencia), `CRON_SECRET` o `SESSION_SECRET` vacíos o demasiado cortos,
Cloudinary sin configurar, y `PAGOPAR_MODE=mock` en un entorno con
`NODE_ENV=production`. Advierte —sin frenar— con las credenciales de Pagopar
faltantes (la tienda cobra igual por transferencia y contra entrega) y con los
`BANCO_*` incompletos: desde la FASE 2 los datos bancarios se cargan desde
`/admin/banco` y el entorno es sólo el fallback, así que vacíos pueden ser
correctos. Quien sabe de verdad si faltan es el panel, que lee la base: `/admin`
le pone un cartel al dueño cuando no hay datos en **ninguna** de las dos
fuentes.

No toca la base ni la red, y nunca imprime el valor de un secreto: sólo si está
y si tiene el largo mínimo.

## Decisiones tomadas

- **Hosting:** Hostinger (cuenta LATAM), slot Node.js + MySQL propio. No Supabase, no Vercel.
- **Pagos MVP:** transferencia SPI/QR manual + contra entrega. Pagopar es el PR #5, post-lanzamiento.
- **Cuentas de compradores opcionales y apagadas por defecto** (`TIENDA.cuentasClientes`): el camino principal sigue siendo el link con token vía WhatsApp + búsqueda por nro. de pedido y teléfono. El checkout de invitado no cambia nunca — ver NEW-STORE.md §4b.
- **Sin facturación legal en el MVP.** El schema queda listo para conectar FacturaPY después (contrato en `ARCH.md` §7).

## Reglas no negociables

- Todo monto es **entero** en guaraníes (`BIGINT UNSIGNED`). Nunca `float`, nunca `DECIMAL`, nunca `toFixed(2)`. Vale también para los descuentos: el navegador manda el **código** del cupón, nunca el monto.
- Precios son **IVA incluido**. El IVA se desglosa, no se suma encima.
- El navegador nunca decide precios ni stock — el servidor recalcula todo desde la DB.
- El estado de un pedido sólo cambia vía `transitionOrder()`. Nunca un `UPDATE orders SET status` suelto.
- Nada de secretos con prefijo `NEXT_PUBLIC_`.
- **Toda** server action de `/admin` llama a `requireAdminSession()` como primera línea. El proxy que protege `/admin/*` es UX: una server action es un endpoint HTTP propio y se la puede invocar sin pasar por ninguna URL `/admin`.

Cada una de estas reglas tiene un test que la verifica sobre el código en CI (`tests/unit/no-raw-status-update.test.ts`, `money-path.test.ts`, `admin-guards.test.ts`, `security-review.test.ts`): un checklist que se corrió una vez a mano se rompe en el commit siguiente.

# Productos.com.py

Tienda general para Paraguay, en español y guaraníes enteros. Basada en el template verificado `c5422e3c9184f0c4e4575da3db2774329d063214`, con administración, importación de catálogo, cuentas opcionales, checkout de invitado, inventario, pagos y recuperación originales.

**Estado inicial: catálogo comercial en preparación.** No se suministraron productos, precios, stock, contacto, banco ni condiciones de entrega reales. Los seis ejemplos de `pnpm preview:catalog` son sólo para una base local aislada y usan `showcase`, precios ocultos y stock cero. No siembres demos en producción ni conectes una base antigua sin revisión y backup.

- [Configuración exacta de Hostinger, vista previa y requisitos para abrir](docs/HOSTINGER-STORE.md)
- [Informe de validación](docs/VALIDATION.md)
- Identidad y categorías iniciales: `src/config/tienda.ts`. Datos reales editables desde `/admin`.
- Node 22 · pnpm 11.22.0 · `pnpm install --frozen-lockfile` · `pnpm build` (webpack) · `pnpm start`.

---
