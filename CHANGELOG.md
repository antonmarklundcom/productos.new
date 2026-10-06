# CHANGELOG.md — versiones del template

Cada versión es un tag `vX.Y.Z` sobre `main` de `antonmarklundcom/ecom`.
Publicar una versión dispara `.github/workflows/distribuir.yml`, que abre un PR
de maquinaria en cada tienda de `tiendas.json` (NEW-STORE.md § "La distribución
automática del template"). Un push a `main` ya **no** distribuye: los arreglos
se juntan acá y viajan todos juntos, así cada tienda recibe un PR por versión y
no uno por merge (cada PR corre el CI de esa tienda, y eso son minutos de
Actions).

## Cómo publicar una versión

1. Todo mergeado en `main` y CI verde.
2. `pnpm template:probar-tienda`: una tienda nueva desde ese commit tiene que
   quedar en verde (0 minutos de Actions, corre en tu máquina).
3. Acá abajo, renombrar "Sin publicar" a la versión nueva con la fecha, y dejar
   un "Sin publicar" vacío arriba. **Marcar "Migración: sí"** si algún cambio
   trae una migración en `drizzle/` (la tienda tiene que redeployar y correr
   el setup, NEW-STORE.md § "Migraciones que llegan por `template:sync`").
4. `git tag vX.Y.Z && git push origin vX.Y.Z`.

Versionado: **mayor** si una tienda tiene que hacer algo a mano además de
mergear el PR (variable nueva obligatoria, paso de deploy); **menor** para
funciones nuevas; **parche** para arreglos.

## Sin publicar

- **Identidad desde el panel** (`/admin/ajustes` → Identidad): nombre, logo,
  favicon y color de marca, sin tocar `tienda.ts` ni redeployar. `tienda.ts`
  queda como default. Todo lo que mostraba `TIENDA.nombre` (header, títulos,
  Open Graph, remito, mensajes, feed) lee ahora `nombreTienda()`.
- **Cuentas de cliente desde el panel** (`/admin/ajustes` → Cuentas de
  cliente), y **`CUSTOMER_SESSION_SECRET` ya no hace falta**: vacío, se deriva
  de `SESSION_SECRET` con HKDF. Las tiendas que lo tienen cargado siguen igual.
  `cuentasClientesHabilitadas()` se mudó a `src/lib/cuentas.ts` y es async.
- **`/setup`**: la configuración inicial desde el navegador (mismo POST que el
  curl a `/api/setup/init`; sólo existe con `SETUP_SECRET` puesto).
- Sin migración: todo vive en `store_settings` (JSON). Piel rediseñada: ver
  NEW-STORE.md §4a-quater para que header y pie propios lean el nombre y el
  logo del panel.
- **Integraciones desde el panel (`/admin/integraciones`, sólo el dueño).
  Migración: sí (`0017`, tabla nueva `integration_settings`).** Cloudinary,
  WhatsApp (número del comercio, Cloud API y plantillas), Pagopar, GA4/Pixel y
  el reporte de errores se cargan sin tocar el hPanel ni redeployar. Precedencia
  panel > entorno > apagado; secretos cifrados con AES-256-GCM (clave derivada
  de `SESSION_SECRET`), nunca devueltos al navegador; "Probar conexión";
  `pnpm preflight` dice de dónde sale cada valor; el CSP sigue a la medición
  efectiva. **Las tiendas existentes no tienen que hacer nada**: sin filas en
  la tabla, todo sale de sus variables de entorno como antes. Después del sync,
  correr el setup para aplicar la migración (NEW-STORE.md § "Migraciones que
  llegan por `template:sync`").
- **`.env.example` mínimo:** trae sólo las cinco imprescindibles
  (`DATABASE_URL`, `SESSION_SECRET`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`,
  `SETUP_SECRET`), porque Hostinger lo lee y precarga un campo del hPanel por
  variable. Las demás —con los mismos comentarios— se mudaron a
  `docs/ENV-OPCIONAL.md`; `TEST_DATABASE_URL` pasó al README. **Una tienda
  existente no tiene que hacer nada**: las variables que ya cargó en el hPanel
  siguen funcionando igual, ninguna cambió de nombre ni de significado.
- **`template:sync` trae la maquinaria que le falta a la tienda**, aunque el
  template no la haya cambiado desde el baseline. Antes sólo miraba lo que
  cambió en `baseline..objetivo`, y un baseline marcado "al día" con archivos
  de menos los escondía para siempre: productos llegó a 15 archivos faltantes
  (`src/lib/spreadsheet.ts` entre ellos, que `admin-products.ts` importa) sin
  que nada lo avisara. La piel que falta se sigue respetando.
- **`template:diff` lista esa maquinaria faltante, y `--marcar` se niega**
  mientras falte algo (`--forzar` para marcar igual).
- **Dependencias más viejas que las del template:** en `package.json`, una
  versión de la tienda más vieja que la del template pierde siempre (se lista
  como pisada). Antes contaba como "cambio de la tienda" y se quedaba:
  productos siguió con `iron-session` 8 y React 19.2 y el build no pasaba.
- **Temas propios sin tocar maquinaria:** `tests/unit/temas.test.ts` revisa
  todos los `.css` de `src/styles/temas/`; una tienda con su tema ya no tiene
  que sumarlo a `TEMAS` en `scripts/nueva-tienda.ts` (NEW-STORE.md §5).
- **`distribuir.yml` falla sin `TIENDAS_TOKEN`** en vez de terminar en verde
  con un aviso: en trece corridas no distribuyó nada y nadie se enteró.

Migración: sí (`product_reviews`, `order_returns`, `order_return_items`,
`store_settings`).

- **Planilla de productos con fotos:** la columna opcional `Fotos` (una o más
  URLs `https://` separadas por `|`, espacio o salto de línea) sube las fotos
  a Cloudinary sola al importar — desde `/admin/productos` o
  `pnpm importar:productos --aplicar` — sólo a un producto que todavía no
  tiene ninguna, para que reimportar la misma planilla no duplique nada. Sin
  credenciales de Cloudinary se avisa y se sigue sin ellas; una foto que falla
  no frena el resto de la importación.
- **Ajustes de la tienda (`/admin/ajustes`, sólo el dueño):** bajada, título y
  descripción de la home, portada (con foto subida a Cloudinary), barra de
  anuncio, WhatsApp público, email, dirección, horario y redes, sin tocar
  `tienda.ts` ni el entorno. Vacío = el de siempre, así que una tienda que no
  entra al panel se ve igual que antes. Una fila JSON (`store_settings`): los
  ajustes que vengan después no traen migración. Los avisos al dueño siguen
  yendo a `WHATSAPP_NUMBER`; el número público es el del panel si está.
  La home publica un `Organization` en JSON-LD cuando hay
  `NEXT_PUBLIC_SITE_URL`.
- **Páginas de políticas:** `/envios`, `/devoluciones`,
  `/preguntas-frecuentes`, `/terminos` y `/privacidad`, con textos de arranque
  editables desde el panel (hay que revisarlos antes de lanzar), enlazadas en
  el pie y en el sitemap. Se pueden apagar de a una.
- **Google:** con los datos de envío y devolución cargados en el panel, cada
  `Offer` del JSON-LD de producto lleva `shippingDetails` y
  `hasMerchantReturnPolicy`. Lo que no se cargó no se publica.
- **Vidriera y checkout:** estrellas y cantidad de reseñas en las tarjetas de
  producto (una consulta agrupada por listado), barra de compra fija en el
  celular en la ficha, y un recuadro "Comprá tranquilo" en el checkout con los
  medios de pago que de verdad se ofrecen. Los tres se apagan desde el panel.
- **Stock bajo:** el umbral global (resumen del panel y aviso diario) se
  cambia desde el panel; el de cada variante sigue ganando.
- **Tiendas con piel propia:** `layout.tsx`, `site-footer.tsx` y `page.tsx`
  son piel y `template:sync` no los pisa; la barra de anuncio, los links a las
  páginas y el contacto del pie hay que sumarlos a mano (NEW-STORE.md §4a-bis).

- **Reseñas verificadas:** sólo quien recibió el pedido (estado `entregado`)
  califica, una vez por producto, desde la página de su pedido. El panel
  (`/admin/resenas`, owner y staff) publica, rechaza y responde en público,
  pero no crea ni edita reseñas. Las aprobadas salen en la ficha y en el
  JSON-LD (`aggregateRating` + `review`) para las estrellas de Google. Aviso
  opcional por WhatsApp al entregar: `WHATSAPP_CLOUD_TEMPLATE_CLIENTE_RESENA`
  (vacía = apagado).
- **Devoluciones de mercadería:** en la ficha del pedido (enviado, entregado
  o reembolsado) se registra qué volvió, cuánto de cada línea (nunca más de
  lo vendido) y si vuelve al stock — con su fila en `stock_adjustments` y el
  aviso de "volvió el stock" si estaba agotada. Listado en
  `/admin/devoluciones` (owner y staff). El reembolso sigue siendo un paso
  aparte. La compradora ve "¿Querés cambiar o devolver algo?" por WhatsApp
  con el pedido entregado.
- **Comprobantes de más de 1 MB:** Next cortaba el body de las server
  actions en 1 MB y una foto de comprobante de 2 MB terminaba en la pantalla
  de error. `next.config.ts` ahora sube el límite al del archivo más grande
  (`src/lib/upload-limits.ts`); lo mismo para fotos y planilla.
- **Reservas de stock con MySQL fuera de UTC:** cada conexión del pool fija
  `time_zone = '+00:00'`. Con la hora del servidor (Hostinger: `SYSTEM`), las
  reservas vencían antes de nacer o duraban horas de más. CI corre MySQL a
  -03:00 para que no vuelva.
- **Checkout:** no vende productos sin publicar ni de una categoría apagada
  (un carrito viejo o un POST armado a mano los compraba). El tope de un
  cupón por cliente ya no se pasa con dos checkouts simultáneos del mismo
  WhatsApp. Y editar un pedido sin bajarle el subtotal (corregir la
  dirección) ya no le quita el cupón si el comercio subió el mínimo después.
- **Seguridad:** la limpieza del rate limit usaba la ventana de quien la
  disparaba (una búsqueda de 60 s) y borraba los intentos de login, OTP y
  registro de los últimos 15 min: el tope de login pasaba de 8 cada 15 min a
  ~8 por minuto. Y el log y el reporte de errores (`ERROR_REPORT_URL`) ya no
  llevan la query de la ruta, donde viajan el token del pedido y el secreto
  del cron.
- **Fábrica de tiendas:** `pnpm nueva-tienda` ya no mueve un
  `.template-baseline` existente, y el primero lo marca en el commit del que
  salió la tienda (`template:diff --marcar --origen`), no en la punta de hoy
  —que daba por traídos arreglos que nunca llegaban—. `bootstrap:repo` marca
  el commit que copió. La distribución vuelve a abrir PR en una tienda cuyo
  PR anterior se cerró o se mergeó con squash (antes la salteaba para
  siempre, en verde). `template:sync` trae rutas con tildes y avisa aparte la
  piel rediseñada que el template borró o renombró. `.gitattributes` fija LF.
- **SEO:** el `Product` JSON-LD de la ficha lleva `image`, `url` e
  `itemCondition` (sin imagen Google no da rich result de producto ni listado
  de comercio). Lo arma `productJsonLd` en `src/lib/seo.ts`.
- **Feed de productos `/feed.xml`** para Google Merchant Center y el
  catálogo de Meta: fichas gratuitas en Google Shopping y anuncios de
  catálogo e Instagram Shopping sin cargar productos a mano (NEW-STORE.md §7).
- **Embudo para GA4 y Meta:** `view_item`/`ViewContent` en la ficha,
  `add_to_cart`/`AddToCart` al agregar y `begin_checkout`/`InitiateCheckout`
  en el checkout, con el SKU como id (el mismo `g:id` del feed). Sin
  medidores configurados no carga ni manda nada.
- **Purchase con productos:** el evento de compra de GA4/Meta lleva las
  líneas con el SKU como id (atribución al catálogo) y no se manda para un
  pedido que ya está vencido, cancelado o rechazado cuando se abre el link.
- **Arranque de una tienda:** DEPLOY.md ya no manda `"seed": true` al setup
  (sembraba el catálogo de ejemplo —auriculares, termos— a la venta al lado
  del real) y el cuerpo de ejemplo trae las zonas de envío, que no son
  opcionales. El resumen del panel avisa si quedan productos de ejemplo
  activos o si no hay ninguna zona activa (el envío sale gratis a todo el
  país).
- **Cron de vencimientos visible:** `vencer-pedidos` deja su latido en
  `job_runs`, y el resumen del panel le avisa al dueño si nunca corrió o si
  lleva más de 2 h sin correr. Sin ese cron los pedidos sin pagar no vencen,
  el stock queda reservado y no sale ningún recordatorio — sin nada roto a la
  vista. `/api/health` suma `"cron"`: el monitor de DEPLOY.md §8 ahora
  busca `"db":true,"cron":true`.
- **`next.config.ts`: `experimental.cpus: 1`** (el fix de Hostinger de
  lenceria, vendercrm y propia: un solo build worker, para que un deploy no
  agote los procesos que comparte la cuenta). En una tienda que ya lo tenía
  (lenceria), el PR de sincronización trae un conflicto de un bloque en ese
  archivo: quedarse con el del template.
- CI: un label que no es `ci-completo` ya no cancela la corrida del PR. Con
  Dependabot (que etiqueta el PR apenas lo abre) ningún job llegaba a correr.

## v1.0.0 — 2026-09-22

**Migración: sí** (para las tiendas cuyo baseline es anterior a O5/O14: la
`0011`–`0013` llegan con esta versión). Primera versión publicada: ninguna
distribución corrió antes, así que cada tienda recibe **todo** lo que el
template cambió desde su `.template-baseline`, no sólo lo de esta lista. El PR
de cada tienda lista archivo por archivo qué trae. Después de mergearlo:
redeployar y correr el setup (NEW-STORE.md § "Migraciones que llegan por
`template:sync`").

- `.env.example` ya no trae un WhatsApp de ejemplo y `pnpm preflight` bloquea
  el viejo (`+595981123456`) si quedó en un `.env.local`.
- CI según el repo: en uno **público** (gratis en Actions) `checks` y `e2e`
  corren en cada PR y en cada push a `main`, y `lighthouse` en cada push a
  `main`. En uno **privado**: sólo PRs, `e2e` con el label `ci-completo`, a
  mano o en un PR de distribución, `lighthouse` a mano. Poner `ci-completo`
  dispara la corrida. En los dos: nada en PRs de sólo docs y se cancela la
  corrida vieja. `distribuir.yml` y `pnpm-al-dia.yml` no corren en las tiendas.
- Hook `pre-push` con `pnpm test:unit` (unitarios en paralelo, ~15 s, sin
  base); `pnpm test` sigue corriendo todo.
- Las tiendas ya no heredan `fable/`, Dependabot ni `tiendas.json`
  (`SOLO_TEMPLATE`): `nueva-tienda` los borra, `bootstrap:repo` no los copia,
  `template:sync` los saca.
- **`template:sync` trabaja archivo por archivo** (baseline → versión nueva), no
  commit por commit: en las tres tiendas reales el cherry-pick se frenaba en el
  primer commit que tocaba algo que la tienda había cambiado. Ahora la piel que
  la tienda cambió queda, la maquinaria se fusiona (`package.json` por clave),
  los tests cambiados de los dos lados toman el del template, `src/i18n/es-PY.ts`
  se fusiona (textos de la tienda + claves nuevas), los docs del template
  (`KNOWN-ISSUES.md`, `ARCH.md`, `NEW-STORE.md`, `CHANGELOG.md`) toman el del
  template, y todo queda en un commit. `tests/` y `.husky/` pasan a ser
  maquinaria (un arreglo que sólo tocaba un test no llegaba a las tiendas).
- `distribuir.yml`: corre el `template-sync.ts` del template contra la tienda
  (ya no copia el script adentro, que chocaba consigo mismo, ni corre
  `pnpm install` de la tienda con el token en el entorno); una sola rama
  `template/sync` por tienda (no un PR nuevo por corrida) que no pisa commits
  hechos a mano; base = default branch de la tienda; un conflicto abre el PR en
  draft con los marcadores commiteados (antes no abría nada); crea el label
  `ci-completo` en la tienda. `TIENDAS_TOKEN` necesita además **Workflows:
  write** (NEW-STORE.md).
- `tiendas.json`: productos, lenceria y mascota. Sólo acepta `repo`, `dominio`
  y `notas`, y un test rechaza credenciales o datos de la base de Hostinger.
- Nuevos `pnpm template:probar-tienda` (una tienda nueva desde HEAD, en verde) y
  `pnpm template:ensayar-distribucion [--verificar]` (la distribución contra
  cada tienda de `tiendas.json` en clones temporales, sin empujar nada).
- La suite avisa si corre contra MariaDB (T3).
