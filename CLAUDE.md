# CLAUDE.md

Este repo es el **template** de tiendas online (`antonmarklundcom/ecom`), o
una tienda creada desde él con "Use this template". Antes de tocar código,
leé:

- **NEW-STORE.md** — el camino completo para levantar una tienda nueva:
  `pnpm nueva-tienda`, entorno, base de datos, catálogo, diseño, preflight.
  §1b es el caso del repo que ya existe con algo adentro (`pnpm bootstrap:repo`);
  §5 mapea qué archivo toca cada parte de un mockup.
- **ARCH.md** — arquitectura: dominio, estados del pedido, plata, Pagopar.
- **PLAN.md** / **TASKS.md** — qué falta y en qué fase está.
- **fable/plan-crecimiento.md** — deuda de dominio de `KNOWN-ISSUES.md`,
  recordatorio de pago, edición de pedido sin pagar, kit de temas, dependencias.
  Seis fases (O14–S19) en dos ventanas (§11), **todas mergeadas — hoy es
  historial**, igual que `fable/plan-operacion.md` y `fable/plan.md`. Sale de la
  revisión `fable/REVIEW.md` (2026-09-11). La última revisión de maquinaria es
  `fable/REVIEW-2026-09-13.md` (ya aplicada, #109) y la auditoría del template
  como fábrica de tiendas es `fable/TEMPLATE-REVIEW.md` (2026-09-19, T1–T7, todos
  cerrados). La próxima revisión sale de `fable/PROMPT.md`. `fable/` sólo existe
  en el template: una tienda no lo tiene (`pnpm nueva-tienda` lo borra).
- **fable/plan-operacion.md** — la tienda después del lanzamiento (tracking, notas,
  remito, resumen diario, backups, panel, vidriera, CI, distribución a las tiendas).
  Nueve fases (O5–S13), **todas mergeadas — hoy es historial**, igual que
  `fable/plan.md` (revisión en `fable/REVIEW-2026-09-02.md`, fases en `fable/prompts/`).
  `fable/PROMPT.md` es el prompt que genera la próxima revisión.
- Operación diaria del panel, backups/restore y la distribución automática a las
  tiendas (`.github/workflows/distribuir.yml` + `tiendas.json`): NEW-STORE.md §4f y
  § "La distribución automática del template". Cron consolidado (las tres entradas,
  hora Asunción y UTC): DEPLOY.md §5.
- **DEPLOY.md** — el runbook de Hostinger.

## La regla que más importa: maquinaria vs. piel

| Maquinaria — no se toca por tienda | Piel — libre de rediseñar |
|---|---|
| `src/domain/**` (estados del pedido, stock, plata, Pagopar) | `site-header`, `site-footer`, home, `product-card`, categorías |
| `src/lib/**` (sesión, seguridad, guaraníes) | tokens de `globals.css`, tipografía, imágenes |
| checkout y sus rutas API, `src/app/actions` | textos y copy |
| `/admin` (lógica; el markup se puede repintar) | `src/config/tienda.ts` (marca, hero, flags) |

Regla práctica: si el archivo toca plata, stock o estados de pedido, no se
toca por tienda. Si sólo dibuja, es libre. Ver NEW-STORE.md §5 para el
detalle completo y las excepciones (`checkout-form.tsx`, `src/app/admin`).
Al rediseñar piel, no le saques el `data-testid` a un elemento que ya lo
tiene — es el contrato que usan los specs de `tests/e2e/**`, ver
NEW-STORE.md §5 y `src/lib/testids.ts`.

## Antes de cualquier cambio

- Marca, textos y contacto salen de `src/config/tienda.ts` — no hardcodees el
  nombre de la tienda en otro archivo (`tests/unit/marca-centralizada.test.ts`
  lo bloquea).
- No inventes credenciales de terceros ni valores "por si acaso" (ver
  `.env.example` y `docs/ENV-OPCIONAL.md`): una variable vacía debe apagar la
  feature, no fallar en silencio ni usar un default inventado.
- `.env.example` tiene **sólo las cinco imprescindibles** (`DATABASE_URL`,
  `SESSION_SECRET`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `SETUP_SECRET`):
  Hostinger lo lee y precarga un campo del hPanel por variable. Una variable
  opcional nueva se documenta en `docs/ENV-OPCIONAL.md`, nunca en
  `.env.example` (`tests/unit/env-example.test.ts` lo bloquea).
- Credenciales de integraciones (Cloudinary, WhatsApp, Pagopar, GA4/Pixel,
  reporte de errores) se leen **sólo** por `src/lib/integraciones.ts`
  (panel `/admin/integraciones` > entorno > apagado), nunca con `process.env`
  directo. Los secretos van cifrados (`src/lib/secret-box.ts`) y no vuelven al
  navegador. NEW-STORE.md §4a-ter.
- Nombre, logo, favicon y color de marca salen de `marcaEfectiva()` /
  `nombreTienda()` (`src/lib/marca.ts`: panel `/admin/ajustes` → Identidad >
  `tienda.ts`), y las cuentas de cliente de `cuentasClientesHabilitadas()` de
  `src/lib/cuentas.ts` (async). No leas `TIENDA.nombre` directo en código nuevo.
- Cambios de schema van con su migración generada y commiteada
  (`pnpm db:generate`) — CI falla si `schema.ts` se despega de `drizzle/`.
- Antes de dar por terminado algo: `pnpm typecheck && pnpm lint && pnpm test`.
- Para saber si una tienda ya puede cobrar: `pnpm preflight`. Para control de
  caja: `pnpm reconcile`.

## Si este repo es una tienda (no el template)

Corré `pnpm template:diff` de vez en cuando para ver qué arreglos de
`antonmarklundcom/ecom` le faltan a esta tienda (requiere el remoto
`template`, ver NEW-STORE.md). Normalmente llegan solos: cada versión del
template abre (o actualiza) un PR `template/sync` en esta tienda. A mano,
`pnpm template:sync` —en una rama, nunca en `main`— los trae archivo por
archivo en un commit: la piel que rediseñaste queda, la maquinaria se
fusiona, y un choque de verdad deja marcadores para resolver. Ver
NEW-STORE.md § "Arreglos que aparecen después". No cherry-pickees piel que ya
rediseñaste.
