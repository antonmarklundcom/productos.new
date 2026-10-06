# Tienda nueva a partir de este template

Este repo es un **template repository** de GitHub: cada tienda nueva sale de
"Use this template" → repo propio, historia limpia, sin relación de fork con
el original. No copies carpetas a mano y no hagas fork.

La idea del template: **la maquinaria ya está hecha y no se toca**. Por tienda
sólo hay cuatro trabajos — marca, diseño, base de datos, productos.

## En una página

1. GitHub → **Use this template** → repo **privado** nuevo para la tienda.
2. `git clone` · `pnpm install` · `git remote add template https://github.com/antonmarklundcom/ecom.git`
3. `pnpm setup:doctor` → `pnpm nueva-tienda` (marca, WhatsApp **real**, dominio,
   tema; borra `fable/`, Dependabot y `tiendas.json`, que son del template) → commit + push.
4. En el repo nuevo: crear el label `ci-completo` (Issues → Labels) para pedir
   el e2e cuando haga falta. Ver § "CI y minutos de Actions".
5. Base, catálogo y dueño (§4) · diseño (§5) · cuentas de terceros (tabla de
   abajo) · deploy (DEPLOY.md).
6. `pnpm preflight` en verde → recién ahí se cobra (§6).
7. En el template: agregar la tienda a `tiendas.json` (con dominio y dónde está
   hosteada) para que le lleguen las versiones nuevas.

---

**Los pasos de la base de datos corrélos en tu máquina, en una terminal.**
`docker compose up -d`, `db:push`, `db:seed` y `create-owner` necesitan Docker
Desktop corriendo de verdad, y un contenedor de Claude Code en la nube no tiene
daemon de Docker.

Todo lo demás —el bootstrap, `pnpm nueva-tienda`, el rediseño, el catálogo—
anda igual desde una sesión en la nube, que en la práctica es de donde salieron
las primeras tiendas. `pnpm setup:doctor` reconoce solo ese entorno y degrada el
control de Docker a advertencia en vez de bloquearte; si no lo detecta, forzalo
con `pnpm setup:doctor --skip-docker`. Lo que queda pendiente en ese caso son
los cuatro comandos de arriba, en una máquina con Docker, antes de que la tienda
pueda levantar.

## El camino corto

```bash
git clone <tu-repo> && cd <tu-repo> && pnpm install
git remote add template https://github.com/antonmarklundcom/ecom.git
pnpm setup:doctor              # ¿Node, pnpm, Docker y los remotos están listos?
pnpm nueva-tienda        # seis preguntas: marca, WhatsApp, dominio
docker compose up -d && pnpm db:push && pnpm db:seed && pnpm create-owner
pnpm preflight
```

Eso es si el repo salió de "Use this template" y está vacío. **Si el repo de la
tienda ya existe y ya tiene algo adentro**, el primer paso es otro:
`pnpm bootstrap:repo` — ver §1b.

`pnpm setup:doctor` revisa la máquina, no la tienda: versión de Node contra
`.nvmrc`, versión de pnpm contra `packageManager`, si el daemon de Docker
responde, si los remotos `origin` y `template` son alcanzables (esto último
agarra el caso de una SSH key de GitHub que todavía no está cargada) y si `main`
se quedó atrás de trabajo que vive sin mergear en otras ramas. Corré esto
**antes** de `pnpm nueva-tienda`: los tres problemas que más tiempo hacen
perder — Docker Desktop cerrado, SSH sin configurar, Node viejo — se ven todos
juntos acá en vez de descubrirse uno por uno a mitad del wizard.

```bash
pnpm setup:doctor                 # todo
pnpm setup:doctor --skip-docker   # sé que acá no hay Docker; no me bloquees por eso
```

**El aviso de "main se quedó atrás"** sale de una tienda real: `main` tenía un
ajuste de CI y nada más, mientras meses de trabajo ya mergeado en PRs —marca,
catálogo, rediseño de la home, preparación del deploy— vivían en ramas que
nadie bajó. Nada lo avisaba; se descubrió a mano con `git log` cuando ya
molestaba, y para entonces media sesión se había ido en rehacer cosas que ya
estaban hechas. El doctor mira ahora las ramas locales y las de `origin`, y
avisa si hay dos o más sin mergear cuya punta es más nueva que la de `main` por
más de dos semanas (o una sola con más de mes y medio). Es sólo una advertencia
y nunca bloquea: una rama en vuelo es normal y no tiene que hacer ruido.

Eso es todo lo que se puede automatizar. **Lo único que queda a mano es lo de
terceros**, porque son cuentas de otro que nadie puede abrir por vos:

| Qué | Dónde | Para qué |
|---|---|---|
| Hosting y base | hPanel de Hostinger | `DATABASE_URL` y el deploy (DEPLOY.md) |
| Dominio | tu registrador | `NEXT_PUBLIC_SITE_URL` — el wizard ya lo escribe, falta apuntarlo |
| Cloudinary | cloudinary.com → `/admin/integraciones` | fotos de producto y comprobantes de pago (§4a-ter) |
| Pagopar | el comercio → `/admin/integraciones` | sólo si va con tarjeta; sin credenciales el checkout no la ofrece |
| Datos bancarios | `/admin/banco`, con la tienda arriba | a dónde transfieren (§4a) |
| Fotos y favicon | el comercio | `src/app/favicon.ico` y `/admin/productos` |
| Medición (opcional) | GA4 / Meta Business → `/admin/integraciones` | el ID de GA4 y/o del Pixel — con eso el sitio mide visitas y ventas (evento de compra incluido); vacíos, no carga ni un byte de terceros |

El resto de este documento es el detalle de cada paso: leelo si algo no
cuadra, o si querés saber por qué el wizard hace lo que hace.

---

## Checklist (en orden)

### 1. Crear el repo

1. En GitHub, "Use this template" → repo nuevo (ej. `ropa-store`).
2. `git clone` y `pnpm install`.
3. Agregá el remoto del template **ahora**, no el día que lo necesites:

   ```bash
   git remote add template https://github.com/antonmarklundcom/ecom.git
   ```

   `pnpm nueva-tienda` (paso 2) corre `template:diff --marcar --origen` solo y
   deja `.template-baseline` escrito —commitealo— con el commit del template
   del que salió la tienda (el que tiene el árbol de su primer commit, no la
   punta de hoy); si ya existe, no lo toca. Sin el remoto no puede, te lo
   avisa, y el primer `pnpm template:diff` corre en modo degradado con los
   commits del template apareciendo todos, para siempre (ver "Arreglos que
   aparecen después" al final).

4. `pnpm setup:doctor` — confirma que Node, pnpm, Docker y los dos remotos están
   listos antes de seguir. Es la máquina, no la tienda; `pnpm preflight`
   (paso 6) es la otra mitad, la de si esta tienda ya puede cobrar.

### 1b. Si el repo ya existe y ya tiene algo adentro

El paso 1 supone el camino de GitHub: repo nuevo, vacío, creado con "Use this
template". En la práctica pasa seguido lo contrario — las tres primeras tiendas
(`productos`, `lenceria`, `mascota`) ya tenían repo propio, con historia,
remoto y contenido, de antes de que este template existiera. Para ésas "Use this
template" no sirve: crearía un repo distinto y habría que mudar todo.

Para ese caso está `pnpm bootstrap:repo`, que copia el árbol del template
adentro de un repo que ya existe:

```bash
# parado en el template
cd ecom
pnpm bootstrap:repo --destino ../lenceria --dry-run   # qué haría
pnpm bootstrap:repo --destino ../lenceria             # hacerlo
```

**No lo hagas a mano.** Lo que sale natural es `cp -a ecom/. ../lenceria/`, y
eso copia también el `.git` del template encima del `.git` del destino: al repo
de la tienda le quedan la historia y el remoto del template. No falla, no avisa;
se descubre al hacer `git push`. `.git` es la primera línea de la lista de
exclusiones del script, y hay un test que lo fija.

Lo que hace y lo que no:

- **excluye** `.git`, `node_modules`, `.next`, `out`, `coverage`, `backups/`,
  `.claude/` y todos los `.env*` menos `.env.example`. Tampoco copia
  `.template-baseline`: ese archivo dice hasta dónde está al día **esa** tienda
  (ver el final de este documento), así que lo escribe `pnpm nueva-tienda` en el
  destino, no el template;
- **no borra nada.** Lo que ya estaba en el destino y el template no conoce
  queda donde está, y se lista al final para que lo mires. Típicamente es el
  sitio viejo: sacalo a mano, o vas a terminar con dos apps mezcladas;
- **se puede correr de nuevo.** No reescribe un archivo cuyo contenido ya es
  idéntico, así que la segunda pasada sólo trae lo que cambió — sirve igual para
  el primer bootstrap que para traer el template al día más adelante;
- **no usa `rsync`**, que no está instalado en todos lados (entre otros, los
  contenedores de Claude Code en la nube, que es justo desde donde se
  bootstrapearon las tres primeras tiendas). Es Node puro;
- **no toca git en el destino**: no commitea, no pushea, no cambia de rama.
  Deja todo en el working tree, que es donde lo querés para mirarlo con
  `git diff` antes de commitear.

Por eso mismo pide que el destino esté limpio (`git status` sin cambios) y se
niega si no lo está: con el working tree limpio, todo lo que escriba el script
se deshace con un `git checkout .`. Si sabés lo que estás haciendo, `--forzar`.

Después de la copia, el resto del camino es el mismo:

```bash
cd ../lenceria
git status                 # mirá qué entró antes de commitear
git remote add template https://github.com/antonmarklundcom/ecom.git
pnpm install
pnpm setup:doctor          # acá te va a avisar si `main` se quedó atrás
pnpm nueva-tienda
```

Ese `pnpm setup:doctor` en un repo que ya tenía vida es el que más paga: es
exactamente el escenario donde `main` puede estar meses atrás de lo que ya se
mergeó en PRs, y bootstrapear encima de un `main` viejo es rehacer trabajo ya
hecho.

### 2. Marca y secretos — `pnpm nueva-tienda`

```bash
pnpm nueva-tienda            # interactivo
pnpm nueva-tienda --dry-run  # muestra qué haría, no escribe nada
```

Pregunta seis cosas —nombre, título del navegador, meta description, tagline
del pie, WhatsApp y dominio— y con eso:

- reescribe los campos de marca de [`src/config/tienda.ts`](./src/config/tienda.ts);
- genera `SESSION_SECRET`, `CRON_SECRET` y `SETUP_SECRET` con
  `crypto.randomBytes` (no con `openssl`, que en Windows no existe) y los
  escribe en `.env.local` junto con el WhatsApp y el dominio;
- lista las variables del hPanel; los secretos se copian desde `.env.local`,
  para que no queden en logs de la consola;
- corre `pnpm template:diff --marcar --origen` si todavía no hay
  `.template-baseline` (si ya hay, no lo mueve).

**Es idempotente:** correrlo de nuevo ofrece los valores de hoy como default
—Enter los deja— y **nunca regenera un secreto que ya exista**. Eso último no
es prolijidad: un `SESSION_SECRET` nuevo cierra todas las sesiones del panel, y
un `CRON_SECRET` nuevo deja al cron de Hostinger llamando con la llave vieja
hasta que alguien lo mire.

Sin terminal interactiva (un script, CI) las seis respuestas van por bandera y
el script falla diciéndolo si falta alguna:

```bash
pnpm nueva-tienda --nombre "Lencería Guaraní" \
  --titulo "Lencería Guaraní — Comprá online en Paraguay" \
  --descripcion "…" --tagline "…" \
  --whatsapp 0981123456 --dominio lenceria.com.py
```

Lo que el wizard **no** hace, a propósito: no toca la base, no sube nada a
ningún lado y no inventa las credenciales de terceros. Eso es lo de la tabla
de arriba.

#### Lo que igual conviene saber

Editás [`src/config/tienda.ts`](./src/config/tienda.ts) a mano cuando quieras
cambiar `lang`, `ogLocale`, los flags o el `hero`. Header, pie, títulos del
navegador y Open Graph salen todos de ahí.

Hay un test que falla si alguien vuelve a escribir el nombre a mano en otro
archivo (`tests/unit/marca-centralizada.test.ts`). Si te grita, la solución es
leer de `TIENDA`, no agregar una excepción. Y si te salteás este paso entero,
`pnpm preflight` bloquea: una tienda con `nombre: "TiendaPY"` no cobra.

**O, mejor, desde el panel:** `/admin/ajustes` → **Identidad** carga el
nombre, el logo, el favicon y el color de marca con la tienda ya arriba, sin
tocar código ni redeployar (§4a-quater). Lo de `tienda.ts` queda como default
de lo que el dueño no cargue, y `pnpm preflight` acepta el nombre de cualquiera
de los dos lados.

El favicon por defecto es `src/app/favicon.ico`; el que se sube en Identidad lo
pisa. Ningún control lo verifica, así que va en la misma pasada.

Dos cosas que **no** son por tienda, a propósito: los números de pedido salen
`PY-000123` en todas las tiendas (el prefijo participa del hash de Pagopar y
cambiarlo con pedidos ya emitidos es tocar el camino de la plata), y las
ilustraciones de `public/placeholders/` sólo conocen las cuatro categorías del
seed — una categoría real sin foto cae en el placeholder genérico, que es feo a
propósito: la solución son fotos, no más placeholders.

La imagen que se ve cuando alguien comparte un link por WhatsApp o Instagram
**no hay que cargarla**: `src/app/opengraph-image.tsx` la dibuja con el nombre
y el tagline de `TIENDA`. Cada ficha de producto usa su foto principal y sólo
cae en esa imagen si el producto todavía no tiene fotos. Lo que sí es
obligatorio es `NEXT_PUBLIC_SITE_URL`: sin el dominio final, la URL de la
imagen sale relativa y el link se comparte sin foto.

### 3. Entorno

`pnpm nueva-tienda` ya creó `.env.local` y completó los secretos, el WhatsApp
y el dominio. Lo que falta completar a mano es lo de terceros. La tabla
entera, para saber qué es cada cosa:

`.env.example` trae **sólo las cinco imprescindibles** (`DATABASE_URL`,
`SESSION_SECRET`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `SETUP_SECRET`):
Hostinger lo lee y precarga un campo del hPanel por variable, así que ahí no
puede haber cuarenta y cinco. Las demás de esta tabla son **opcionales** y
están documentadas con sus trampas en `docs/ENV-OPCIONAL.md`: vacías o
ausentes, cada una apaga su feature.

| Variable | Qué es |
|---|---|
| `DATABASE_URL` | base local (docker) y después la de Hostinger |
| `SESSION_SECRET` | **lo genera el wizard.** Uno nuevo por tienda, nunca reciclado |
| `WHATSAPP_NUMBER` | **lo escribe el wizard.** El del comercio |
| `BANCO_*` | **legacy/fallback.** Podés dejarlos vacíos: los datos bancarios se cargan desde `/admin/banco` con la tienda ya arriba (ver §4a). Si los ponés y la tabla está vacía, mandan éstos |
| `CLOUDINARY_*` | cuenta de Cloudinary de esta tienda |
| `CLOUDINARY_FOLDER_PREFIX` | opcional, vacío por defecto. Ponelo **si varias tiendas comparten una cuenta de Cloudinary**: el `public_id` de un comprobante sale del número de pedido, y todas las tiendas acuñan `PY-000123`, así que sin prefijo los comprobantes de las dos terminan mezclados en la misma carpeta. Elegilo al crear la tienda y no lo toques más |
| `NEXT_PUBLIC_SITE_URL` | **lo escribe el wizard.** El dominio final |
| `CRON_SECRET` | **lo genera el wizard.** ≥ 16 caracteres, nuevo por tienda |
| `SETUP_SECRET` | **lo genera el wizard.** Va sólo en el servidor y sólo durante el primer deploy: habilita `/api/setup/init` y después se borra (DEPLOY.md §4) |
| `PAGOPAR_*` | credenciales del comercio; vacías = sin tarjeta, o `PAGOPAR_MODE="mock"` para demo |
| `CUSTOMER_SESSION_SECRET` | opcional: vacío, se deriva de `SESSION_SECRET` (§4b). Si lo cargás, uno propio, nunca una copia de `SESSION_SECRET` |

`.env.example` y `docs/ENV-OPCIONAL.md` documentan cada trampa — leelos, no
las adivines. `TEST_DATABASE_URL` (tests de integración, sólo desarrollo) está
en el README: esa base se borra en cada corrida.

### 4. Base de datos y catálogo

```bash
docker compose up -d     # MySQL local (base `ecom`)
pnpm db:push             # schema + FULLTEXT + FK + contador
pnpm db:seed             # catálogo de ejemplo — reemplazalo por el real
pnpm create-owner        # el primer dueño; el resto se crean desde /admin/usuarios
pnpm dev                 # tienda en / y panel en /admin
```

Para una demo mostrable al cliente antes de tener productos reales:
`pnpm demo` (catálogo + un pedido en cada estado).

Los productos reales entran por dos caminos:

- **Pocos, o de a uno:** el panel, `/admin/productos`.
- **El catálogo entero de una vez:** `pnpm importar:productos lista.csv`. El
  comercio ya tiene su lista de precios en Excel; las columnas obligatorias son
  SKU, Producto, Categoría y Precio (₲). Variante y Stock son opcionales:
  Variante vacía significa variante única y Stock vacío significa 0 al crear,
  sin tocarlo al reimportar. El formato es el mismo que baja el export del
  panel (una fila por variante) más columnas opcionales — Descripción, Marca,
  IVA, Precio antes (₲), Slug y **Fotos**. Separador `;` o `,`, como venga. Sin
  `--aplicar` es un ensayo que sólo cuenta; los errores salen todos juntos con
  número de línea. Idempotente: re-importar actualiza precios sin duplicar y
  **no pisa el stock** de variantes existentes (`--pisar-stock` si de verdad
  querés eso). Las categorías que no existan se crean al final del menú.
  - **Fotos**: una o más URLs `https://` en la columna Fotos, separadas por
    `|`, espacio o salto de línea (normalmente sólo en la primera fila de cada
    producto). Cloudinary va a buscarlas solo — nada se descarga acá — y sólo
    se suben a un producto que hoy no tiene ninguna foto, para que reimportar
    la misma planilla no duplique nada. Ejemplo de fila (mismas columnas de
    siempre + Fotos al final):

    ```
    SKU;Producto;Categoría;Variante;Precio (₲);Stock;Descripción;Marca;IVA;Precio antes (₲);Slug;Fotos
    AUR-1;Auriculares TWS;Electrónica;Negro;285000;24;;;;;;https://cdn.tienda.com/aur-1.jpg|https://cdn.tienda.com/aur-1b.jpg
    ```

    Tanto el panel (`/admin/productos`) como la CLI las suben iguales, con la
    misma regla; sin credenciales de Cloudinary configuradas se avisa y se
    sigue el resto de la importación sin ellas. Una foto también se puede
    cargar suelta, a mano, desde `/admin/productos`.

El seed deja un punto de partida que **se termina de ajustar desde el panel**,
sin volver a tocar código:

| Qué | Dónde | Ojo con |
|---|---|---|
| Categorías del menú | `/admin/categorias` | Desactivar una **le saca de la vidriera también a sus productos**; la pantalla te dice cuántos antes de confirmar. Cambiar el slug rompe las URLs viejas: no hay redirección. |
| Zonas de envío | `/admin/envios` | Las del seed son las de Gran Asunción. Una ciudad va en **una sola** zona. La ciudad que no esté en ninguna lista se cobra como la zona activa más cara — conviene tener una zona *Interior* sin ciudades y cara, que haga de comodín. |
| Formas de entrega | `/admin/envios` (abajo) | Courier, moto propia, retiro en el local — y con cuáles se puede pagar. **Vacío está bien**: sin ninguna, el checkout ofrece "Envío a domicilio" con el precio de la zona y los tres medios de pago, que es cómo funcionó siempre. Ver §4e. |
| Datos bancarios | `/admin/banco` | A dónde transfieren. Vacío, la página del pedido avisa en vez de inventar una cuenta. Ver §4a. |

Todas esas pantallas son owner-only.

### 4a. Los datos bancarios se cargan desde el navegador

La transferencia es el método de pago principal de una tienda paraguaya, y el
dato del que depende —banco, titular, RUC, número y tipo de cuenta, más el QR
del SPI— **se carga desde `/admin/banco`**, no desde un archivo. El motivo es
concreto: corregir un dígito mal tipeado de la cuenta era, hasta este PR, un
cambio de variable en el hPanel y un Redeploy a mano; ahora es un botón, y lo
puede hacer el dueño sin llamarte.

Dos reglas que la pantalla sostiene:

- **Los cinco campos van juntos.** Media cuenta cargada mostraría un banco sin
  número, y esa transferencia se hace mal. Con alguno vacío no se guarda nada, y
  la página del pedido sigue avisando que faltan los datos en vez de inventar.
- **El RUC se verifica** con su dígito verificador (módulo 11 de la DNIT). Un
  RUC mal tipeado no rompe nada de este lado: rompe la transferencia de otra
  persona, en el banco.

El QR del SPI es opcional y se sube desde la misma pantalla (JPG/PNG/WebP, hasta
5 MB). Va a una carpeta **pública** de Cloudinary, separada de la de
comprobantes. Sin QR, la página muestra los datos con botón de copiar, que es lo
que hacía siempre.

**Compatibilidad con lo de antes:** los `BANCO_*` del entorno siguen andando y
son el fallback. Tabla vacía ⇒ manda el entorno, así que una tienda que ya está
vendiendo no cambia en nada el día que actualiza el template. En cuanto el dueño
guarda desde el panel, la fila pisa al entorno para siempre — y ahí conviene
vaciar las variables, para que no queden dos verdades. `pnpm preflight` avisa
(sin frenar el deploy) si están vacías, porque desde afuera de la base no puede
saber si la tabla está cargada; el que sí sabe es el cartel de `/admin`.

### 4a-bis. Ajustes de la tienda: lo que el dueño edita sin llamarte

`/admin/ajustes` (sólo el dueño) junta lo que antes era un cambio en
`src/config/tienda.ts` o una variable de entorno más un redeploy. Todo campo
vacío significa **"el de siempre"** —el de `tienda.ts` o el del entorno— y la
pantalla muestra cuál es; "Restaurar valores por defecto" vuelve cada sección a
eso. Se guarda en una sola fila JSON (`store_settings`): un ajuste nuevo del
template no trae migración, y una fila vieja o rota se lee con los defaults.

| Se edita en `/admin/ajustes` | Sigue en el código / el entorno |
|---|---|
| Bajada del pie, título y descripción de la home para Google | El **nombre** (`TIENDA.nombre`): también es el `<title>` de cada página y lo verifica `pnpm preflight` |
| Portada: prendida/apagada, título, texto, botón, foto (se sube a Cloudinary, carpeta `portadas/`) | Una portada distinta (carrusel, vídeo): se escribe en `src/app/page.tsx` |
| Barra de anuncio arriba de todo | Idioma, `ogLocale`, cuentas de cliente (`tienda.ts`) |
| WhatsApp **público**, email, dirección, horario, Instagram/Facebook/TikTok | `WHATSAPP_NUMBER`: destino de los avisos al dueño (y el público si el panel está vacío) |
| Envío y devoluciones para el JSON-LD de Google (días, precio desde, política) | Tarifas y zonas de envío (`/admin/envios`) |
| Páginas `/envios`, `/devoluciones`, `/preguntas-frecuentes`, `/terminos`, `/privacidad`: prendidas, título y texto | Los textos de arranque: `src/config/paginas-default.ts` (piel) |
| Estrellas en las tarjetas, barra de compra móvil | El diseño de esas piezas (piel) |
| Recuadro "Comprá tranquilo" del checkout | Los medios de pago que lista: salen solos de los métodos de envío y de Pagopar |
| Umbral global de stock bajo | El de cada variante (`reorder_point`), que igual gana |

Los textos de las páginas arrancan con un aviso "Texto por defecto — revisalo
antes de publicar": son genéricos, sin promesas ni números de ley, y **hay que
leerlos con el dueño antes de lanzar**. Aceptan el markdown chico de las
descripciones y los `{{tienda}}`, `{{url}}`, `{{whatsapp}}`, `{{email}}`,
`{{direccion}}`, `{{horario}}`, `{{diasDevolucion}}` y `{{mediosDePago}}`; uno sin
dato sale como una frase ("a coordinar por WhatsApp"), nunca crudo.

Una tienda que ya rediseñó `site-footer.tsx`, `layout.tsx` o `page.tsx` (piel) y
trae esto por `template:sync` se queda con los suyos: la barra de anuncio, los
links a las páginas y el contacto nuevo del pie no aparecen hasta sumarlos a
mano (las páginas en sí sí existen).

### 4a-ter. Integraciones desde el panel: Cloudinary, WhatsApp, Pagopar, medición

**`/admin/integraciones`** (sólo el dueño) carga lo que antes eran variables del
hPanel, con la tienda ya arriba y sin redeploy:

| Tarjeta | Qué carga | Fallback de entorno |
|---|---|---|
| Cloudinary | cloud name, API key, **API secret**, prefijo de carpetas | `CLOUDINARY_*` |
| WhatsApp | número del comercio (avisos al dueño), phone number ID, **token**, versión de la API, las nueve plantillas | `WHATSAPP_NUMBER`, `WHATSAPP_CLOUD_*` |
| Pagopar | clave pública, **clave privada**, URL de la API | `PAGOPAR_PUBLIC_KEY`, `PAGOPAR_PRIVATE_KEY`, `PAGOPAR_BASE_URL` |
| Medición | ID de GA4, ID del Pixel | `NEXT_PUBLIC_GA4_ID`, `NEXT_PUBLIC_META_PIXEL_ID` |
| Reporte de errores | URL del webhook | `ERROR_REPORT_URL` |

Las reglas, todas en `src/lib/integraciones.ts`:

- **Precedencia: fila de la base > variable de entorno > apagado**, igual que
  `/admin/banco` con `BANCO_*`. Vacío en el panel = vuelve a mandar el entorno;
  sin ninguno de los dos, la función queda apagada (nunca rota). El botón
  "Borrar lo del panel" devuelve una integración entera al entorno.
- **Las credenciales que van juntas no se mezclan**: si el panel tiene alguna
  de las de Cloudinary (o de Pagopar, o phone ID + token de WhatsApp), el grupo
  entero sale del panel. Las plantillas y el prefijo se resuelven de a uno.
- **Los secretos se guardan cifrados** (AES-256-GCM, clave derivada de
  `SESSION_SECRET` por HKDF, una por campo) y **nunca vuelven al navegador**: la
  pantalla muestra "Configurado ••••1234" y sólo deja reemplazar o borrar. Sin
  `SESSION_SECRET` válido no se lee ni se guarda nada. **Cambiar
  `SESSION_SECRET` deja ilegibles los secretos guardados** — la pantalla lo dice
  y hay que volver a cargarlos.
- **"Probar conexión"** para Cloudinary (ping de la Admin API), WhatsApp (lee
  el número en la Graph API, no manda nada) y Pagopar (sólo que el host
  conteste por https: sus claves sólo se verifican con una transacción del
  sandbox). Cada guardado y cada prueba quedan en el log del hPanel con quién y
  qué campos, nunca valores.
- `pnpm preflight` lee las dos fuentes y dice de dónde sale cada valor.
- `PAGOPAR_MODE`, `CUSTOMER_SESSION_SECRET`, `FACTURAPY_*` y los `OWNER_*` se
  quedan en el entorno: el modo mock es de desarrollo, el secreto de clientes
  se deriva solo de `SESSION_SECRET` (§4b), FacturaPY no se usa todavía, y el
  dueño se crea con
  `/api/setup/init` o `pnpm create-owner`.

La lectura usa una foto en memoria que se recarga cada 30 segundos y se tira
al guardar: en el mismo proceso el cambio es inmediato; el CSP del proxy puede
tardar hasta 30 s en abrirse a un GA4 recién cargado.

### 4a-quater. Identidad desde el panel: nombre, logo, favicon, color

`/admin/ajustes` → **Identidad** (sólo el dueño). Es lo que antes obligaba a
editar `src/config/tienda.ts` y el tema en cada tienda clonada:

| Campo | Dónde se ve | Vacío |
|---|---|---|
| Nombre | header, `<title>` de cada página, Open Graph, remito, mensajes de WhatsApp, feed | `TIENDA.nombre` |
| Logo | header (reemplaza el nombre en texto) | el nombre en texto |
| Favicon | la pestaña del navegador | `src/app/favicon.ico` |
| Color de marca | `--primary` (botones, links, foco); el texto encima se elige solo por contraste | el del tema de `globals.css` |

Logo y favicon van a la carpeta pública `marca/` de Cloudinary (hace falta
Cloudinary configurado, §4a-ter). El tema completo (tipografía, radios, modo
oscuro) sigue siendo piel del código (§5): el panel pisa sólo el color de marca.

**Piel rediseñada:** `site-header.tsx` y `site-footer.tsx` del template ya leen
`marcaEfectiva()` (`src/lib/marca.ts`). Una tienda que rediseñó los suyos los
conserva en el `template:sync`; para que muestren el nombre y el logo del
panel, que lean `marcaEfectiva()` en vez de `TIENDA.nombre`.

### 4b. ¿Esta tienda quiere cuentas de cliente?

**Por defecto no**, y para la mayoría de las tiendas ese default está bien: en
Paraguay se compra por WhatsApp y obligar a registrarse antes de la primera
compra es el mayor asesino de conversión que hay. El checkout de invitado es y
va a seguir siendo el camino principal.

La cuenta sirve cuando el comercio quiere **volver a hablarle** a quien ya le
compró: historial de pedidos, datos guardados para la próxima, y una lista de
gente que aceptó recibir novedades (la única que se puede usar para promociones
— comprar no es aceptar que te escriban).

Para prenderla: **`/admin/ajustes` → Cuentas de cliente → "Sí, ofrecerlas"**.
Nada más — sin tocar código ni el hosting.

- El default (lo que se usa mientras el dueño no elija) sale de
  `cuentasClientes` en `src/config/tienda.ts`, apagado de fábrica.
- **Ya no hace falta `CUSTOMER_SESSION_SECRET`**: vacío, el secreto de las
  sesiones de cliente se deriva de `SESSION_SECRET` con HKDF (es otro secreto,
  independiente del del panel). Una tienda que ya lo tiene cargado sigue usando
  el suyo. Si `SESSION_SECRET` no es válido, el panel lo avisa y `/cuenta` no
  anda — a propósito.
- Todo el código decide con `cuentasClientesHabilitadas()` de
  `src/lib/cuentas.ts` (async); la de `tienda.ts` quedó como legacy.

Con el flag apagado, `/cuenta/*` responde 404, el header no muestra nada y el
checkout es exactamente el de siempre. Hay un test de CI
(`tests/unit/flags-apagados.test.ts`) que lo verifica en cada commit.

**Limitación conocida de esta fase:** no hay verificación de teléfono ni de
email — el stack todavía no tiene con qué mandar un mensaje. Consecuencia
concreta: los pedidos que alguien hizo *como invitada* antes de crear su cuenta
**no** aparecen en `/cuenta`, aunque el WhatsApp coincida. Mostrarlos sin
verificar el número dejaría ver el historial de compras de otra persona a
cualquiera que tipee su número al registrarse. Se habilitan solos cuando el
teléfono quede verificado (login por OTP).

### 4c. ¿Entrar sin contraseña? (opcional, apagado)

El login por código de WhatsApp está **construido y listo**, y apagado hasta
que la tienda tenga con qué mandar mensajes. Sin credenciales, el login sólo
ofrece contraseña — nunca aparece un botón que no pueda funcionar.

Para prenderlo hace falta **WhatsApp Cloud API de Meta**, y conviene saber qué
implica antes de prometérselo a un cliente:

1. App en Meta for Developers con el producto WhatsApp.
2. Un número verificado por Meta. **No sirve el WhatsApp común del comercio**:
   tiene que darse de alta en la plataforma, y ese número deja de poder usarse
   en la app normal de WhatsApp.
3. Un token de acceso permanente (los de la consola duran 24 h).
4. Una **plantilla de mensaje aprobada**, con un parámetro en el cuerpo. Ésta es
   la que sorprende: fuera de la ventana de 24 h desde el último mensaje de la
   persona, Meta no permite texto libre, y un código de login siempre cae
   fuera. La aprobación puede tardar días.

Las variables están en `docs/ENV-OPCIONAL.md` (`WHATSAPP_CLOUD_*`).

**En dev no hace falta nada de esto:** sin credenciales y con
`NODE_ENV != production`, el código se imprime en la consola del servidor y el
flujo completo se puede probar. Ese sender **no existe en producción**, a
propósito: los logs de un hosting compartido no son lugar para un código que
abre la sesión de una compradora.

Efecto secundario que vale la pena: entrar con un código **verifica el
teléfono**, y ahí `/cuenta` empieza a mostrar los pedidos que esa persona hizo
como invitada con ese número (ver la limitación del §4b).

**La segunda plantilla: el aviso de pedido nuevo al comercio.** Con las mismas
credenciales de Cloud, la tienda puede avisarle al dueño por WhatsApp cada vez
que entra un pedido, en vez de depender de que la compradora toque el botón.
Meta aprueba las plantillas de a una, así que hay que pedirle **otra**, también
con un parámetro en el cuerpo (el texto del aviso), y ponerle el nombre en
`WHATSAPP_CLOUD_TEMPLATE_PEDIDO_NUEVO`. El destino es `WHATSAPP_NUMBER`, el
número del comercio que ya estaba configurado.

Sin esa variable el aviso queda apagado y la tienda no cambia en nada:
`pnpm preflight` lo dice como advertencia. En dev, sin credenciales, el aviso se
imprime en la consola del servidor igual que el código de login. El envío nunca
puede demorar ni hacer fallar un pedido: sale después de que el pedido está
guardado, y salga o falle queda anotado en la historia del pedido.

**Tres plantillas más: los avisos a la COMPRADORA.** Además del aviso al
comercio, la tienda le puede avisar a quien compró en cada uno de tres
momentos — que su pedido quedó **confirmado**, que se **pagó** y que **salió**
— sin que ella tenga que tocar nada. Son tres plantillas nuevas, una decisión
por evento (podés prender sólo la de pago, por ejemplo), con la misma regla
de siempre: un parámetro en el cuerpo, aprobada por Meta:

| Momento | Variable |
|---|---|
| Pedido registrado (justo después de crearse) | `WHATSAPP_CLOUD_TEMPLATE_CLIENTE_CONFIRMADO` |
| Pago registrado (transferencia aprobada, Pagopar acreditado o contra entrega confirmada) | `WHATSAPP_CLOUD_TEMPLATE_CLIENTE_PAGADO` |
| Pedido enviado | `WHATSAPP_CLOUD_TEMPLATE_CLIENTE_ENVIADO` |
| Pedido entregado: "¿Qué tal tu pedido? Contanos qué te pareció" con el link a su pedido, donde está el formulario de reseña (sólo compras entregadas) | `WHATSAPP_CLOUD_TEMPLATE_CLIENTE_RESENA` |

El destino de los tres es el WhatsApp que dejó cada compradora en su pedido —
no hace falta ninguna variable de número. Y a diferencia del aviso al
comercio, acá **cada plantilla vacía apaga sólo ese aviso, ni siquiera por la
consola de dev**: cuál de los tres manda esta tienda es una decisión suya, no
un default que conviene probar sin haberla tomado. `pnpm preflight` avisa por
separado de cada una que falte, siempre como advertencia. Mismas garantías que
el resto de esta familia: nunca frenan ni demoran una transición, un fallo de
envío no hace nada más que quedar anotado en la historia del pedido, y no se
manda el mismo aviso dos veces para el mismo pedido.

**Dos plantillas más (O6): el resumen diario y "avisame cuando haya stock".**
Misma regla de siempre — un parámetro en el cuerpo, aprobada por Meta, vacía =
apagada:

| Para qué | Variable | Destino |
|---|---|---|
| El resumen de la mañana al dueño: comprobantes por revisar, pedidos sin pagar hace más de un día, stock bajo, ventas de ayer | `WHATSAPP_CLOUD_TEMPLATE_RESUMEN_DIARIO` | `WHATSAPP_NUMBER` |
| "Volvió a haber stock de X": lo recibe quien se anotó en una variante agotada | `WHATSAPP_CLOUD_TEMPLATE_STOCK_DISPONIBLE` | el teléfono que dejó cada compradora |

El resumen **necesita además la entrada de cron diaria del hPanel** (DEPLOY.md
§5): sin ella la plantilla está cargada y no se manda nada. `pnpm preflight`
avisa si falta la plantilla; de la entrada de cron no puede saber nada.

La de stock es opcional de verdad y su interruptor apaga **la feature entera**:
sin ella el formulario "avisame" no se dibuja y el alta se rechaza. Es a
propósito — guardar suscripciones que después nadie va a poder avisar sería
prometerle algo a una compradora que la tienda no puede cumplir.

**Una más (O15): el recordatorio de pago.** La que más se paga sola de todas.

Contra entrega no recibe este recordatorio: aunque el pedido está en
`pendiente_pago`, la compradora no tiene nada que pagar antes de recibir.

| Para qué | Variable | Destino |
|---|---|---|
| "Tu pedido todavía está esperando el pago, podés pagarlo hasta las 18:40" — sale una sola vez por pedido, cuando le quedan menos de 6 h de reserva | `WHATSAPP_CLOUD_TEMPLATE_CLIENTE_RECORDATORIO` | el teléfono que dejó cada compradora |

**No necesita una entrada de cron nueva**: viaja en la de `vencer-pedidos` que
ya está cada 15 minutos (DEPLOY.md §5), y sale después de vencer, así que un
pedido recién vencido nunca recibe un aviso para pagarlo. Vacía = apagado, y la
tienda queda exactamente como antes: el pedido que la compradora se olvidó
vence en silencio. `pnpm preflight` lo dice como advertencia.

### 4d. ¿En qué idioma habla esta tienda?

Por defecto `es-PY`, y las URLs quedan en español siempre (son parte del
template). Para otro idioma:

1. Copiá `src/i18n/es-PY.ts` a `src/i18n/<lang>.ts` y traducí **los valores**.
   Las claves no se tocan: son el contrato, y hay un test de CI que exige que
   todos los catálogos tengan exactamente las mismas.
2. Agregalo a `CATALOGOS` en `src/i18n/index.ts`.
3. `lang: "<lang>"` en `tienda.ts`.

`es-PY` queda de fallback por clave, así que una traducción a medio hacer
muestra español donde falte en vez de un `undefined`. No es una red de
seguridad silenciosa: el test de CI no deja mergear un catálogo incompleto.

El catálogo cubre **la vidriera y el panel**: son unas 890 claves, y traducirlas
todas es un rato largo. Si sólo te interesa que compre gente en otro idioma,
empezá por las áreas `header/footer/home/catalogo/producto/carrito/checkout/
pedido/cuenta/error*` y dejá `panel*` y `adminError*` para después — el dueño
suele hablar el idioma del comercio. El test de claves completas se aplica a
los catálogos **registrados**, así que traducí y registrá recién cuando esté
entero.

**La plata no se traduce.** Los montos siguen en guaraníes enteros con su `₲`
(`src/lib/money.ts`): cambiar de moneda no es traducir, es tocar el camino del
dinero. No hay switcher para el visitante ni rutas por idioma — eso sería otra
fase.

### 4e. Formas de entrega (courier, moto, retiro)

**Esto es opcional y se puede dejar para después.** Una tienda recién clonada
no tiene ninguna forma de entrega cargada, y así el checkout se comporta
exactamente como venía: una sola opción implícita, *Envío a domicilio*, con el
precio de la zona y los tres medios de pago. Todo lo de acá es para el comercio
que entrega de más de una manera.

Se cargan en `/admin/envios`, debajo de las zonas. Cada forma de entrega tiene:

| Campo | Qué hace |
|---|---|
| **Tipo** | `Courier` (empresa que lleva), `Reparto propio` (tu moto) o `Retiro en el local`. Retiro no viaja: no cobra flete ni usa zonas, pongas lo que pongas. |
| **Cómo se cobra** | *Con el precio de la zona* (y conserva el envío gratis desde el umbral de esa zona) o *Tarifa plana* (lo mismo siempre, sin umbral). |
| **Zonas donde aplica** | Sin ninguna tildada, aplica a **todas** las zonas activas — el caso del courier nacional. Tildá zonas sólo si esa forma de entrega llega nada más que ahí. |
| **Medios de pago habilitados** | Al menos uno. Es lo que ve quien compra después de elegir esta entrega. |
| **Descripción** | Una línea para el checkout: "Llega en 24-48 h a todo el país". |

**El campo que justifica toda la pantalla es el de los medios de pago.** Contra
entrega sólo tiene sentido donde alguien tuyo va a estar en la puerta para
cobrar: dejalo tildado en la moto propia y destildalo en el courier. El checkout
filtra solo, y el servidor rechaza el pedido si alguien fuerza la combinación.

Una configuración típica de un comercio de Asunción que también manda al
interior:

| Nombre | Tipo | Cómo se cobra | Zonas | Se paga con |
|---|---|---|---|---|
| Moto Asunción | Reparto propio | Tarifa plana ₲15.000 | Asunción, Gran Asunción | Transferencia, contra entrega |
| Courier nacional | Courier | Precio de la zona | (ninguna: todas) | Transferencia, tarjeta |
| Retiro en el local | Retiro | — | — | Transferencia, contra entrega |

El orden importa: es el que ve quien compra, y el primero es el que se usa si
el navegador no eligió ninguno. Se cambia con las flechas.

Dos cosas que conviene saber antes de tocar nada:

- **Cambiar o borrar una forma de entrega no toca los pedidos ya hechos.** El
  flete quedó copiado en el pedido, y también el nombre con el que se entregó.
- **`pnpm preflight` avisa** si dejaste una forma de entrega prendida cuyas
  zonas están todas apagadas: está activa, se ve activa, y no le aparece a
  nadie en el checkout.

### 4f. La operación diaria del panel (S9–S11, después del lanzamiento)

Nada de esto necesita configuración — viene andando desde que la tienda sale
del template. Lo que sigue es sólo dónde encontrarlo:

- **Seguimiento del envío y remito.** Al despachar un pedido (`enviado`), el
  panel pide courier, número de guía y link de seguimiento — los tres
  opcionales. Quedan en un bloque "Seguimiento" en la ficha del pedido y en
  `/pedido/[número]`, la página que ve la compradora. Desde la ficha,
  `/admin/pedidos/[id]/imprimir` arma un remito en A4 (sin precios si quien
  imprime es `vendedor`) listo para pegar en el paquete.
- **Notas internas.** Un textarea arriba del historial de cada pedido, para lo
  que dijeron por teléfono — nunca lo ve la compradora, la puede escribir
  cualquiera de los tres roles (`pedidos.notas`, ARCH.md §1).
- **Resumen diario y "avisame cuando haya stock".** Ya están en §4c —dos
  plantillas de Meta, vacías = apagado— y necesitan además la entrada de cron
  del hPanel (DEPLOY.md §5).
- **Punto de reposición por variante.** En el editor de cada variante: un
  número entero, vacío = usa el default global (3). Por debajo de ese número,
  la variante entra en "stock bajo" en `/admin` y en el resumen diario.
- **Destacados y categorías con foto.** El toggle "Destacado" del formulario
  de producto elige lo que muestra la home bajo el título "Destacados"; sin
  ninguno elegido, la home sigue mostrando "Novedades" como siempre.
  `/admin/categorias` acepta una descripción y una foto por categoría —
  aparecen arriba de la grilla en `/categoria/<slug>` cuando están cargadas, y
  la descripción entra también en el `<meta name="description">` de esa
  página.
- **Acciones masivas y precios por porcentaje.** En `/admin/productos`,
  seleccionar varios productos habilita activar, desactivar, mover de
  categoría y —sólo `owner`— ajustar precios por porcentaje con una vista
  previa antes de confirmar. Cada ajuste deja su fila de auditoría
  (`price_adjustments`, ARCH.md §2).
- **Reembolso parcial.** Vive junto al botón de devolución total (dashboard,
  "Pagos sin pedido vivo"): un monto menor al total dejando el pedido como
  está, con su fila en el ledger de devoluciones (`refunds`, ARCH.md §2).
- **Backups automáticos y restauración.** Corren solos con la entrada de cron
  del hPanel (DEPLOY.md §5, tercera entrada) — nada que prender a mano más
  allá de tener Cloudinary configurado. Restaurar una copia es
  `pnpm restore -- <archivo.jsonl.gz>` (README.md, DEPLOY.md §"Restaurar una
  copia"): sólo corre contra una base cuyo nombre contenga `restore` o `test`.

### La distribución automática del template (S13)

Publicar una versión del template (un tag `v*`, ver CHANGELOG.md) —o correrlo
a mano desde la pestaña Actions— dispara `.github/workflows/distribuir.yml` en
el template, que le abre (o actualiza) un PR de maquinaria a cada tienda
listada en la raíz de `tiendas.json` — el mismo `pnpm template:sync` de arriba,
corrido por una acción en vez de a mano. Es lo que hace que el paso 1 de
"Arreglos que aparecen después" deje de ser manual. Un push a `main` ya no
distribuye: cada PR de distribución corre el CI de la tienda (incluido el e2e,
porque es donde llega maquinaria nueva), así que se agrupan por versión.

El workflow viaja a las tiendas con el resto del repo, pero **sólo corre en el
repo del template** (`if: github.repository == 'antonmarklundcom/ecom'`): en una
tienda no levanta ni un runner.

**Para que una tienda reciba estos PRs, alguien con acceso al repo del
template tiene que:**

1. Agregarla a `tiendas.json` en la raíz del template. `repo` es lo único que
   usa el workflow; `dominio` y `notas` son opcionales y sirven de registro:

   ```json
   [
     {
       "repo": "antonmarklundcom/mi-tienda",
       "dominio": "mitienda.com.py",
       "notas": "cuentas de cliente prendidas; Pagopar en sandbox"
     }
   ]
   ```

   Nada de secretos ni de datos de infraestructura acá: el template es
   público. Ni claves ni `DATABASE_URL`, pero tampoco el nombre de la base o
   del usuario de Hostinger (`u123_…` es la mitad de un login), ni la cuenta
   o el slot. Eso va a un lugar privado (el gestor de contraseñas, o un repo
   privado de notas). `tests/unit/tiendas-json.test.ts` rechaza campos que no
   sean esos tres. `tiendas.json` es `SOLO_TEMPLATE`: una tienda nueva no
   hereda la lista.

2. Tener cargado el secret `TIENDAS_TOKEN` en el repo del template: un token
   **fine-grained** de GitHub (Settings → Developer settings → Fine-grained
   tokens) con acceso a cada tienda y estos permisos de repositorio en
   **Read and write**: **Contents**, **Pull requests** y **Workflows**
   (Workflows porque la maquinaria incluye `.github/workflows/*`: sin ese
   permiso GitHub rechaza el push). Issues en Read and write es opcional:
   deja que el workflow cree el label `ci-completo` en la tienda. Un token
   fine-grained lista los repos uno por uno —**cada tienda nueva hay que
   sumarla al token**— y vence: cuando vence, el paso "Clonar la tienda"
   falla y lo dice. Sin el secret, el workflow se salta solo y lo dice en el
   log — no hace nada a medias.

3. Que la tienda tenga `.template-baseline` (el commit del template desde el
   que se creó o hasta el que se sincronizó). Sin él, la distribución a esa
   tienda falla con "No hay .template-baseline": correr una vez
   `pnpm template:diff --marcar` en la tienda sobre un commit conocido.

El PR que abre en la tienda es exactamente `pnpm template:sync` (ver
"Arreglos que aparecen después"), corrido desde el template: archivo por
archivo, con la piel de la tienda intacta y la lista de qué se trajo, qué se
fusionó, qué cambio de la tienda pisó el template y qué quedó sin tocar en el
cuerpo del PR. Siempre la misma rama, `template/sync`: una versión nueva
actualiza el PR abierto en vez de abrir otro, y si alguien ya empujó
commits a mano a esa rama (resolviendo un conflicto), el workflow no la pisa
y lo avisa. Si quedó un conflicto de verdad, el PR sale **en draft** con los
marcadores (`<<<<<<<`) commiteados y la lista de archivos: se resuelven en
esa misma rama. El CI de cada tienda decide si se mergea; nadie mergea por
ella.

**Ensayo gratis antes de publicar:** `pnpm template:ensayar-distribucion`
hace lo mismo que el workflow contra cada tienda de `tiendas.json` (clon
temporal, nada se empuja) y, con `--verificar`, corre `typecheck`, `lint` y
los unitarios de cada tienda ya sincronizada. 0 minutos de Actions.

### CI y minutos de Actions

`ci.yml` viaja a todas las tiendas y cuesta distinto según el repo: en uno
**público** los runners estándar de GitHub son gratis y sin límite; en uno
**privado** cada minuto se descuenta de la cuenta (Linux 1x), y diez tiendas
privadas corriendo todo en cada push se comían el mes en días. Cada job mira
si el repo es privado y se adapta solo:

| Qué | Repo público | Repo privado |
|---|---|---|
| `checks` (drift de `drizzle/`, typecheck, lint, unitarios + integración con MySQL, build) | cada PR y cada push a `main` | cada PR |
| `e2e` (Playwright) | cada PR y cada push a `main` | label `ci-completo`, corrida manual (Actions → CI → Run workflow), o un PR de distribución (rama `template/…`) |
| `lighthouse` | cada push a `main`, o a mano | sólo a mano |
| `distribuir.yml`, `pnpm-al-dia.yml` | sólo en el repo del template | sólo en el repo del template |

En los dos casos, un PR de sólo docs (`*.md`, `fable/`) no corre nada, y un
push nuevo al mismo PR cancela la corrida anterior. En un repo privado,
poner el label `ci-completo` dispara la corrida con e2e al toque (cualquier
otro label no dispara nada); pedilo siempre que el PR toque checkout,
`/admin`, o saque/mueva un `data-testid`. El label se crea una vez por repo
(Issues → Labels → New label, `ci-completo`); en las tiendas lo crea el
primer PR de distribución.

El gate de cada día es local y gratis: `pre-commit` corre `typecheck` + `lint`
y `pre-push` corre `pnpm test:unit` (los unitarios, en paralelo, ~15 s; husky,
se instala con `pnpm install`). `pnpm test` corre todo, integración incluida
(necesita MySQL: `docker compose up -d`).

**Una vez por cuenta de GitHub, a mano:** Settings → Billing → Spending limit
en `$0` (al llegar al límite los jobs se frenan, no se cobra), y mirar
Billing → Actions una vez por mes, que desglosa por repo. En una tienda que no
va a recibir cambios por un tiempo: Settings → Actions → Disable actions.

Si en tu repo la protección de `main` exige el check `checks`, un PR de sólo
docs se queda esperándolo (no corre): mergealo como admin, o no marques
`checks` como obligatorio.

### 5. Diseño

#### El kit de temas

El template trae **tres temas** listos, cada uno un archivo en
`src/styles/temas/` con los mismos tokens de shadcn (oklch) en `:root` y en
`.dark`:

| Tema | Para quién | Fuentes sugeridas | Redondeo |
|---|---|---|---|
| `neutro` (default) | el comercio sin identidad de color definida — fotos y logo hacen el trabajo | `Geist` / `Geist Mono` (las de hoy, sin tocar `layout.tsx`) | `0.625rem` |
| `calido` | rubros cálidos/artesanales: comida, cuero, decoración, "de campo" | `Fraunces` (títulos) + `Figtree` (cuerpo) | `1rem` |
| `oscuro-vivo` | tech, gaming, indumentaria urbana — fondo oscuro **fijo** (no depende del modo del celular) con acento saturado | `Sora` (títulos) + `Inter` (cuerpo) | `0.25rem` |

`src/app/globals.css` no define los colores: importa uno solo de estos
archivos (`@import "../styles/temas/neutro.css";`). **Elegir un tema es
cambiar esa línea**, a mano o con el wizard:

```bash
pnpm nueva-tienda --tema calido        # sin terminal interactiva (CI, script)
pnpm nueva-tienda                      # interactivo: pregunta "¿Tema?" con lo que ya hay como default
```

Sin `--tema` y sin terminal interactiva (el caso de `pnpm bootstrap:repo` o
un script), el default es el tema que `globals.css` ya tenía importado —
`neutro` si todavía no importaba ninguno. El wizard es idempotente: pedir el
mismo tema dos veces no reescribe el archivo.

Cada archivo de tema lleva en su cabecera para quién es, el par de fuentes
sugerido y las dos líneas exactas de `src/app/layout.tsx` que hay que
cambiar para usarlas (las fuentes **siguen viviendo ahí**, vía
`next/font/google` — el tema sólo trae la sugerencia en un comentario, no
las cablea).

**Crear un cuarto tema:**

1. Copiar `src/styles/temas/neutro.css` a `src/styles/temas/<nombre>.css`.
2. Cambiar los valores de `:root` y `.dark` — las **mismas** 19 variables
   (más `--radius`, sólo en `:root`) tienen que estar en los dos bloques;
   `tests/unit/temas.test.ts` lo verifica leyendo los `.css`, no confía en
   memoria, así que un tema con una variable de menos hace fallar el test
   en vez de dejar un botón invisible en producción.
3. Escribir la cabecera (para quién, fuentes sugeridas, líneas de
   `layout.tsx`) — el test también la exige.
4. **Sólo en el template**, y sólo si querés que el wizard lo ofrezca:
   agregar `<nombre>` a la lista `TEMAS` de `scripts/nueva-tienda.ts`. En una
   tienda no hace falta —ni conviene: ese archivo es maquinaria—.
   `tests/unit/temas.test.ts` revisa **todos** los `.css` de
   `src/styles/temas/`, esté o no el nombre en `TEMAS`.
5. `pnpm nueva-tienda --tema <nombre>` para probarlo, y `pnpm build` una vez
   con el `@import` apuntando a ese archivo (después volver a dejar el tema
   que la tienda usa).

Nada de esto se lee en runtime: es CSS puro y una línea de `@import`. Ningún
componente importa el nombre del tema ni cambia de comportamiento según
cuál esté activo.

#### Del mockup al código

El primer paso de un rediseño por tienda es un mockup de Claude Design: se ve
antes de escribir nada, se corrige barato y evita el rediseño a ciegas. Lo que
cuesta cada vez es lo de después — traducir ese mockup a archivos. Esta tabla es
esa traducción, para no volver a deducirla en cada sesión:

| Lo que ves en el mockup | Dónde vive en el código | Nota |
|---|---|---|
| Paleta: fondo, texto, color principal, bordes | `src/styles/temas/<tema>.css` → `:root` y `.dark` (`globals.css` sólo importa uno) | Tokens de shadcn en **oklch**. Tres temas listos (§5 "El kit de temas") + `pnpm nueva-tienda --tema`; cambiás las variables, no las clases: todo el sitio las consume vía Tailwind |
| Modo oscuro | mismo archivo, bloque `.dark` | Si sólo tocás `:root`, la tienda queda linda de día y rota de noche. Cambiá los dos o ninguno |
| Redondeo de botones, cards, inputs | `--radius` en `src/styles/temas/<tema>.css` | Un solo número por tema; `--radius-sm/md/lg/xl` salen de ahí (`globals.css` los mapea en `@theme inline`) |
| Tipografía (títulos y cuerpo) | `src/app/layout.tsx` | Fuentes de `next/font/google`. Reemplazá `Geist`/`Geist_Mono` manteniendo las variables `--font-geist-sans` / `--font-geist-mono`, que es lo que `globals.css` mapea en `@theme inline` |
| Barra de arriba: logo, buscador, carrito, menú de categorías | `src/components/site-header.tsx` | Libre. Lo único que no conviene sacar es `CartButton` |
| Portada / hero de la home | `hero` en `src/config/tienda.ts`, y si no alcanza `src/components/home-hero.tsx` | Ver abajo: una portada de temporada no necesita tocar código |
| Resto de la home: grilla de destacados, categorías, secciones nuevas | `src/app/page.tsx` | Es de la tienda entera |
| Ficha de producto en la grilla | `src/components/product-card.tsx` | El precio "desde" y el badge de stock salen de `price-tag.tsx` y `stock-badge.tsx` |
| Foto de producto y sus placeholders | `src/components/product-image.tsx`, `public/placeholders/` | Cuatro placeholders dibujados, uno por categoría del seed; cualquier otra categoría cae en `categoria.svg` con su nombre en texto (no en el mismo dibujo de "producto sin foto") |
| Pie: columnas, contacto, WhatsApp | `src/components/site-footer.tsx` | El nombre y el tagline salen de `TIENDA`, no los escribas a mano |
| Botón flotante de WhatsApp | `src/components/whatsapp-fab.tsx` | El número sale del entorno (`src/lib/comercio.ts`) |
| Nombre, título del navegador, tagline, meta description | `src/config/tienda.ts` | **Nunca** en un componente: `tests/unit/marca-centralizada.test.ts` lo bloquea |
| Imagen que se ve al compartir el link | `src/app/opengraph-image.tsx` | Se dibuja sola con el nombre y el tagline. No hay que subir nada |
| Favicon | `src/app/favicon.ico` | Ningún control lo verifica; se olvida siempre |

Dos cosas que el mockup va a mostrar y **no** son piel: el checkout
(`src/components/checkout-form.tsx` es markup con lógica de plata adentro — se
repinta con cuidado, ver la tabla de abajo) y `/admin`, que se puede repintar
pero no rediseñar en su lógica.

Orden que funciona: tokens de `globals.css` → tipografía en `layout.tsx` →
header y footer → home → `product-card`. Los dos primeros pasos ya mueven el
80% de lo que se ve, y hacerlos antes evita retocar a mano colores que las
variables iban a resolver solas.

**La portada de la home** se cambia sin tocar código: `hero` en
[`src/config/tienda.ts`](./src/config/tienda.ts) acepta una foto de Cloudinary,
un título, una bajada y un botón. Con `hero: null` (el default) sale la portada
del template. Es lo que le permite al comercio cambiar su banner de temporada
solo; todo lo demás de la home se rediseña editando `src/app/page.tsx`.

Todo el color y el radio viven en `src/styles/temas/<tema>.css` (`:root` y
`.dark`, tokens de shadcn en oklch; `globals.css` sólo importa el archivo
activo) y se consumen vía Tailwind. Cambiar la paleta = elegir un tema
(§5 "El kit de temas") o editar esas variables directamente, nada más. La
tipografía se cambia en `src/app/layout.tsx` (fuentes de
`next/font/google`).

Qué se puede redibujar libremente y qué no:

| Piel — rediseñá lo que quieras | Maquinaria — no la bifurques por tienda |
|---|---|
| `site-header`, `site-footer`, home, `product-card`, páginas de categoría | `src/domain/**` (estados del pedido, stock, plata, Pagopar) |
| tokens de `globals.css`, tipografía, imágenes | checkout y sus rutas API |
| textos y copy | `/admin` completo |
| | `src/lib/**` (sesión, seguridad, guaraníes) |

Regla práctica: si el archivo toca plata, stock o estados de pedido, no se
toca por tienda. Si sólo dibuja, es libre.

#### La única excepción: los `data-testid`

Los specs de `tests/e2e/**` (compra, panel de admin, CSP) localizan los
elementos por `data-testid`, nunca por texto ni por markup — es lo que les
permite correr contra el catálogo real de cualquier tienda, no sólo el del
seed. El contrato completo, con qué elemento lleva cada id, vive en
[`src/lib/testids.ts`](./src/lib/testids.ts).

Rediseñar es libre —cambiar clases, mover el elemento, reescribir el texto
que lleva adentro—, con una sola regla: **no le saques el atributo
`data-testid` a un elemento que ya lo tiene.** Agregarle uno a un elemento
nuevo no rompe nada; sacarle el que ya tenía rompe el spec que lo busca, en
esta tienda y en la próxima sincronización. `tests/unit/testids-contrato.test.ts`
avisa si alguno de la lista deja de aparecer en `src/`.

### 6. Antes de cobrar de verdad

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm preflight     # qué falta para cobrar plata (banco, cron, modo Pagopar)
pnpm reconcile     # control de caja: totales e invariantes entre tablas
```

Deploy: el runbook completo está en **[DEPLOY.md](./DEPLOY.md)** — el flujo git
de Hostinger, las trampas del SSH, la base de datos, el cron cada 15 minutos
contra `/api/cron/vencer-pedidos` y la prueba de humo. Acordate además de
registrar la URL de respuesta de Pagopar.

### 7. Google Shopping y el catálogo de Meta (después del lanzamiento)

La tienda publica su catálogo en **`https://DOMINIO/feed.xml`** (un ítem por
variante, con foto, precio, tachado, stock y marca; lo arma
`src/lib/product-feed.ts`). Se carga **una vez** en cada panel y ellos lo
vuelven a leer solos:

- **Google Merchant Center** → Productos → Fuentes de datos → Agregar →
  "Recuperación programada" con esa URL, país Paraguay, idioma español,
  moneda PYG. Habilita las fichas gratuitas de Google Shopping.
- **Meta Commerce Manager** → Catálogo → Fuentes de datos → Feed de datos →
  URL programada, la misma. Habilita los anuncios de catálogo y las etiquetas
  de compra de Instagram y Facebook.

Sin `NEXT_PUBLIC_SITE_URL` el feed responde 404 (sin dominio no hay links), y
un producto sin foto no entra (Google lo rechazaría). No hay nada que
configurar en la tienda.

---

## Arreglos que aparecen después — ya tengo una tienda

Los repos creados desde un template no reciben **solos** los commits
posteriores del template: les llegan como un PR `template/sync` cada vez que se
publica una versión, o a mano con `pnpm template:sync`.

`pnpm template:diff` te dice qué le falta a **esta** tienda; `pnpm
template:sync` lo trae. Lo normal es no correrlo a mano: cada versión del
template le abre un PR a cada tienda (ver § "La distribución automática del
template"). A mano, el flujo completo es:

```bash
git remote add template https://github.com/antonmarklundcom/ecom.git   # una vez
git checkout -b poner-al-dia-template   # nunca sobre main
pnpm template:sync                      # trae la maquinaria, en un commit
git push -u origin poner-al-dia-template && gh pr create   # o el flujo de PR que uses
```

`template:sync` trabaja **archivo por archivo**, no commit por commit: para
cada archivo que el template cambió entre el `.template-baseline` de la
tienda y la última versión, compara la versión del template en el baseline,
la de la tienda y la del template ahora, y decide:

| Caso | Qué hace |
|---|---|
| La tienda nunca lo tocó (maquinaria o piel) | queda el del template: nuevo, cambiado o borrado |
| `KNOWN-ISSUES.md`, `ARCH.md`, `NEW-STORE.md`, `CHANGELOG.md` | queda el del template |
| Maquinaria cambiada de los dos lados | merge de 3 vías; si toca la misma línea, **conflicto** |
| `package.json` cambiado de los dos lados | merge por clave; si los dos cambiaron la misma (una dependencia), gana el template y se lista |
| Un test cambiado de los dos lados | gana el del template (va con la maquinaria que prueba) y se lista |
| Maquinaria que la tienda no tiene y el template cambió | vuelve (la maquinaria no se saca por tienda) |
| Piel o docs que la tienda cambió o borró (home, `product-card`, `README.md`, `CLAUDE.md`…) | queda lo de la tienda; se lista |
| Mixtos (`checkout-form.tsx`, `src/app/admin`) que la tienda cambió | queda lo de la tienda; se listan aparte para mirar la lógica nueva a mano |
| `fable/`, `.github/dependabot.yml`, `tiendas.json` | nunca viajan (y se sacan si una tienda vieja los tiene) |
| `pnpm-lock.yaml` | el del template si las dependencias quedaron iguales; si no, se regenera |

Maquinaria acá es `src/domain`, `src/lib`, `src/db`, `src/app/api`,
`src/app/actions`, `scripts`, `drizzle`, `.github/workflows`, `tests`,
`.husky`, más `package.json`, los configs de la raíz y el diccionario
`src/i18n/es-PY.ts` (sus textos son tuyos, pero la maquinaria usa sus claves:
fusionarlo deja tus textos y suma las claves nuevas).

Todo termina en **un** commit con el `.template-baseline` nuevo adentro. Si
hubo conflictos, no commitea: deja todo lo demás aplicado, los archivos en
conflicto con los marcadores de siempre y el baseline ya escrito. Resolvés,
`git add -A`, `git commit`, y listo. Al final corre `pnpm typecheck && pnpm
lint && pnpm test` (salvo `--sin-tests`): si algo falla, el commit ya está y
lo arreglás en uno aparte.

```bash
pnpm template:sync --dry-run        # qué haría con cada archivo, sin tocar nada
pnpm template:sync --hasta <sha>    # sincronizar hasta un commit dado del template
pnpm template:sync --sin-tests      # no correr typecheck/lint/test al final
```

Hasta v1.0.0 esto era un cherry-pick por commit. Con tiendas reales se
frenaba en el primer commit que tocaba algo que la tienda había cambiado
(un `CLAUDE.md` propio, un test adaptado a su piel, un archivo que nunca
trajo) aunque el resultado final no chocara con nada.

`pnpm template:diff` sigue sirviendo para mirar qué commits del template no
están acá:

```bash
pnpm template:diff              # qué commits del template no están acá
pnpm template:diff --marcar     # "ya me puse al día"
```

Marca con `*` los que tocan la maquinaria: ésos los quiere toda tienda. Con
`~` marca `src/components/checkout-form.tsx` y `src/app/admin`: markup tuyo
con lógica compartida adentro, así que ahí leé el diff. Las *actions* de
admin sí van con `*` — ahí está la plata.

**Trampa:** un repo hecho con "Use this template" **no comparte historia** con
el original, así que `git log HEAD..template/main` lista todo y no sirve. Por
eso ambos comandos se apoyan en un punto de partida guardado en
`.template-baseline` —commitealo—, que `template:diff --marcar` (o el commit
final de `template:sync`) es lo que mueve. Si no hay `.template-baseline`
todavía, corré `pnpm template:diff --marcar --origen` (busca el commit del
template con el árbol del primer commit de la tienda) antes de tocar
`template:sync`. Un repo que ya existía no tiene ese commit: `pnpm
bootstrap:repo` escribe el baseline solo (el commit del template que copió);
si no, escribí el SHA a mano. **No** uses `--marcar` a secas para arrancar: marca
la punta de hoy y da por traído todo lo que el template arregló desde que la
tienda salió.

### Migraciones que llegan por `template:sync`

Una migración del template es **maquinaria**: viaja marcada con `*` y
`template:sync` la trae sola (`drizzle/` entero, con su `_journal.json`). Después del sync, en
esta tienda hay que aplicarla como cualquier otra —`pnpm db:push` en local,
`POST /api/setup/init` en el servidor (DEPLOY.md)— y `pnpm db:generate` tiene
que quedar sin drift.

La `0012` (plan de operación, fase O5) agrega el seguimiento del envío, las
notas del pedido, el punto de reposición por variante, "avisame cuando haya
stock", destacados, categorías con foto y descripción, el ledger de
devoluciones y la tabla de trabajos programados. **Toda columna nueva es
nullable o tiene default**, y eso es a propósito: una tienda que sincroniza el
código antes que la migración tiene que seguir andando. Trae además un
backfill escrito a mano (`src/db/backfills.ts`) que le arma la fila de ledger
a cada devolución anterior a esta migración; sin él, la contabilidad de
`pnpm reconcile` nace en rojo en toda tienda que ya devolvió plata alguna vez.

La `0013` (plan de crecimiento, fase O14) agrega una sola columna,
`orders.payment_reminder_sent_at`: la marca de que a ese pedido ya se le mandó
el recordatorio de pago. Nullable, sin backfill — un pedido viejo sin la marca
es exactamente lo que corresponde. Sin ella, la tienda anda igual; lo que no
anda es el recordatorio que agrega O15.

La `0017` (integraciones desde el panel, §4a-ter) crea una tabla nueva,
`integration_settings`, vacía. **Una tienda existente no pierde nada**: sin
filas, cada integración sale de sus variables de entorno exactamente como
antes, así que el PR `template/sync` se mergea, se corre el setup y la tienda
sigue igual. Pasar una integración al panel es opcional y se hace de a una:
cargarla en `/admin/integraciones`, probar la conexión, y recién después borrar
esas variables del hPanel (Redeploy), para no dejar dos verdades. Si la tienda
sincroniza el código antes de migrar, la lectura de la tabla falla en silencio
(queda en el log) y todo sigue saliendo del entorno.

Sigue valiendo lo de siempre: Dependabot no mueve nada de esto y las columnas
no se agregan a mano en el hPanel — la migración es la única fuente.

Si algún día son muchas tiendas, recién ahí conviene sacar `src/domain` y
`src/lib` a un paquete compartido. Antes de eso es complejidad sin pagar.
