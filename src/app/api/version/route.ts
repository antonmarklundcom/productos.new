import { cronJson, requireCronSecret } from "@/lib/cron-auth";

/**
 * `/api/version` — qué build está corriendo ahora mismo (plan-operacion §5.4 B).
 *
 * Existe por una pregunta muy concreta del día del deploy: **"¿tomó el
 * redeploy?"**. Hostinger sirve desde un directorio que se reconstruye, y la
 * forma de averiguarlo hasta ahora era mirar si un cambio visible aparecía —
 * que no sirve cuando el cambio no es visible, que es la mitad de las veces.
 *
 * **Con secreto**, el mismo `CRON_SECRET` de los crons. El SHA del build y la
 * versión de Node son información de reconocimiento: le dicen a cualquiera qué
 * commit exacto está corriendo, y con el repo público eso es la lista de
 * vulnerabilidades conocidas de esta instalación. `/api/health` sigue siendo
 * el endpoint abierto y sigue sin decir ni una versión — no se toca.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const auth = requireCronSecret(request);
  if (!auth.ok) return auth.response;

  return cronJson({
    // Los tres los fija `next.config.ts` en build; sin git disponible quedan
    // en "desconocido", que es honesto y mejor que un valor inventado.
    sha: process.env.BUILD_SHA ?? "desconocido",
    builtAt: process.env.BUILD_AT ?? "desconocido",
    node: process.version,
  });
}
