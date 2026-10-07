import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { RUTAS_CACHEADAS } from "../../src/proxy";
import { safeNextPath } from "../../src/lib/safe-redirect";
import { listSourceFiles, readCode } from "../helpers/source";

/**
 * Revisión de seguridad del PR #4 (PLAN.md 4.9), automatizada.
 *
 * Un checklist que se corrió una vez a mano es un checklist que se rompe en el
 * commit siguiente. Cada punto de la revisión que se puede verificar leyendo
 * el repo vive acá y corre en CI.
 */

const SOURCE_ROOTS = ["src", "scripts", "tests"];
const SELF = path.join("tests", "unit", "security-review.test.ts");

describe("secretos", () => {
  it("ninguna variable de servidor lleva el prefijo NEXT_PUBLIC_", async () => {
    // `NEXT_PUBLIC_*` termina literalmente en el bundle JS del navegador. Lo
    // público son las URLs del sitio y del CDN de fotos, nunca claves de subida.
    const ALLOWED = new Set(["NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_IMAGENES_URL"]);
    const offenders: string[] = [];

    for (const file of await listSourceFiles(SOURCE_ROOTS)) {
      if (file === SELF) continue;
      const code = await readCode(file);
      for (const [, name] of code.matchAll(
        /process\.env\.(NEXT_PUBLIC_\w+)/g
      )) {
        if (name && !ALLOWED.has(name)) offenders.push(`${file}: ${name}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("no hay secretos con valor real commiteados", async () => {
    // Formas concretas, no entropía: buscar "cualquier string largo" da
    // falsos positivos con cada hash de test y termina desactivado.
    const PATTERNS: Array<{ name: string; pattern: RegExp }> = [
      {
        name: "clave privada PEM",
        pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
      },
      { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
      { name: "token de GitHub", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
      {
        name: "api_secret de Cloudinary en una URL",
        pattern: /cloudinary:\/\/\d+:[A-Za-z0-9_-]+@/,
      },
      {
        name: "password en una URL de MySQL apuntando afuera de localhost",
        pattern: /mysql:\/\/[^:\s]+:[^@\s]+@(?!localhost|127\.0\.0\.1)/,
      },
    ];

    const offenders: string[] = [];
    for (const file of await listSourceFiles(SOURCE_ROOTS)) {
      if (file === SELF) continue;
      const content = await readFile(path.join(process.cwd(), file), "utf8");
      for (const { name, pattern } of PATTERNS) {
        if (pattern.test(content)) offenders.push(`${file}: ${name}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it(".env.example no trae valores reales y .env.local está ignorado", async () => {
    // `.env.example` trae sólo las imprescindibles; el resto está documentado en
    // docs/ENV-OPCIONAL.md con el mismo formato. Ninguno de los dos puede
    // traer un secreto con valor real.
    const example =
      (await readFile(path.join(process.cwd(), ".env.example"), "utf8")) +
      "\n" +
      (await readFile(
        path.join(process.cwd(), "docs/ENV-OPCIONAL.md"),
        "utf8"
      ));

    // Los secretos del ejemplo tienen que ser placeholders evidentes.
    const filled = [
      ...example.matchAll(
        /^(CLOUDINARY_API_SECRET|PAGOPAR_PRIVATE_KEY|WHATSAPP_CLOUD_ACCESS_TOKEN|CUSTOMER_SESSION_SECRET|CRON_SECRET|SESSION_SECRET|SETUP_SECRET)="?([^"\n]*)"?$/gm
      ),
    ]
      .filter(([, , value]) => {
        const text = (value ?? "").trim();
        if (text === "") return false;
        return !/changeme|generate|^$/i.test(text);
      })
      .map(([, key]) => key);

    expect(filled).toEqual([]);

    // `.env.example` es lo único que se commitea; el resto queda afuera.
    const gitignore = await readFile(
      path.join(process.cwd(), ".gitignore"),
      "utf8"
    );
    expect(gitignore).toMatch(/^\.env\.(\*|local)$/m);
    expect(gitignore).toMatch(/^!\.env\.example$/m);
  });
});

describe("cabeceras de seguridad", () => {
  it("next.config declara HSTS, X-Frame-Options y nosniff", async () => {
    const config = await readCode("next.config.ts");

    expect(config).toContain("Strict-Transport-Security");
    expect(config).toContain("X-Frame-Options");
    expect(config).toContain("X-Content-Type-Options");
    expect(config).toContain("Referrer-Policy");
    expect(config).toContain("Permissions-Policy");
    // La versión de Next en un header es información gratis para el que busca
    // un CVE.
    expect(config).toMatch(/poweredByHeader:\s*false/);
  });

  it("el proxy arma el CSP con las directivas duras", async () => {
    const proxy = await readCode(path.join("src", "proxy.ts"));

    expect(proxy).toContain("Content-Security-Policy");
    expect(proxy).toContain("default-src 'self'");
    expect(proxy).toContain("frame-ancestors 'none'");
    expect(proxy).toContain("object-src 'none'");
    expect(proxy).toContain("base-uri 'self'");
  });

  it("la rama con nonce nunca permite inline", async () => {
    const proxy = await readCode(path.join("src", "proxy.ts"));

    // Hay dos script-src: el de las rutas que se renderizan por request (con
    // nonce) y el de las cacheadas (sin). Éste es el primero, y es el que cubre
    // todo lo que tiene sesión, plata o datos de alguien.
    const conNonce = /script-src 'self' 'nonce-[^`]*/.exec(proxy)?.[0] ?? "";

    expect(conNonce).toContain("nonce-");
    expect(conNonce).toContain("'strict-dynamic'");
    expect(conNonce).not.toContain("'unsafe-inline'");
  });

  it("la rama sin nonce sólo cubre catálogo público, y sin 'strict-dynamic'", async () => {
    const proxy = await readCode(path.join("src", "proxy.ts"));

    /*
      Las páginas cacheadas no pueden llevar nonce —el HTML se sirve muchas
      veces y el nonce vale para un render— así que su CSP permite inline. Es
      el punto más flojo de todo el archivo y por eso se fija acá:

      1. 'strict-dynamic' no puede aparecer en esa rama: anularía el
         'unsafe-inline' y volvería a dejar la home sin JavaScript.
      2. La lista de rutas cacheadas no puede crecer hacia nada que tenga
         sesión, plata o datos de una persona. Si alguien quiere cachear
         /checkout o /cuenta, este test lo frena.
    */
    const sinNonce =
      /script-src 'self' 'unsafe-inline'[^`]*/.exec(proxy)?.[0] ?? "";

    expect(sinNonce).toContain("'unsafe-inline'");
    expect(sinNonce).not.toContain("'strict-dynamic'");

    for (const privada of [
      "/admin",
      "/checkout",
      "/cuenta",
      "/pedido",
      "/api",
    ]) {
      expect(
        RUTAS_CACHEADAS,
        `${privada} no puede servirse cacheada`
      ).not.toContain(privada);
    }
  });

  it("el panel se sirve con no-store y noindex", async () => {
    const proxy = await readCode(path.join("src", "proxy.ts"));
    expect(proxy).toMatch(/Cache-Control["']?,\s*["']no-store/);
    expect(proxy).toMatch(/X-Robots-Tag["']?,\s*["']noindex/);
  });
});

describe("redirect abierto en el login", () => {
  it("sólo acepta rutas internas de /admin", () => {
    expect(safeNextPath("/admin/pedidos")).toBe("/admin/pedidos");
    expect(safeNextPath("/admin/pedidos?estado=pagado")).toBe(
      "/admin/pedidos?estado=pagado"
    );
    expect(safeNextPath("/admin")).toBe("/admin");
  });

  it("descarta todo lo que salga del sitio", () => {
    for (const evil of [
      "https://sitio-falso.py/admin",
      "//sitio-falso.py",
      "/\\sitio-falso.py",
      "/adminfalso",
      "/pedido/PY-000123",
      "javascript:alert(1)",
      "",
      undefined,
      null,
    ]) {
      expect(safeNextPath(evil)).toBe("/admin");
    }
  });
});

describe("rate limiting", () => {
  it("el login, la búsqueda de pedidos y el cron tienen límite", async () => {
    const login = await readCode(
      path.join("src", "app", "actions", "admin-auth.ts")
    );
    const lookup = await readCode(
      path.join("src", "app", "actions", "order-lookup.ts")
    );
    // El límite del cron vive en la puerta compartida desde O6, no en cada
    // ruta: ahí es donde tiene que estar, porque es la que corren las tres.
    const cron = await readCode(path.join("src", "lib", "cron-auth.ts"));

    for (const [name, code] of Object.entries({ login, lookup, cron })) {
      expect(code, `${name} debería llamar a rateLimit()`).toMatch(
        /rateLimit\s*\(/
      );
    }

    // El login se limita por IP **y** por email: el atacante rota una u otra
    // por separado.
    expect(login).toMatch(/login:ip:/);
    expect(login).toMatch(/login:email:/);
  });
});

describe("logs", () => {
  it("ningún log imprime el secreto del cron, el token del pedido ni una contraseña", async () => {
    const offenders: string[] = [];

    for (const file of await listSourceFiles(["src"])) {
      if (file === SELF) continue;
      const code = await readCode(file);

      for (const [line] of code.matchAll(
        /console\.(log|info|warn|error)\([^\n]*/g
      )) {
        // Lo que importa es el **valor**, no la palabra: decir "CRON_SECRET no
        // está configurado" es un mensaje de diagnóstico legítimo, imprimir
        // `process.env.CRON_SECRET` o interpolar la variable no lo es.
        if (/process\.env\.\w*(SECRET|PRIVATE_KEY|API_KEY)/.test(line)) {
          offenders.push(`${file}: ${line.trim()}`);
        }
        if (
          /\$\{[^}]*\b(secret|password|passwordHash|accessToken|token)\b[^}]*\}/i.test(
            line
          )
        ) {
          offenders.push(`${file}: ${line.trim()}`);
        }
        // `console.error("...", password)` — el secreto como argumento suelto.
        if (
          /console\.\w+\([^)]*,\s*\w*(password|accessToken|secret)\w*\s*[),]/i.test(
            line
          )
        ) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('el cron responde sin distinguir "falta el header" de "el secreto está mal"', async () => {
    // La puerta vive en `src/lib/cron-auth.ts` desde O6: la compartían las dos
    // rutas de cron y `/api/version`, y una copia por ruta a la que le falte
    // una de las cuatro decisiones convierte al endpoint nuevo en el más
    // débil. Este control mira el archivo compartido; el de más abajo verifica
    // que **todas** las rutas efectivamente lo usen.
    const auth = await readCode(path.join("src", "lib", "cron-auth.ts"));

    // Un solo 401 genérico, y comparación en tiempo constante.
    expect(auth).toContain("timingSafeEqual");
    const unauthorized = [...auth.matchAll(/["']unauthorized["']/g)];
    expect(unauthorized.length).toBe(1);
    // Y el 503 sin secreto configurado: una ruta "abierta hasta que la
    // configuren" es una ruta abierta.
    expect(auth).toContain("'not_configured'");
  });

  it("ninguna ruta de cron se arma su propia puerta", async () => {
    // El riesgo real de haber extraído la puerta: que alguien agregue la
    // cuarta ruta de cron copiando y pegando media verificación.
    const CRON = path.join("src", "app", "api", "cron");
    const routes = (await listSourceFiles([CRON])).filter((file) =>
      file.endsWith("route.ts")
    );
    expect(routes.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of routes) {
      const code = await readCode(file);
      if (!/requireCronSecret\s*\(/.test(code))
        offenders.push(`${file}: no usa requireCronSecret`);
      // Comparar el secreto a mano adentro de una ruta es exactamente lo que
      // la extracción vino a evitar.
      if (/timingSafeEqual|process\.env\.CRON_SECRET/.test(code)) {
        offenders.push(`${file}: se arma su propia verificación`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("acceso del comprador", () => {
  it("el token del pedido se compara en tiempo constante", async () => {
    const access = await readCode(
      path.join("src", "domain", "order-access.ts")
    );
    expect(access).toContain("timingSafeEqual");
    // Nada de `===` sobre el token: filtra cuántos caracteres se acertaron.
    expect(access).not.toMatch(/accessToken\s*===/);
  });
});

// ---------------------------------------------------------------------------
// Ronda 2 — las rutas y acciones que se agregaron después de la revisión del
// PR #4: el webhook de Pagopar, la página de retorno, el simulador y sus
// candados.
// ---------------------------------------------------------------------------

describe("cobertura de la revisión", () => {
  it("toda server action nueva empieza por un guard", async () => {
    // La lista no se escribe a mano: se descubre el directorio. Una acción
    // nueva entra sola en el control, que es la única forma de que la revisión
    // no se quede vieja.
    const ACTIONS = path.join("src", "app", "actions");
    const files = (await listSourceFiles([ACTIONS])).filter((file) =>
      file.endsWith(".ts")
    );
    expect(files.length).toBeGreaterThan(0);

    // Cada acción exportada tiene que llamar a *algún* guard: el de admin, el
    // del comprador (token del pedido) o el rate limit. Las de carrito son
    // stateless y no tocan nada del servidor.
    const GUARDS =
      /requireAdminSession|requireStaffSession|requireOwnerSession|requireCustomerSession|requireOrderAccess|rateLimit\s*\(|cuentasClientesHabilitadas\s*\(/;
    // `wishlist.ts` es igual de stateless que `cart.ts`: sólo lee catálogo
    // publicado a partir de slugs (los mismos que ya se ven en cualquier
    // ficha de producto), no escribe nada ni expone datos de un comprador.
    const SIN_ESTADO = new Set([
      path.join(ACTIONS, "cart.ts"),
      path.join(ACTIONS, "wishlist.ts"),
    ]);

    const offenders: string[] = [];
    for (const file of files) {
      if (SIN_ESTADO.has(file)) continue;
      const code = await readCode(file);
      if (!GUARDS.test(code)) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });

  it("toda ruta de API verifica algo antes de tocar la base", async () => {
    const API = path.join("src", "app", "api");
    const routes = (await listSourceFiles([API])).filter((file) =>
      file.endsWith("route.ts")
    );
    expect(routes.length).toBeGreaterThan(0);

    // La única excepción, y con nombre y apellido: el health check tiene que
    // poder llamarlo el monitoreo sin credenciales. Se la banca porque no toca
    // ningún dato —un `SELECT 1`— y contesta dos booleanos: ni versiones, ni
    // schema, ni el error de MySQL. Cualquier ruta nueva que quiera entrar acá
    // tiene que poder decir lo mismo.
    const SIN_GUARD = new Set([path.join(API, "health", "route.ts")]);
    const previewImage = path.join(API, "preview-image", "[name]", "route.ts");

    const offenders: string[] = [];
    for (const file of routes) {
      if (SIN_GUARD.has(file)) continue;
      const code = await readCode(file);
      if (file === previewImage) {
        // Local-only static artwork: no DB or merchant data. The dedicated
        // local-preview suite proves its loopback gate, allowlist and 404.
        expect(code).toContain("!isLocalCatalogPreview()");
        expect(code).toContain("!ALLOWED.has(name)");
        expect(code).not.toMatch(/getDb|getPool|require\s*\(|process\.env/);
        continue;
      }
      // Firma, secreto o sesión: alguna de las cuatro. Una ruta pública que
      // mueve pedidos y no compara nada es exactamente lo que se busca.
      // `requireCronSecret` es la puerta compartida de los crons (O6): hace
      // las mismas comparaciones, en un solo archivo.
      if (
        !/timingSafeEqual|requireCronSecret|requireAdmin|requireOwnerSession|tokensMatch/.test(
          code
        )
      ) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("webhook de Pagopar", () => {
  it("la firma se verifica antes de tocar la base", async () => {
    const route = await readCode(
      path.join("src", "app", "api", "webhooks", "pagopar", "route.ts")
    );

    const guard = route.indexOf("guardMatches(request");
    const process = route.indexOf("processPagoparWebhook(");
    expect(guard).toBeGreaterThan(-1);
    expect(process).toBeGreaterThan(-1);
    // Nada de trabajo antes de la firma: lo único que la precede es el parseo
    // del cuerpo y el rate limit.
    expect(guard).toBeLessThan(process);
  });

  it("sin clave privada la ruta se cierra en vez de aceptar cualquier cosa", async () => {
    const route = await readCode(
      path.join("src", "app", "api", "webhooks", "pagopar", "route.ts")
    );
    expect(route).toMatch(/not_configured/);
    expect(route).toMatch(/503/);
  });

  it("la respuesta del webhook no cachea", async () => {
    const route = await readCode(
      path.join("src", "app", "api", "webhooks", "pagopar", "route.ts")
    );
    expect(route).toMatch(/no-store/);
  });
});

describe("candado del simulador de Pagopar", () => {
  /*
   * El candado completo —comportamiento y guardarraíles de código— vive en
   * `tests/unit/pagopar-mock-mode.test.ts`. Acá quedan los dos puntos que la
   * revisión de seguridad mira por su cuenta, porque son sobre una **ruta**:
   * que `/dev/pagopar` esté cerrada por los dos lados y que no la indexe nadie.
   */

  it("la ruta /dev/pagopar se cierra por partida doble y no se indexa", async () => {
    const page = await readCode(
      path.join("src", "app", "dev", "pagopar", "[hash]", "page.tsx")
    );

    // 1. Render: fuera del modo mock la ruta no existe.
    expect(page).toMatch(/if\s*\(!isPagoparMockMode\(\)\)\s*notFound\(\)/);
    // 2. Server action: es un endpoint POST propio con su propio id, y el
    //    render no la cubre. Un `fetch` directo la alcanza sin pasar por la
    //    página.
    expect(page).toContain("assertMockAllowed(");
    // Y ni Google ni un scraper la levantan.
    expect(page).toMatch(/index:\s*false/);
  });

  it("el simulador está apagado con NODE_ENV=production, pase lo que pase", async () => {
    // Verificación de comportamiento, no un grep: es la afirmación que la
    // revisión necesita poder hacer sobre el servidor real.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAGOPAR_MODE", "mock");

    const { assertMockAllowed, isPagoparMockMode } =
      await import("../../src/domain/pagopar/mode");

    expect(isPagoparMockMode()).toBe(false);
    expect(() => assertMockAllowed("revisión")).toThrow();

    vi.unstubAllEnvs();
  });
});

describe("preflight", () => {
  it("está declarado como script de package.json", async () => {
    const pkg = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8")
    ) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.preflight).toBe("tsx scripts/preflight.ts");
  });

  it("no imprime el valor de ningún secreto", async () => {
    for (const file of [
      path.join("src", "domain", "preflight.ts"),
      path.join("scripts", "preflight.ts"),
    ]) {
      const code = await readCode(file);
      // Se puede decir "CRON_SECRET está vacío"; no se puede interpolar el
      // valor. `secret.length` sí, que es justamente lo que hace falta.
      expect(code).not.toMatch(/\$\{\s*secret\s*\}/);
      expect(code).not.toMatch(/\$\{\s*value\([^)]*\)\s*\}/);
    }
  });
});
