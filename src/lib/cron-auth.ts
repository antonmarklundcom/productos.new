import { timingSafeEqual } from 'node:crypto';

import { CRON_LIMIT, CRON_WINDOW_MS, clientIp, rateLimit } from '@/lib/rate-limit';

/**
 * La puerta de las rutas de cron, en un solo lugar (plan-operacion §5.2 A).
 *
 * Nació adentro de `/api/cron/vencer-pedidos` y se extrajo cuando aparecieron
 * la segunda ruta de cron (el resumen diario, O6), la tercera (el backup, O8)
 * y `/api/version`. El motivo de extraerla no es ahorrar líneas: es que las
 * cuatro decisiones de abajo son de seguridad, y una copia de este archivo que
 * se olvide de una sola —el rate limit, digamos— convierte al endpoint nuevo
 * en el más débil de los cuatro, que es exactamente el que van a martillar.
 *
 * Las cuatro, con su porqué:
 *
 * 1. **Sin secreto configurado, 503 y nada más.** Lo contrario —dejarla
 *    abierta "hasta que se configure"— es un endpoint que cualquiera puede
 *    llamar para vencer pedidos ajenos. Menos de 16 caracteres cuenta como
 *    no configurado: un secreto corto es adivinable.
 * 2. **Rate limit por IP antes de comparar.** La comparación es en tiempo
 *    constante, pero eso no impide probar secretos de a millones.
 * 3. **`timingSafeEqual`, con el largo comparado aparte.** Un `===` corta en
 *    el primer byte distinto y esa diferencia de tiempo alcanza para
 *    reconstruir el secreto contra un endpoint público. `timingSafeEqual`
 *    tira si los largos difieren, y ese throw ya filtraría el largo.
 * 4. **`Bearer` o `?secret=`.** Algunos cron de Hostinger no dejan mandar
 *    headers. El `?secret=` está discutido y aceptado a propósito
 *    (`fable/plan.md` §1.7): sin él, la mitad de las tiendas no puede
 *    configurar el cron.
 *
 * El error nunca distingue "falta el header" de "el secreto está mal": esa
 * diferencia es información gratis. Y no se loguea nada de lo que llegó — el
 * log del comercio no es lugar para secretos ajenos.
 */

/** Menos que esto no es un secreto, es una contraseña de prueba. */
export const CRON_SECRET_MIN_LENGTH = 16;

export type CronAuthResult =
  | { ok: true }
  /** Ya viene con el cuerpo y el status listos para devolver. */
  | { ok: false; response: Response };

/**
 * Verifica el secreto de una ruta de cron.
 *
 * `envVar` para que cada ruta diga de qué variable sale su secreto; hoy las
 * tres usan `CRON_SECRET` y ése es el default.
 */
export function requireCronSecret(
  request: Request,
  options: { envVar?: string } = {},
): CronAuthResult {
  const envVar = options.envVar ?? 'CRON_SECRET';
  const secret = process.env[envVar];

  if (!secret || secret.length < CRON_SECRET_MIN_LENGTH) {
    console.error(`${envVar} no está configurado (o es demasiado corto)`);
    return { ok: false, response: cronJson({ error: 'not_configured' }, 503) };
  }

  const ip = clientIp(request.headers);
  if (!rateLimit(`cron:${ip}`, { limit: CRON_LIMIT, windowMs: CRON_WINDOW_MS }).ok) {
    return { ok: false, response: cronJson({ error: 'rate_limited' }, 429) };
  }

  if (!presentedSecretMatches(request, secret)) {
    console.warn('cron: intento rechazado');
    return { ok: false, response: cronJson({ error: 'unauthorized' }, 401) };
  }

  return { ok: true };
}

/** Acepta `Authorization: Bearer <secreto>` o `?secret=`. Ver el punto 4 de arriba. */
function presentedSecretMatches(request: Request, secret: string): boolean {
  const header = request.headers.get('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const fromQuery = new URL(request.url).searchParams.get('secret') ?? '';

  const presented = bearer || fromQuery;
  if (presented === '') return false;

  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(secret, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * La respuesta JSON de una ruta de cron. `no-store` siempre: lo que devuelve
 * es el resultado de esta corrida, no algo que un proxy pueda repetir.
 */
export function cronJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
