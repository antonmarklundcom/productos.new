# Deploy a Hostinger (Websites → Node.js + MySQL)

Este es el runbook del deploy, adentro del repo y no en la cabeza de nadie.
Vale para cualquier tienda salida de este template: el producto de Hostinger es
**Websites** con la app de Node.js conectada a git, y la base es un MySQL del
mismo hPanel.

El orden importa. Cada sección de acá abajo salió de algo que ya rompió una vez.

---

## 1. Conectar el repo (git deploy)

En el hPanel, dentro del sitio:

1. **Websites → tu sitio → Advanced → GIT**: pegá la URL del repo y la rama
   (`main`). Si el repo es privado, copiá la clave pública que muestra
   Hostinger y cargala como *deploy key* en GitHub (Settings → Deploy keys).
2. **Node.js**: versión **22** (la misma de `.nvmrc` y del CI), y los comandos:

   | Campo | Valor |
   |---|---|
   | Install command | `pnpm install --frozen-lockfile` |
   | Build command | `pnpm build` |
   | Start command | `pnpm start` |

   **Los tres hay que escribirlos a mano.** Hostinger detecta el proyecto y
   propone `npm install` / `npm run build` / `npm start`, y con eso el deploy
   *parece* andar: npm ignora `pnpm-lock.yaml`, resuelve el árbol de nuevo por
   su cuenta y te deja en producción versiones que nadie testeó — o directamente
   se cae contra `pnpm-workspace.yaml`. Pisá los tres campos antes del primer
   deploy y verificá que quedaron guardados: el panel a veces los vuelve a su
   valor detectado si guardás la sección dos veces.

3. **Environment variables**: Hostinger lee `.env.example` y precarga un campo
   por variable. Son **sólo las cinco imprescindibles** —`DATABASE_URL`,
   `SESSION_SECRET`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET` y `SETUP_SECRET`—
   más `NODE_ENV=production`, que lo pone el hosting (si no, agregalo). Los
    `pnpm nueva-tienda` lista las claves y guarda los secretos en `.env.local`:
    copiá sus valores desde ese archivo al panel, sin comillas. `DATABASE_URL`
   sale de la base del §2.

   Todo lo demás es **opcional** y está documentado, con sus trampas, en
   [docs/ENV-OPCIONAL.md](./docs/ENV-OPCIONAL.md): `WHATSAPP_NUMBER`,
   `CLOUDINARY_*`, `PAGOPAR_*` si va con tarjeta, `WHATSAPP_CLOUD_*`, GA4/Pixel,
   `ERROR_REPORT_URL`. Agregá a mano (botón "Add") sólo las que esta tienda
   usa; vacía o ausente, cada una apaga su feature y no rompe nada.

   Mejor todavía: **no las cargues en el hPanel**. Cloudinary, WhatsApp
   (número y Cloud API), Pagopar, GA4/Pixel y `ERROR_REPORT_URL` se cargan
   desde `/admin/integraciones` con la tienda arriba, cifrados en la base y sin
   Redeploy (NEW-STORE.md §4a-ter). Las variables siguen funcionando como
   fallback: lo que se carga en el panel manda sobre ellas.

   Los `BANCO_*` **ya no hacen falta acá**: los datos bancarios se cargan una
   vez desde `/admin/banco` con la tienda arriba, y eso es lo que conviene —
   corregir un dígito del número de cuenta desde el hPanel obliga a un
   Redeploy (ver el aviso de abajo), y desde el panel es un botón. Siguen
   funcionando como fallback para las tiendas que ya los tenían cargados: si
   están puestos y la tabla está vacía, la tienda muestra los del entorno.

   No hay `.env.local` en el servidor: en Hostinger las variables viven en el
   panel, no en un archivo. Lo que no cargues ahí, no existe.

> **Cambiar una variable en el panel de Hostinger NO reinicia ni rebuildea la
> app.** Guardás el valor nuevo, el panel te dice "guardado", y el proceso que
> está atendiendo sigue corriendo con el build viejo y los valores viejos. Hay
> que apretar **Redeploy** a mano. Esto es la causa número uno de "cambié la
> contraseña de la base y el sitio sigue tirando Access denied".

**Trampa:** el deploy automático por push también arrastra esto. Un push
rebuildea, pero un cambio de variable sin push no dispara nada — si tocaste
sólo variables, Redeploy es obligatorio.

### Las `NEXT_PUBLIC_*` se hornean en el build, no se leen al arrancar

`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_GA4_ID` y `NEXT_PUBLIC_META_PIXEL_ID` no
son variables que el servidor lea cuando atiende un request: Next las
**reemplaza por su valor dentro del JavaScript** mientras buildea. O sea que
cambiarlas en el hPanel y reiniciar el proceso no cambia nada, ni siquiera
después de un restart: hay que **rebuildear** (Redeploy), porque el valor viejo
está escrito adentro de los archivos ya compilados.

Se nota tarde y de formas raras: los links compartidos por WhatsApp siguen sin
foto porque la URL de Open Graph quedó en `localhost`, o Analytics no mide
porque el ID viejo sigue adentro del bundle. Si cambiaste una `NEXT_PUBLIC_*`,
Redeploy, y recién después probá.

### Deployar antes de que el dominio apunte

No hace falta esperar al DNS para tener la tienda arriba. Cada sitio de
Hostinger viene con una URL temporal del tipo
`https://algo-algo-123456.hostingersite.com`, y sirve para el deploy completo:
build, base, `/api/setup/init`, `create-owner` y la prueba de humo del §6.

Lo único que hay que hacer bien es `NEXT_PUBLIC_SITE_URL`: **poné ahí la URL
temporal mientras uses la URL temporal**. Con el dominio final cargado antes de
tiempo, el sitio anda pero se sabotea solo — los links de Open Graph y el
sitemap apuntan a un dominio que todavía no resuelve, y las cookies de sesión
del panel se emiten para otro host. Con la URL temporal, en cambio, todo cierra
y podés probar de verdad.

Cuando el DNS del dominio real ya resuelve: cargá el dominio en el hPanel,
cambiá `NEXT_PUBLIC_SITE_URL` al dominio final, **Redeploy** (es una
`NEXT_PUBLIC_*`, ver arriba), y recién ahí registrá la URL de respuesta de
Pagopar y el cron del §5 con el dominio definitivo. Correr `pnpm preflight`
después del cambio confirma que no quedó nada apuntando a la URL vieja.

---

## 2. Trampas del SSH de Hostinger

Con la ruta de setup del punto 4 (`POST /api/setup/init`) **no deberías
necesitar SSH para nada**. Queda documentado igual, porque el día que entres
por SSH a debuggear te vas a comer estas tres, y las tres parecen bugs del repo
cuando en realidad son los ulimits del hosting compartido: los planes con SSH
limitan la cantidad de threads por proceso, y las herramientas modernas de JS
asumen que pueden abrir todos los que quieran.

### `pnpm install` muere con `[ERR_WORKER_INIT_FAILED]` / `EAGAIN`

pnpm 10 resuelve el árbol con worker threads. Bajo el límite de threads, el
primer worker no arranca y pnpm aborta. Reintentar lo empeora: cada intento
deja procesos colgados y el siguiente arranca con menos margen todavía.

Workaround, sin worker threads:

```bash
npm install --legacy-peer-deps
```

### `tsx` / `drizzle-kit` panican con `newosproc`

El binario de esbuild que usa `tsx` (y por debajo `drizzle-kit`) es Go, y el
runtime de Go intenta abrir un thread por CPU visible. Bajo el mismo límite
revienta con un panic de `runtime: newosproc` y un volcado de stack que no
tiene nada que ver con tu código.

Workaround, antes de **cualquier** comando `tsx` o `drizzle-kit`:

```bash
export GOMAXPROCS=1
```

### `node` y `npm` no están en el PATH, y el checkout no es la app

Al entrar por SSH no hay `node`. Los binarios viven adentro del directorio de
la app de Node.js; buscalos con:

```bash
ls ~/.nvm/versions/node
export PATH="$HOME/.nvm/versions/node/v22.*/bin:$PATH"
node -v
```

**Trampa:** el checkout de git queda en `hbuilds/last-source/` y **ese no es el
filesystem de la app que está corriendo**. Es la fuente desde donde Hostinger
buildea. Editar ahí no cambia nada de lo que sirve el sitio, y correr un script
ahí puede correrlo contra un `.env` que no es el que usa la app. Si necesitás
tocar la base, hacelo desde tu máquina con la URL remota, o mejor: usá la ruta
de setup.

---

## 3. Base de datos

### Crear la base y el usuario

hPanel → **Databases → Management**. Creás base y usuario en el mismo
formulario.

**Trampa:** el panel lista **"MySQL Database"** y **"MySQL User"** en dos
columnas pegadas, con nombres casi idénticos (`u123456789_tienda` y
`u123456789_tiendausr`). Transponerlas es el error más común del deploy, y el
error que devuelve MySQL —`Access denied`— no dice cuál de las dos está mal.

Ante cualquier duda, el **primer** paso de debugging es:

```bash
pnpm db:check
```

Te imprime en castellano con qué usuario, contra qué base, en qué host y en qué
puerto va a conectar (nunca la contraseña), corre un `SELECT 1` y te dice qué
significa el error si falla.

### Remote MySQL

Para correr `pnpm db:check`, `pnpm db:push` o `pnpm reconcile` desde tu
máquina, la base tiene que aceptar conexiones de afuera: hPanel → **Databases →
Remote MySQL** → agregá tu IP pública (o `%` sólo mientras debuggeás, y sacalo
después).

Sin eso el error es `ETIMEDOUT` o `ECONNREFUSED` y parece que la base está
caída, cuando lo único que pasa es que tu IP no está en la lista.

### Cambiar la contraseña de la base

```
cambiaste la contraseña en el hPanel
  → DATABASE_URL de la app quedó con la contraseña vieja
  → la tienda entera tira Access denied
```

Cambiar la contraseña **no** actualiza la variable de la app. Hay que hacer las
dos cosas:

1. Editar `DATABASE_URL` en las Environment variables del sitio.
2. Apretar **Redeploy** (ver el punto 1: guardar la variable no reinicia nada).

**Trampa:** si la contraseña tiene `?`, `#`, `@` o `/`, hay que URL-encodearla o
`mysql2` parsea cualquier cosa. Lo más simple es generar contraseñas sin
símbolos raros.

---

## 4. Primer deploy de una tienda nueva

Sin SSH y sin Node instalado en el servidor: la app que ya está corriendo se
inicializa sola.

**El camino corto, sin terminal:** con `SETUP_SECRET` cargado y la app
deployada, abrí **`https://DOMAIN/setup`**, pegá el secreto, el email y la
contraseña del dueño, y apretá "Inicializar". Es exactamente el mismo POST que
el curl de abajo (mismo candado, misma respuesta: los pasos y lo que falta para
cobrar). Sin `SETUP_SECRET` esa página no existe. El curl sigue sirviendo para
lo que el formulario no ofrece (las zonas de envío en bloque, o para
automatizarlo).

1. **Cargá las variables** en el hPanel (punto 1), incluida `SETUP_SECRET` —
   mínimo 16 caracteres, `openssl rand -base64 32`.
2. **Deploy** (push, o Redeploy si sólo tocaste variables).
3. **Inicializá la tienda**:

   ```bash
   curl -X POST https://DOMAIN/api/setup/init \
     -H "Authorization: Bearer $SETUP_SECRET" \
     -H "content-type: application/json" \
     -d @setup.json
   ```

   con un `setup.json` así (el dueño y las zonas de envío reales):

   ```json
   {
     "owner": { "email": "...", "password": "..." },
     "zonas": [
       { "slug": "asuncion", "name": "Asunción", "cities": ["Asunción"], "pricePyg": 25000, "freeThresholdPyg": 500000 },
       { "slug": "gran-asuncion", "name": "Gran Asunción", "cities": ["San Lorenzo", "Fernando de la Mora", "Luque", "Lambaré", "Capiatá", "Ñemby", "Mariano Roque Alonso", "Villa Elisa", "Limpio"], "pricePyg": 35000, "freeThresholdPyg": 700000 },
       { "slug": "interior", "name": "Interior", "cities": [], "pricePyg": 60000 }
     ]
   }
   ```

   **Las zonas no son opcionales:** sin ninguna activa, el envío sale **gratis a
   todo el país** (el resumen del panel lo avisa). Precios de ejemplo — poné
   los tuyos; también se ajustan después en `/admin/envios`.

   Corre las migraciones de `./drizzle`, aplica los extras (FULLTEXT, FK
   self-ref, contador de pedidos) y crea la cuenta del dueño. **Sin
   `"seed": true` en una tienda real:** eso siembra el catálogo de ejemplo
   (auriculares, termos, remeras, con stock de mentira) y queda a la venta al
   lado del tuyo. Es para una demo o un staging; si ya lo sembraste, el
   resumen del panel te avisa cuántos quedan activos. El catálogo real entra
   por `/admin/productos` → Importar planilla.

   Responde con el resultado de cada paso **y con el reporte completo de `pnpm
   preflight`**, medido contra el entorno de este servidor — que es el único
   que importa.

   Las zonas son upsert por `slug`, así que repetir la llamada actualiza en vez de duplicar.
   **No borra las zonas que no vengan en la lista**: borrar una zona que la
   tienda usa no se ofrece por HTTP.

4. **Verificá**:

   ```bash
   curl -fsS https://DOMAIN/api/health   # {"ok":true,"db":true,"cron":…}
   ```

   El `preflight` ya vino en la respuesta del paso 3 (mirá `blocking` y los
   checks con severidad `bloquea`). Correr `pnpm preflight` desde tu máquina
   mide tu `.env.local`, no el del servidor: sirve como ensayo, no como
   verificación del deploy.

5. **Sacá `SETUP_SECRET`** de las Environment variables y apretá **Redeploy**.
   La ruta vuelve a responder 503 y ahí queda para siempre.

**Trampa:** el paso 5 no es opcional y no se hace solo. Guardar la variable
—o borrarla— no reinicia nada: hasta el Redeploy, el proceso viejo sigue con el
secreto en memoria y la ruta viva. `pnpm preflight` avisa si `SETUP_SECRET`
quedó puesta en producción.

### Llamarla de nuevo

Las migraciones y los extras son idempotentes y corren en **cada** llamada, así
que la misma ruta es el corredor de migraciones de los deploys siguientes:

```bash
curl -X POST https://DOMAIN/api/setup/init \
  -H "Authorization: Bearer $SETUP_SECRET" \
  -H "content-type: application/json" -d '{}'
```

Lo que no se repite solo es lo que escribe datos del negocio: con la tienda ya
inicializada, un `seed`, unas `zonas` o un `owner` responden **409** con el
resumen de lo que ya estaba, en vez de volver a sembrar el catálogo sobre una
tienda que ya vende.
Para reabrirlos hay que pedirlo con `{"force":true}`. El stock nunca se resetea
por esta vía, ni con `force`.

### Si preferís hacerlo a mano

Sigue funcionando, contra la base remota (Remote MySQL habilitado, punto 3):

```bash
pnpm db:check      # ¿la URL de la base es la correcta?
pnpm db:push       # schema + FULLTEXT + FK + contador
pnpm db:seed       # catálogo de ejemplo — reemplazalo por el real
pnpm create-owner  # única forma de crear usuario del panel
```

**Trampa:** `db:push` compara contra `schema.ts` y decide él solo qué ALTER
correr — está bien para desarrollo, no para una base con pedidos adentro. La
ruta de setup corre las migraciones versionadas de `./drizzle`, que es lo que
se revisó en un PR.

---

## 5. Cron: las tres entradas del hPanel

Tres rutas, tres entradas en **hPanel → Advanced → Cron Jobs**. Hostinger
interpreta la hora del cron en **UTC**, y Paraguay está en **UTC−3 todo el
año** (sin horario de verano desde 2024) — la columna de la derecha ya trae
la resta hecha:

| Ruta | Frecuencia | Hora Asunción | Hora UTC (expresión cron) | Qué hace si falta la variable |
|---|---|---|---|---|
| `/api/cron/vencer-pedidos` | cada 15 min | — | `*/15 * * * *` | Sin `CRON_SECRET` (≥16 caracteres), 503: nunca vence nada sin secreto. Desde O15 manda además los recordatorios de pago; sin su plantilla, no manda ninguno y vence igual |
| `/api/cron/resumen-diario` | diaria | 08:00 | `0 11 * * *` | Sin `WHATSAPP_CLOUD_TEMPLATE_RESUMEN_DIARIO`, corre igual y no manda nada (`sent: false`) |
| `/api/cron/backup` | diaria | 03:00 | `0 6 * * *` | Sin credenciales de Cloudinary, se saltea sola (`skipped: "sin_cloudinary"`) |

Las tres comparten el mismo `CRON_SECRET` (`src/lib/cron-auth.ts`): 503 sin
secreto configurado, comparación en tiempo constante, rate-limited, header
`Authorization: Bearer` o `?secret=` como plan B (ver la trampa del `?secret=`
más abajo). Detalle de cada una:

### La primera entrada: vencer pedidos (cada 15 minutos)

`/api/cron/vencer-pedidos` vence los pedidos sin pago y limpia reservas viejas.
Sin él, los pedidos muertos quedan para siempre en `pendiente_pago` y el panel
miente.

Desde O15 la misma corrida manda también el **recordatorio de pago**: a cada
pedido sin pagar al que le quedan menos de 6 h de reserva le sale un WhatsApp,
una sola vez, **después** de vencer los que ya se pasaron. No hay entrada nueva
que agregar acá — es ésta. Necesita
`WHATSAPP_CLOUD_TEMPLATE_CLIENTE_RECORDATORIO` (NEW-STORE.md §4c); sin esa
variable el cron hace exactamente lo de siempre y no manda nada. La respuesta
JSON trae `paymentReminders: { candidatos, enviados, fallidos }`, que es por
dónde mirar si el dueño dice que las compradoras no reciben el aviso.

hPanel → **Advanced → Cron Jobs** → cada 15 minutos:

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://TU-DOMINIO/api/cron/vencer-pedidos
```

**Trampa:** si el cron de tu plan no deja mandar headers, la ruta también acepta
`?secret=...`, pero entonces el secreto queda escrito en los logs de acceso del
servidor. Preferí el header siempre que se pueda.

Sin `CRON_SECRET` configurado (o con menos de 16 caracteres) la ruta responde
503 y no vence nada: una ruta "abierta hasta que la configuren" es una ruta
abierta.

### La segunda entrada: el resumen diario (O6)

`/api/cron/resumen-diario` le manda al dueño, por WhatsApp, las cuatro cosas
que hay que mirar antes de abrir: comprobantes por revisar, pedidos sin pagar
hace más de un día, stock bajo y las ventas de ayer. De paso barre los avisos
pendientes de "avisame cuando haya stock".

hPanel → **Advanced → Cron Jobs** → una vez por día, **08:00 de Asunción**.
Hostinger interpreta la hora del cron en UTC, y Paraguay está en **UTC−3 todo
el año** (no hay horario de verano desde 2024), así que 08:00 PY = **11:00
UTC**:

```bash
# minuto 0, hora 11 (UTC) = 08:00 en Asunción
0 11 * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://TU-DOMINIO/api/cron/resumen-diario
```

Mismo secreto que la otra ruta, misma trampa del `?secret=`.

**Se puede llamar de más sin miedo.** El resumen sale **una sola vez por día
calendario de Asunción** aunque el cron pegue diez veces: la decisión se toma
en `job_runs` con la fila bloqueada. Una llamada de más contesta `200` con
`skipped: "ya_corrio_hoy"` y no manda nada — a propósito no es un error, porque
un status de error haría que Hostinger reintentara al pedo.

Sin `WHATSAPP_CLOUD_TEMPLATE_RESUMEN_DIARIO` cargada, la ruta corre igual y no
manda nada (`sent: false`). `pnpm preflight` avisa si falta.

### La tercera entrada: la copia de seguridad (O8)

`/api/cron/backup` vuelca la base entera a Cloudinary, comprimida y privada.
De madrugada, cuando no hay nadie comprando — **03:00 de Asunción = 06:00 UTC**:

```bash
# minuto 0, hora 6 (UTC) = 03:00 en Asunción
0 6 * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://TU-DOMINIO/api/cron/backup
```

Sin credenciales de Cloudinary la ruta se saltea sola y contesta `200` con
`skipped: "sin_cloudinary"`: no hay dónde guardar la copia. `pnpm preflight`
lo avisa.

**Dos corridas nunca se pisan**: el lock de `job_runs` tiene expiración (30
minutos), porque un proceso que se muere no libera nada y un lock eterno
dejaría al comercio sin copias sin que nadie se entere. **Y si falla, al dueño
le llega un WhatsApp** (reusa la plantilla del resumen diario): un backup que
falla en silencio es peor que no tener backup, porque da la tranquilidad sin
dar la copia.

Las copias viven en `<prefijo>backups/` como `raw` + `authenticated` —sin firma
no se descargan— y se borran solas a los 14 días. La retención no es prolijidad:
sin ella la cuenta de Cloudinary se llena y deja de aceptar **la copia de hoy**.

`pnpm backup` (mysqldump desde tu máquina) sigue existiendo y sigue siendo el
camino "grande". Éste es el que corre solo.

### Restaurar una copia

```bash
# 1. Bajá el archivo de Cloudinary (Media Library → backups/, "Download").
# 2. Creá una base NUEVA para restaurar. El nombre TIENE que contener
#    "restore" o "test" — el script se niega a correr contra cualquier otra.
# 3. Apuntá DATABASE_URL a esa base y restaurá:
pnpm restore -- backup-2026-08-12T0300.jsonl.gz
# 4. Mirá que esté todo (pnpm reconcile, entrá al panel).
# 5. Recién entonces decidí qué hacer con la base de producción.
```

El candado del paso 2 es a propósito y no tiene flag para saltearlo: un
`pnpm restore` corrido con el `.env` de producción cargado por accidente
—el error más fácil del mundo, y el más caro— borraría la tienda en vez de
recuperarla.

### Los logs

Desde O8 el servidor escribe **una línea JSON por evento**
(`{"ts":…,"level":…,"msg":…,"reqId":…}`). En el hPanel, Node.js → Logs:

```bash
grep '"level":"error"' logs.txt            # sólo los errores
grep '"reqId":"abc-123"' logs.txt          # todo lo de un request
```

El `reqId` viaja también en el header `x-request-id` de cada respuesta: si una
compradora reporta un problema y puede mandar ese valor, se ve exactamente qué
pasó en su request. **Los teléfonos, tokens y secretos nunca salen en el log**:
el logger los redacta por nombre de campo.

---

## 6. Prueba de humo post-deploy

```bash
curl -fsS https://TU-DOMINIO/api/health
```

Tiene que devolver `{"ok":true,"db":true,"cron":true}`. `db:false` significa
que la app levantó pero no llega a MySQL — volvé al punto 3 con `pnpm
db:check`. `cron:false` es que `vencer-pedidos` todavía no corrió (o no corre
desde hace 2 h): revisá el punto 5 — recién configurado, esperá 15 minutos.

Y desde tu máquina, apuntando al entorno real:

```bash
pnpm preflight
```

Lista qué falta para cobrar plata de verdad (datos bancarios, `CRON_SECRET`,
modo de la pasarela, Cloudinary) y sale con código 1 si algo bloquea. No toca la
base ni la red, así que se puede correr todas las veces que quieras.

Después, a mano: entrar a la tienda, agregar algo al carrito, llegar al
checkout, y entrar a `/admin` con la cuenta del dueño.

### ¿El redeploy tomó de verdad?

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://TU-DOMINIO/api/version
```

Devuelve `{"sha","builtAt","node"}` (ARCH.md § "Observabilidad") — el SHA corto
del build que está corriendo. Compará contra el commit que acabás de deployar;
si no coincide, el redeploy de Hostinger no levantó el build nuevo (ver el
punto 2, cache del build). Mismo `CRON_SECRET` que las tres rutas de cron: sin
él, 503.

---

## 7. Copias de la base

La tienda guarda pedidos, pagos y comprobantes de plata que entró de verdad. Si
mañana la base desaparece —un `DROP` con la base equivocada, un plan que se
vence, un disco— sin copia no hay a quién reclamarle.

Desde **tu máquina**, con Remote MySQL habilitado (punto 3):

```bash
pnpm backup                 # copia comprimida en backups/
pnpm backup --retener 30    # y borra las de más de 30 días (default: 14)
```

Deja un `.sql.gz` con la fecha en el nombre, así ordenar por nombre es ordenar
por fecha. `backups/` está en `.gitignore`: son datos de clientes, nunca van al
repo.

No corre en el servidor: en el slot de Node de Hostinger no hay `mysqldump` y
conseguirlo pelea con los mismos ulimits del punto 2. Corré esto desde tu
máquina o desde cualquier máquina con `mysql-client` instalado.

**Trampa:** una copia que nunca restauraste no es una copia, es un archivo.
Probá el camino completo **hoy**, contra una base vacía, no el día que la
necesites:

```bash
mysql -h HOST -u USUARIO -p -e "CREATE DATABASE prueba_restore"
gunzip -c backups/TU-COPIA.sql.gz | mysql -h HOST -u USUARIO -p prueba_restore
```

Y contá las tablas y los productos ahí adentro antes de confiar.

Para que corra sola, en tu máquina (no en Hostinger), un cron diario:

```bash
0 3 * * * cd /ruta/al/repo && /usr/local/bin/pnpm backup >> backups/backup.log 2>&1
```

El hPanel de Hostinger también ofrece sus propias copias según el plan. Usá las
dos: la de ellos te salva del disco, ésta te salva de vos.

---

## 8. Monitoreo

`/api/health` ya contesta si la tienda está viva; falta alguien que lo pregunte
cada tanto. Cualquier servicio de uptime gratis sirve (UptimeRobot, Better
Stack, Hetrix): apuntalo a `https://TU-DOMINIO/api/health` cada 5 minutos.

> **Configuralo por palabra clave, no por código HTTP.** La ruta devuelve **200
> igual cuando no llega a la base** —`{"ok":true,"db":false}`— justamente para
> poder distinguir "el proceso murió" de "el proceso vive pero no ve MySQL". Un
> monitor que sólo mira el 200 te va a decir que todo anda mientras la tienda no
> puede vender nada.

En el monitor, entonces: alertar si la respuesta **no contiene**
`"db":true,"cron":true`. El `cron` es el otro silencio: `false` si
`vencer-pedidos` no corrió en las últimas 2 horas (§5) — sin él no vence
ningún pedido sin pagar, el stock queda reservado y no sale ningún
recordatorio de pago.

Con varias tiendas, uno por tienda y con el nombre del comercio en la alerta:
a las 3 de la mañana no vas a adivinar cuál de las cuatro se cayó.
