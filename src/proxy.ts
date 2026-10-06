import { getIronSession } from "iron-session";
import { NextResponse, type NextRequest } from "next/server";

import { analyticsConfig } from "@/lib/analytics";
import { USER_ROLES } from "@/lib/roles";
import { sessionOptions, type AdminSession } from "@/lib/session";

/**
 * Proxy — el ex `middleware.ts`, renombrado en Next 16 (PLAN.md 4.1 y 4.9).
 *
 * Hace dos cosas: pone las cabeceras de seguridad de todo el sitio y cuida la
 * puerta de `/admin/*`.
 *
 * Sobre la puerta: esto es UX, **no** es el control de acceso. Manda al login
 * a quien no tiene cookie para que no vea un error feo. La defensa real está
 * adentro de cada server action (`requireAdminSession()`), porque una server
 * action es un endpoint HTTP con su propio id: se la puede invocar con un
 * `fetch` directo sin navegar nunca a una URL `/admin`, y entonces esto no
 * llega a correr. Si algún día este archivo desaparece, ninguna acción del
 * panel debería volverse ejecutable por un anónimo.
 */

export const config = {
  // Se excluyen los assets estáticos: no necesitan CSP ni sesión, y correr
  // esto en cada .js del bundle es puro costo por request.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};

/**
 * Las rutas cuyo HTML se cachea (ISR) en vez de renderizarse en cada request.
 *
 * **Tiene que coincidir con los `export const revalidate` de `src/app`**, y hay
 * un test que lo verifica (`tests/unit/csp-isr.test.ts`): si alguien cachea una
 * pantalla nueva y se olvida de agregarla acá, esa pantalla se queda sin
 * JavaScript en producción, y no se nota hasta que un cliente no puede comprar.
 */
export const RUTAS_CACHEADAS = ["/", "/categoria"] as const;

/** ¿El HTML de esta ruta sale de la caché de ISR? */
export function esRutaCacheada(pathname: string): boolean {
  return RUTAS_CACHEADAS.some(
    (ruta) => pathname === ruta || (ruta !== "/" && pathname.startsWith(`${ruta}/`)),
  );
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  /*
    El nonce existe sólo para las rutas que se renderizan en cada request.

    Un nonce es un permiso de un solo uso: vale para el HTML de ese render y
    para ninguno más. Una página de ISR, en cambio, se renderiza una vez y su
    HTML —con el nonce ya escrito adentro— se sirve durante los 5 minutos
    siguientes, mientras acá se le pone a cada respuesta un nonce nuevo. Desde
    la segunda visita los dos no coinciden y el navegador bloquea **todos** los
    scripts de esa pantalla: la home y las categorías se veían enteras y
    muertas, sin carrito, sin buscador y sin lo que llega por streaming.

    Por eso a las rutas cacheadas no se les manda `x-nonce`: Next escribe sus
    <script> sin el atributo y el HTML cacheado sigue siendo válido dentro de un
    mes. Su CSP se arma sin nonce, abajo.
  */
  const cacheada = esRutaCacheada(request.nextUrl.pathname);

  // `btoa`, no `Buffer`: esto corre en el runtime edge, donde las APIs de
  // Node no existen.
  const nonce = cacheada ? null : btoa(crypto.randomUUID());

  // El nonce viaja en un header de request para que Next se lo ponga a sus
  // propios <script> al renderizar; sin eso, un CSP sin 'unsafe-inline' deja
  // la página sin hidratar.
  const requestHeaders = new Headers(request.headers);
  // El id del request (O8). Se **respeta** el que venga de afuera: si mañana
  // hay un proxy o un balanceador adelante, sus logs y los nuestros tienen que
  // poder cruzarse por el mismo id. Sólo se genera uno cuando no vino ninguno.
  //
  // Va en las tres partes: en los headers del request (para que el servidor lo
  // lea), en la respuesta (para que quien reporta un problema pueda pegarlo) y
  // —eso lo hace `instrumentation.ts`— en cada línea de log.
  const reqId = idDeRequest(request.headers.get(REQUEST_ID_HEADER));
  requestHeaders.set(REQUEST_ID_HEADER, reqId);

  if (nonce) requestHeaders.set("x-nonce", nonce);
  // Que no se cuele uno de afuera: `x-nonce` lo pone este proxy y nadie más.
  else requestHeaders.delete("x-nonce");

  const isAdmin = request.nextUrl.pathname.startsWith("/admin");
  const isLogin = request.nextUrl.pathname === "/admin/login";

  if (isAdmin && !isLogin) {
    const session = await getIronSession<AdminSession>(request, NextResponse.next(), sessionOptions());
    // Contra la lista del ENUM y no contra literales sueltos: un rol nuevo
    // agregado a `USER_ROLES` y olvidado acá quedaría rebotando al login para
    // siempre, con la cookie válida y sin ningún error que lo explique.
    const authenticated = Boolean(
      session.userId && session.role && USER_ROLES.includes(session.role),
    );

    if (!authenticated) {
      const login = new URL("/admin/login", request.url);
      // Sólo el path: `next` se vuelve a validar en la acción de login antes
      // de usarse como destino (ver safeNextPath).
      login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
      return withSecurityHeaders(NextResponse.redirect(login), nonce, false, reqId);
    }
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  return withSecurityHeaders(response, nonce, isAdmin, reqId);
}

/** El header estándar de facto. Un solo lugar, para que no se escriba mal. */
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Acepta el id que vino, o genera uno.
 *
 * Se valida el de afuera antes de repetirlo: es un valor que llega de
 * internet y termina en un header de respuesta y en cada línea de log. Sin
 * este filtro, un `x-request-id` con saltos de línea inyecta líneas falsas en
 * el log del comercio, y con mil caracteres lo llena de basura.
 */
export function idDeRequest(recibido: string | null): string {
  const limpio = (recibido ?? "").trim();
  if (/^[A-Za-z0-9_-]{8,64}$/.test(limpio)) return limpio;
  return crypto.randomUUID();
}

/**
 * CSP + el resto de las cabeceras (PLAN.md 4.9).
 *
 * Las que no dependen del nonce viven en `next.config.ts`; el CSP tiene que
 * armarse acá porque el nonce cambia en cada request.
 */
function withSecurityHeaders(
  response: NextResponse,
  nonce: string | null,
  isAdmin = false,
  reqId?: string,
): NextResponse {
  // El id viaja también de vuelta: es lo que hace que "me dio error" de una
  // compradora se pueda cruzar contra una línea concreta del log.
  if (reqId) response.headers.set(REQUEST_ID_HEADER, reqId);
  const dev = process.env.NODE_ENV !== "production";

  // Los medidores (src/lib/analytics.ts) son los únicos terceros que el
  // navegador puede tocar, y sólo si esta tienda los configuró: sin las
  // variables, el CSP queda tan cerrado como siempre. Los hosts de script-src
  // son para navegadores sin 'strict-dynamic'; en los modernos, la confianza
  // la da el nonce del loader.
  const { ga4Id, metaPixelId } = analyticsConfig();
  const scriptHosts = [
    ...(ga4Id ? [" https://www.googletagmanager.com"] : []),
    ...(metaPixelId ? [" https://connect.facebook.net"] : []),
  ].join("");
  const imgHosts = [
    // GA4 cae a un pixel <img> cuando sendBeacon no puede.
    ...(ga4Id ? [" https://www.googletagmanager.com https://www.google-analytics.com"] : []),
    ...(metaPixelId ? [" https://www.facebook.com"] : []),
  ].join("");
  const connectHosts = [
    ...(ga4Id
      ? [" https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com"]
      : []),
    ...(metaPixelId ? [" https://www.facebook.com https://connect.facebook.net"] : []),
  ].join("");

  const csp = [
    "default-src 'self'",
    /*
      Con nonce —todo lo que se renderiza por request: panel, checkout, cuenta,
      pedido, buscador, ficha de producto— 'strict-dynamic' hace que los
      scripts que carga un script con nonce hereden la confianza, que es lo que
      necesita el chunking de Next.

      Sin nonce —la home y las categorías, que se cachean— hay que permitir el
      inline: los <script> con los datos del render que Next mete en el HTML no
      tienen un hash estable entre builds con el que firmarlos. 'strict-dynamic'
      no va en ese caso: anularía el 'unsafe-inline' que necesitamos.

      Es un CSP más flojo y por eso vale sólo en esas dos pantallas, que no
      tienen sesión, ni plata, ni datos de nadie: catálogo público y nada más.
      Todo lo que sí los tiene sigue con el nonce. El agujero que este permiso
      abriría —texto del catálogo inyectado en el JSON-LD— se tapa aparte, en
      `jsonLdScript()` (src/lib/seo.ts).

      En dev, Fast Refresh evalúa código en runtime y exige 'unsafe-eval'.

      Queda un agujero conocido y **de Next**, no de acá: en las rutas con
      nonce, Next 16.3 emite el chunk de `next/image` sin el atributo `nonce`,
      y con 'strict-dynamic' el navegador lo bloquea. Medido en un build de
      producción: una violación por pantalla, siempre ese chunk. Las fotos
      cargan igual —el `<img>` viene renderizado del servidor— y nada más se
      rompe, así que no se aflojó el CSP por eso: aflojarlo costaría el
      'strict-dynamic' de checkout y del panel, que es donde está la plata. Si
      un día aparecen violaciones nuevas en estas rutas, no es esto: miralas.
    */
    (nonce
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${dev ? "'unsafe-eval'" : ""}`
      : `script-src 'self' 'unsafe-inline' ${dev ? "'unsafe-eval'" : ""}`
    ).trim() + scriptHosts,
    // Tailwind y next/font inyectan <style> sin nonce. Un CSS inline no
    // ejecuta código; el riesgo real es la exfiltración por selectores, muy
    // por debajo de romper el estilo del sitio entero.
    "style-src 'self' 'unsafe-inline'",
    // Cloudinary sirve las fotos de producto; data: es para los blur
    // placeholders que guardamos en product_images.
    `img-src 'self' data: blob: https://res.cloudinary.com${imgHosts}`,
    "font-src 'self' data:",
    // El navegador sólo habla con este origen (más los medidores de arriba,
    // si están). Cloudinary se llama desde el servidor, nunca desde el
    // cliente.
    `connect-src 'self'${dev ? " ws: http://localhost:*" : ""}${connectHosts}`,
    "form-action 'self'",
    // Redundante con X-Frame-Options, pero es el que respetan los navegadores
    // modernos y además cubre los iframes anidados.
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  response.headers.set("Content-Security-Policy", csp);
  if (nonce) response.headers.set("x-nonce", nonce);

  // El panel nunca se cachea ni se indexa: sus páginas tienen datos de
  // clientes y montos, y un proxy intermedio no tiene por qué guardarlos.
  if (isAdmin) {
    response.headers.set("Cache-Control", "no-store, must-revalidate");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }

  return response;
}
