import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { z } from 'zod';

import { getDb, getPool } from '@/db';
import { applySchemaExtras } from '@/db/extras';
import { setupState, users } from '@/db/schema';
import { preflight } from '@/domain/preflight';
import { createUser, normalizeEmail } from '@/lib/auth';
import { hashPassword, passwordStrengthMessage, validatePasswordStrength } from '@/lib/password';
import { SETUP_LIMIT, SETUP_WINDOW_MS, clientIp, rateLimit } from '@/lib/rate-limit';
import { log, mensajeDe } from '@/lib/log';

/**
 * Inicialización de una tienda recién deployada (DEPLOY.md §4).
 *
 *   curl -X POST https://TU-DOMINIO/api/setup/init \
 *     -H "Authorization: Bearer $SETUP_SECRET" \
 *     -H "content-type: application/json" \
 *     -d '{"seed":true,"owner":{"email":"...","password":"..."}}'
 *
 * Por qué existe: el slot de Node de Hostinger no tiene `node` en el PATH, el
 * `pnpm install` por SSH muere con los ulimits del hosting compartido y el
 * checkout de git no es el filesystem de la app que corre. Cada tienda nueva
 * terminaba peleando media hora con eso para hacer tres cosas que la app ya
 * sabe hacer. Acá las hace **desde adentro de la app que ya está corriendo**,
 * con un curl.
 *
 * Qué hace, en orden:
 *
 *  1. Migraciones versionadas de `./drizzle` — las mismas que corre el setup de
 *     los tests. **No** se invoca drizzle-kit en runtime: es una devDependency
 *     que en el servidor no existe, y `db:push` compara contra `schema.ts`, que
 *     es exactamente lo que no queremos que decida solo en producción.
 *  2. `applySchemaExtras()` — FULLTEXT, FK self-ref y el contador de pedidos,
 *     que el dialecto MySQL de drizzle-kit no genera. Ya era idempotente.
 *  3. Seed del catálogo de ejemplo, si se pide.
 *  4. Zonas de envío de la tienda, si vienen en el cuerpo (`zonas`). Upsert por
 *     `slug`, el mismo de `seedCatalog` — nunca borra las que no vengan.
 *  5. Cuenta del dueño, si se pide.
 *
 * Y devuelve el **reporte de `preflight()`** (PLAN.md FASE 2, PR U): qué falta
 * para cobrar de verdad, medido contra el entorno **de este proceso**, que es
 * el del servidor. Antes eso pedía correr `pnpm preflight` desde la máquina de
 * quien deploya, contra un `.env` copiado a mano — o sea, contra un entorno
 * parecido al de producción y no contra el de producción. `preflight()` no
 * toca la base ni la red y no imprime el valor de ningún secreto: sólo si está
 * y si tiene el largo mínimo, así que es seguro contestarlo acá.
 *
 * 1 y 2 corren **siempre**: son idempotentes por construcción, así que esta
 * ruta es además el corredor de migraciones de los deploys siguientes (mandale
 * `{}` y sólo migra). 3 y 4 escriben datos del negocio, y ésos se cierran con
 * la marca de `setup_state` en cuanto corrieron una vez: un curl repetido por
 * nervios no puede volver a sembrar el catálogo sobre una tienda que ya vende.
 * Para reabrirlos hay que pedirlo, con `force: true`.
 *
 * El candado es el mismo del cron (`/api/cron/vencer-pedidos`): sin
 * `SETUP_SECRET` la ruta responde 503, compara en tiempo constante, está
 * rate-limited y el 401 no dice por qué. Y lo que se responde son cantidades y
 * resultados por paso — ni ids, ni emails, ni nada del cuerpo.
 */

// Corre migraciones y escribe: nunca se prerenderiza.
export const dynamic = 'force-dynamic';
// Lee los .sql de ./drizzle del disco: es Node, no edge.
export const runtime = 'nodejs';

const MIN_SECRET_LENGTH = 16;

/**
 * Sólo POST. Un GET que migra la base es un GET que dispara cualquier
 * prefetcher, cualquier bot y cualquier "abrir en pestaña nueva".
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.SETUP_SECRET;

  // Sin secreto configurado la ruta no existe. Y ése es el estado final
  // deseado: terminado el setup, se saca SETUP_SECRET del hPanel y esto vuelve
  // a 503 para siempre (DEPLOY.md §4).
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    log.error('SETUP_SECRET no está configurado (o es demasiado corto)');
    return json({ error: 'not_configured' }, 503);
  }

  // La comparación de abajo es en tiempo constante, pero nada impide probar
  // secretos de a millones: el límite corta eso.
  const ip = clientIp(request.headers);
  if (!rateLimit(`setup:${ip}`, { limit: SETUP_LIMIT, windowMs: SETUP_WINDOW_MS }).ok) {
    return json({ error: 'rate_limited' }, 429);
  }

  // El secreto viaja en un header y la contraseña del dueño en el cuerpo: por
  // http en claro los dos quedan en cualquier proxy del camino. Mismo criterio
  // que el preflight le exige a NEXT_PUBLIC_SITE_URL.
  if (isProduction() && !isHttps(request)) {
    return json({ error: 'https_required' }, 400);
  }

  if (!presentedSecretMatches(request, secret)) {
    // Sin detalle y sin loguear nada de lo que llegó, igual que el cron.
    log.warn('setup: intento rechazado');
    return json({ error: 'unauthorized' }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = BODY.safeParse(body ?? {});
  if (!parsed.success) {
    // El primer problema y en castellano. El cuerpo NO se refleja en la
    // respuesta: adentro viene la contraseña del dueño.
    return json({ error: 'cuerpo_invalido', detalle: primerError(parsed.error) }, 400);
  }
  const input = parsed.data;

  if (input.owner) {
    const strength = validatePasswordStrength(input.owner.password);
    if (!strength.ok) {
      return json({ error: 'password_debil', detalle: passwordStrengthMessage(strength.reason) }, 400);
    }
  }

  try {
    return await run(input);
  } catch (error) {
    log.error('setup: falló la corrida', { error: mensajeDe(error) });
    return json({ error: 'internal_error' }, 500);
  }
}

type Input = z.infer<typeof BODY>;

const BODY = z.object({
  /** Catálogo de ejemplo. Nunca resetea stock: eso no se hace por HTTP. */
  seed: z.boolean().optional().default(false),
  owner: z
    .object({
      // `.trim()` antes de validar: el email suele venir de un copy-paste al
      // curl y un espacio al final no es un error del que valga la pena
      // hablar. La contraseña NO se toca — ahí un espacio es un carácter.
      email: z
        .string()
        .trim()
        .max(200)
        .pipe(z.email('el email del dueño no tiene forma de email')),
      password: z.string().max(200),
      name: z.string().max(160).optional(),
    })
    .optional(),
  /**
   * Zonas de envío reales de la tienda. Upsert por `slug`; lo que no venga en
   * la lista **no se toca** (borrar una zona en uso no se ofrece por HTTP).
   *
   * El tope de 100 y el de 400 ciudades son los mismos que acepta el ABM del
   * panel: esta ruta no puede ser una puerta más ancha que la pantalla.
   */
  zonas: z
    .array(
      z.object({
        slug: z.string().trim().min(1).max(120),
        name: z.string().trim().min(1).max(160),
        cities: z.array(z.string().trim().min(1).max(120)).max(400).optional().default([]),
        // Guaraníes enteros. `assertGs` lo vuelve a exigir adentro del upsert:
        // esto es el mensaje para quien escribe el curl, eso es la regla.
        pricePyg: z.number().int().min(0),
        freeThresholdPyg: z.number().int().positive().nullable().optional().default(null),
        position: z.number().int().min(0).optional().default(0),
      }),
    )
    .max(100)
    .optional(),
  /** Reabre seed, zonas y dueño en una tienda ya inicializada. */
  force: z.boolean().optional().default(false),
});

type Pasos = {
  migraciones: string;
  extras: string;
  seed: string;
  zonas: string;
  duenio: string;
};

async function run(input: Input): Promise<Response> {
  const db = getDb();

  // Siempre, y en este orden: primero las tablas, después los objetos que
  // drizzle-kit no sabe generar.
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  const extras = await applySchemaExtras(getPool());

  const pasos: Pasos = {
    migraciones: 'aplicadas',
    // `applySchemaExtras` devuelve lo que dejó en su lugar, no lo que faltaba:
    // en una base ya inicializada la lista es corta, no vacía.
    extras: `aplicados (${extras.length})`,
    seed: 'no pedido',
    zonas: 'no pedidas',
    duenio: 'no pedido',
  };

  const previo = (await db.select().from(setupState).where(eq(setupState.id, 1)).limit(1))[0];
  const yaInicializada = previo !== undefined;
  const pideDatos = input.seed || input.owner !== undefined || input.zonas !== undefined;

  // Segunda llamada pidiendo sembrar o crear al dueño, sin `force`: 409 y no
  // 200, porque no se hizo lo que se pidió. Las migraciones sí corrieron —esa
  // parte es idempotente y es el otro trabajo de esta ruta—, y el resumen dice
  // qué había de antes.
  if (yaInicializada && pideDatos && !input.force) {
    await marcar(previo, {});
    return json(
      {
        ok: false,
        error: 'ya_inicializada',
        pasos: {
          ...pasos,
          seed: 'salteado (ya inicializada)',
          zonas: 'salteadas (ya inicializada)',
          duenio: 'salteado (ya inicializada)',
        },
        yaEstaba: {
          seed: previo.seededAt !== null,
          duenio: previo.ownerAt !== null,
          corridas: previo.runs,
        },
        comoForzar: 'repetí la llamada con {"force":true}',
      },
      409,
    );
  }

  let sembrado = false;
  if (input.seed) {
    // Import dinámico y con ruta relativa: `scripts/` está fuera de `src/`, o
    // sea fuera del alias `@`. Dinámico porque arrastra el catálogo de ejemplo
    // entero, y no tiene por qué estar en el bundle de una ruta que casi
    // siempre se llama sin sembrar.
    const { seedCatalog } = await import('../../../../../scripts/seed');
    // `false` fijo: `--reset-stock` pisa el `on_hand` real. Eso no se ofrece
    // por HTTP ni con force.
    await seedCatalog(false);
    sembrado = true;
    pasos.seed = 'sembrado';
  }

  if (input.zonas !== undefined) {
    // Mismo import dinámico y por la misma razón que el seed: `scripts/` vive
    // fuera del alias `@`, y no tiene por qué entrar al bundle de una ruta que
    // casi siempre se llama sin zonas.
    const { upsertShippingZones } = await import('../../../../../scripts/seed');
    const n = await upsertShippingZones(
      input.zonas.map((zona, index) => ({
        slug: zona.slug,
        name: zona.name,
        cities: zona.cities,
        pricePyg: zona.pricePyg,
        freeThresholdPyg: zona.freeThresholdPyg,
        // Sin `position` explícita, el orden del array es el orden de la
        // tabla: es lo que quiso decir quien escribió el curl.
        position: zona.position || index,
      })),
    );
    pasos.zonas = `${n} actualizada(s)`;
  }

  let duenio: 'creado' | 'actualizado' | undefined;
  if (input.owner) {
    duenio = await upsertOwner(input.owner);
    pasos.duenio = duenio;
  }

  await marcar(previo, { sembrado, duenio: duenio !== undefined });

  const usuarios = await contarUsuarios();

  return json({
    ok: true,
    pasos,
    // Cantidades, nunca ids ni emails: el log de Hostinger lo ve cualquiera
    // con acceso al hPanel, y esta respuesta suele terminar pegada ahí.
    usuarios,
    primeraVez: !yaInicializada,
    // El reporte tal cual lo arma el dominio, medido contra el entorno de
    // **este** proceso — que es el punto: hasta ahora había que correr el
    // script desde la máquina de quien deploya, con un .env copiado a mano, o
    // sea contra un entorno *parecido* al de producción. `preflight()` no toca
    // la base ni la red y nunca imprime el valor de un secreto (sólo si está y
    // si tiene el largo mínimo), así que es seguro contestarlo acá.
    preflight: preflight(),
  });
}

/**
 * Crea el dueño o le cambia la contraseña, igual que `pnpm create-owner`.
 *
 * Que la contraseña llegue en el cuerpo de un POST por HTTPS no afloja nada:
 * `create-owner.ts` ya la acepta por `OWNER_PASSWORD`, o sea que el modelo de
 * confianza —quien tiene el secreto del servidor puede fijar la cuenta del
 * dueño— es el que ya había.
 */
async function upsertOwner(owner: NonNullable<Input['owner']>): Promise<'creado' | 'actualizado'> {
  const db = getDb();
  const email = normalizeEmail(owner.email);

  const existing = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];

  if (existing) {
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(owner.password), role: 'owner', isActive: true })
      .where(eq(users.id, existing.id));
    return 'actualizado';
  }

  await createUser({ email, password: owner.password, name: owner.name ?? null, role: 'owner' }, db);
  return 'creado';
}

/** Una sola fila, id 1. `runs` sólo sube. */
async function marcar(
  previo: typeof setupState.$inferSelect | undefined,
  hecho: { sembrado?: boolean; duenio?: boolean },
): Promise<void> {
  const db = getDb();
  const ahora = new Date();

  if (!previo) {
    await db.insert(setupState).values({
      id: 1,
      migratedAt: ahora,
      seededAt: hecho.sembrado ? ahora : null,
      ownerAt: hecho.duenio ? ahora : null,
      runs: 1,
    });
    return;
  }

  await db
    .update(setupState)
    .set({
      migratedAt: ahora,
      seededAt: hecho.sembrado ? ahora : previo.seededAt,
      ownerAt: hecho.duenio ? ahora : previo.ownerAt,
      runs: previo.runs + 1,
    })
    .where(eq(setupState.id, 1));
}

/** Una cantidad, no la lista: la respuesta no lleva emails ni ids. */
async function contarUsuarios(): Promise<number> {
  const rows = await getDb().select({ id: users.id }).from(users);
  return rows.length;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Detrás del proxy de Hostinger el request llega por http: lo que dice si el
 * cliente vino por https es `x-forwarded-proto`.
 */
function isHttps(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded) return forwarded.split(',')[0]?.trim().toLowerCase() === 'https';
  return new URL(request.url).protocol === 'https:';
}

/**
 * `timingSafeEqual` y no `===`: comparar strings corta en el primer byte
 * distinto, y esa diferencia de tiempo alcanza para reconstruir el secreto byte
 * por byte contra un endpoint público.
 *
 * Sólo por header, a diferencia del cron: acá no hay un cron runner limitado
 * del otro lado, hay una persona con un curl, y un `?secret=` deja el secreto
 * escrito en los logs de acceso del servidor.
 */
function presentedSecretMatches(request: Request, secret: string): boolean {
  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (presented === '') return false;

  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(secret, 'utf8');
  // El largo se compara aparte: timingSafeEqual tira si difieren, y ese throw
  // ya filtraría el largo del secreto.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function primerError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'cuerpo inválido';
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
