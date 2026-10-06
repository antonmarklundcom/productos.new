import { describe, expect, it, vi } from "vitest";

import { MARCA_PLACEHOLDER, TIENDA } from "@/config/tienda";

import {
  preflight,
  WHATSAPP_DE_EJEMPLO,
  type PreflightEnv,
  type PreflightSeverity,
} from "../../src/domain/preflight";

/**
 * `pnpm preflight` (TASKS.md §30).
 *
 * El control tiene que servir para dos cosas opuestas: dar el visto bueno
 * cuando todo está, y frenar el deploy cuando falta algo. Los dos lados se
 * prueban acá, uno por control.
 *
 * Dos controles dependen del estado del repo y no del entorno, así que sus
 * expectativas se calculan en vez de escribirse: `marca` bloquea en el
 * template (donde `TIENDA.nombre` sigue siendo el placeholder) y pasa en una
 * tienda renombrada, y `pagopar_webhook_envelope` bloquea mientras
 * `WEBHOOK_ENVELOPE_CONFIRMED` siga en `false` (TASKS.md §21) **y** haya
 * credenciales de Pagopar cargadas. Este archivo tiene que quedar verde en el
 * template y en cada tienda salida de él.
 */

/** Un entorno completo y sano, salvo por lo que cada test rompa. */
function envSano(overrides: PreflightEnv = {}): PreflightEnv {
  return {
    NODE_ENV: "production",
    // Sin contraseña adentro: el escáner de secretos de
    // `security-review.test.ts` marca cualquier DSN con credenciales que no
    // apunte a localhost, y tiene razón — hasta en un fixture.
    DATABASE_URL: "mysql://tienda@db.hostinger.py:3306/tienda",
    SESSION_SECRET: "u".repeat(43),
    CRON_SECRET: "c".repeat(32),
    BANCO_NOMBRE: "Banco Itaú",
    BANCO_TITULAR: "Comercial San Roque S.A.",
    BANCO_RUC: "80012345-6",
    BANCO_CUENTA: "123456789",
    BANCO_TIPO_CUENTA: "Cuenta corriente",
    CLOUDINARY_CLOUD_NAME: "tienda-py",
    CLOUDINARY_API_KEY: "123456789012345",
    CLOUDINARY_API_SECRET: "una-clave-de-cloudinary",
    WHATSAPP_NUMBER: "+595971000111",
    NEXT_PUBLIC_SITE_URL: "https://tienda.com.py",
    PAGOPAR_PUBLIC_KEY: "publica",
    PAGOPAR_PRIVATE_KEY: "privada",
    PAGOPAR_BASE_URL: "https://api.pagopar.com",
    PAGOPAR_MODE: "",
    ...overrides,
  };
}

function severityOf(env: PreflightEnv, id: string): PreflightSeverity {
  const check = preflight(env).checks.find((item) => item.id === id);
  if (!check) throw new Error(`no existe el control "${id}"`);
  return check.severity;
}

describe("preflight", () => {
  it("con todo configurado, sólo bloquean los pendientes del estado del repo", () => {
    const report = preflight(envSano());

    const bloquean = report.checks
      .filter((check) => check.severity === "bloquea")
      .map((check) => check.id);

    // El sobre del webhook es el pendiente real de TASKS.md §21 (envSano trae
    // credenciales de Pagopar, así que bloquea); `marca` bloquea sólo mientras
    // el repo sea el template sin renombrar. Cuando se confirme el sobre, la
    // lista pierde ese id.
    const esperado = [
      ...(TIENDA.nombre === MARCA_PLACEHOLDER ? ["marca"] : []),
      "pagopar_webhook_envelope",
    ];
    expect(bloquean).toEqual(esperado);
    expect(report.ok).toBe(false);
  });

  it("cada variable que falta bloquea por separado", () => {
    const casos: Array<[string, PreflightEnv]> = [
      ["cron_secret", { CRON_SECRET: "" }],
      ["session_secret", { SESSION_SECRET: "" }],
      ["cloudinary", { CLOUDINARY_API_SECRET: "" }],
      ["whatsapp", { WHATSAPP_NUMBER: "" }],
      ["database_url", { DATABASE_URL: "" }],
      ["site_url", { NEXT_PUBLIC_SITE_URL: "" }],
    ];

    for (const [id, override] of casos) {
      expect(severityOf(envSano(override), id), id).toBe("bloquea");
      expect(severityOf(envSano(), id), `${id} sano`).toBe("ok");
    }
  });

  it("un secreto demasiado corto bloquea igual que uno vacío", () => {
    // El largo mínimo no es cosmético: iron-session revienta en runtime con
    // menos de 32, y la ruta del cron se niega a correr con menos de 16.
    expect(severityOf(envSano({ SESSION_SECRET: "corto" }), "session_secret")).toBe("bloquea");
    expect(severityOf(envSano({ CRON_SECRET: "quince-chars--" }), "cron_secret")).toBe("bloquea");
  });

  it("el placeholder de .env.example cuenta como no configurado", () => {
    expect(
      severityOf(
        envSano({ SESSION_SECRET: "changeme-generate-with-openssl-rand-base64-32" }),
        "session_secret",
      ),
    ).toBe("bloquea");
    expect(severityOf(envSano({ CLOUDINARY_CLOUD_NAME: "changeme" }), "cloudinary")).toBe("bloquea");
  });

  it("el WhatsApp de ejemplo del template bloquea aunque tenga forma válida", () => {
    expect(severityOf(envSano({ WHATSAPP_NUMBER: WHATSAPP_DE_EJEMPLO }), "whatsapp")).toBe(
      "bloquea",
    );
    expect(severityOf(envSano({ WHATSAPP_NUMBER: "+595 981 123-456" }), "whatsapp")).toBe(
      "bloquea",
    );
  });

  it("PAGOPAR_MODE=mock en producción bloquea", () => {
    expect(severityOf(envSano({ PAGOPAR_MODE: "mock" }), "pagopar_mode")).toBe("bloquea");
  });

  it("PAGOPAR_MODE=mock fuera de producción sólo advierte", () => {
    expect(
      severityOf(envSano({ NODE_ENV: "development", PAGOPAR_MODE: "mock" }), "pagopar_mode"),
    ).toBe("advierte");
  });

  it("los BANCO_* vacíos advierten, no bloquean", () => {
    // Desde el PR T los datos bancarios se cargan desde /admin/banco y el
    // entorno es el fallback. Este script no toca la base a propósito, así que
    // no puede saber si la tabla está cargada: bloquear el deploy por unas
    // variables que pueden estar legítimamente vacías sería un falso positivo
    // permanente. El aviso que sí sabe vive en /admin, que lee la base.
    expect(severityOf(envSano({ BANCO_CUENTA: "" }), "banco")).toBe("advierte");
    expect(severityOf(envSano({ BANCO_NOMBRE: "", BANCO_TITULAR: "", BANCO_RUC: "", BANCO_CUENTA: "", BANCO_TIPO_CUENTA: "" }), "banco")).toBe(
      "advierte",
    );
    expect(severityOf(envSano(), "banco")).toBe("ok");
  });

  it("sin credenciales de Pagopar advierte, no bloquea", () => {
    // La tienda cobra igual por transferencia y contra entrega: eso es el MVP.
    expect(
      severityOf(
        envSano({ PAGOPAR_PUBLIC_KEY: "", PAGOPAR_PRIVATE_KEY: "", PAGOPAR_BASE_URL: "" }),
        "pagopar_credenciales",
      ),
    ).toBe("advierte");
  });

  it("el sobre del webhook sólo bloquea si hay credenciales de Pagopar", () => {
    // Una tienda de transferencia y contra entrega no tiene webhook: frenarle
    // el deploy por un protocolo que no usa sería un falso positivo permanente.
    // Con una sola credencial cargada ya se asume que la tarjeta viene en
    // camino, y ahí sí bloquea hasta confirmar el sobre contra el sandbox.
    const sinCredenciales = envSano({
      PAGOPAR_PUBLIC_KEY: "",
      PAGOPAR_PRIVATE_KEY: "",
      PAGOPAR_BASE_URL: "",
    });
    expect(severityOf(sinCredenciales, "pagopar_webhook_envelope")).toBe("advierte");
    expect(severityOf(envSano(), "pagopar_webhook_envelope")).toBe("bloquea");
    expect(
      severityOf(
        envSano({ PAGOPAR_PUBLIC_KEY: "", PAGOPAR_BASE_URL: "" }),
        "pagopar_webhook_envelope",
      ),
    ).toBe("bloquea");
  });

  it("una URL de sitio sin https bloquea en producción", () => {
    // El token del pedido viaja en esa URL, y Pagopar no llama a un endpoint
    // sin certificado.
    expect(severityOf(envSano({ NEXT_PUBLIC_SITE_URL: "http://tienda.com.py" }), "site_url")).toBe(
      "bloquea",
    );
    expect(
      severityOf(
        envSano({ NODE_ENV: "development", NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }),
        "site_url",
      ),
    ).toBe("ok");
  });

  it("una base local en producción advierte sin frenar el deploy", () => {
    // En Hostinger puede ser correcto: la base vive en el mismo host.
    expect(
      severityOf(
        envSano({ DATABASE_URL: "mysql://ecom@localhost:3306/ecom" }),
        "database_url",
      ),
    ).toBe("advierte");
  });

  it("SETUP_SECRET olvidado en producción advierte", () => {
    // La ruta de setup existe para correr una vez y desaparecer: con la
    // variable puesta queda viva una ruta que migra, siembra y puede cambiarle
    // la contraseña al dueño (DEPLOY.md §4).
    expect(severityOf(envSano({ SETUP_SECRET: "s".repeat(32) }), "setup_secret")).toBe("advierte");
  });

  it("SETUP_SECRET no advierte fuera de producción ni cuando no está", () => {
    // Advierte y no bloquea a propósito: frenar el deploy por esto sería
    // frenar justo el deploy en el que se está usando.
    expect(
      severityOf(envSano({ NODE_ENV: "development", SETUP_SECRET: "s".repeat(32) }), "setup_secret"),
    ).toBe("ok");
    expect(severityOf(envSano(), "setup_secret")).toBe("ok");
    expect(preflight(envSano({ SETUP_SECRET: "s".repeat(32) })).ok).toBe(
      preflight(envSano()).ok,
    );
  });

  it("ningún detalle repite el valor de un secreto", () => {
    const env = envSano({
      SESSION_SECRET: "un-secreto-larguisimo-y-reconocible-1234",
      SETUP_SECRET: "otro-secreto-igual-de-reconocible-5678",
    });
    const texto = preflight(env)
      .checks.map((check) => `${check.title} ${check.detail}`)
      .join("\n");

    for (const secreto of [
      env.SESSION_SECRET,
      env.CRON_SECRET,
      env.PAGOPAR_PRIVATE_KEY,
      env.CLOUDINARY_API_SECRET,
      env.SETUP_SECRET,
      env.DATABASE_URL,
    ]) {
      expect(texto).not.toContain(secreto as string);
    }
  });

  it("cuenta bien lo que bloquea y lo que advierte", () => {
    const report = preflight(envSano({ CRON_SECRET: "", PAGOPAR_PUBLIC_KEY: "" }));

    expect(report.blocking).toBe(
      report.checks.filter((check) => check.severity === "bloquea").length,
    );
    expect(report.warnings).toBe(
      report.checks.filter((check) => check.severity === "advierte").length,
    );
    expect(report.ok).toBe(false);
  });
});

/**
 * El secreto de la sesión de cliente (FASE 2, PR E).
 *
 * El flag vive en `src/config/tienda.ts`, que es un módulo y no una variable
 * de entorno, así que se lo mockea. El default del template es apagado.
 */
describe("preflight · secreto de sesión de cliente", () => {
  const buscar = (env: PreflightEnv) =>
    preflight(env).checks.find((check) => check.id === "customer_session_secret");

  it("con las cuentas apagadas, no hace falta", () => {
    // El default del template: la variable no existe y está bien que no exista.
    expect(buscar(envSano())?.severity).toBe("ok");
  });

  it("con las cuentas prendidas y sin secreto propio, se deriva de SESSION_SECRET", async () => {
    vi.resetModules();
    vi.doMock("@/config/tienda", () => ({
      MARCA_PLACEHOLDER: "TiendaPY",
      TIENDA: { nombre: "Tienda Test", cuentasClientes: true },
      cuentasClientesHabilitadas: () => true,
    }));

    const { preflight: conCuentas } = await import("../../src/domain/preflight");
    const check = conCuentas(envSano()).checks.find((c) => c.id === "customer_session_secret");

    // Ya no hay que generar ni pegar otro secreto en el hPanel.
    expect(check?.severity).toBe("ok");
    expect(check?.detail).toMatch(/derivado/);

    vi.doUnmock("@/config/tienda");
    vi.resetModules();
  });

  it("las cuentas prendidas desde el panel también cuentan", () => {
    const check = preflight(envSano({ SESSION_SECRET: "" }), undefined, {
      cuentasClientes: true,
    }).checks.find((c) => c.id === "customer_session_secret");
    expect(check?.severity).toBe("bloquea");
  });

  it("con las cuentas prendidas, sin secreto propio y sin SESSION_SECRET válido, bloquea", async () => {
    vi.resetModules();
    vi.doMock("@/config/tienda", () => ({
      MARCA_PLACEHOLDER: "TiendaPY",
      TIENDA: { nombre: "Tienda Test", cuentasClientes: true },
      cuentasClientesHabilitadas: () => true,
    }));

    const { preflight: conCuentas } = await import("../../src/domain/preflight");
    const check = conCuentas(
      envSano({ SESSION_SECRET: "changeme-generate-with-openssl-rand-base64-32" }),
    ).checks.find((c) => c.id === "customer_session_secret");

    // Sin el secreto, /cuenta tira en runtime. Este script existe para que eso
    // se descubra antes del deploy y no con una compradora en la pantalla.
    expect(check?.severity).toBe("bloquea");

    vi.doUnmock("@/config/tienda");
    vi.resetModules();
  });

  it("con las cuentas prendidas, copiar SESSION_SECRET bloquea", async () => {
    vi.resetModules();
    vi.doMock("@/config/tienda", () => ({
      MARCA_PLACEHOLDER: "TiendaPY",
      TIENDA: { nombre: "Tienda Test", cuentasClientes: true },
      cuentasClientesHabilitadas: () => true,
    }));

    const { preflight: conCuentas } = await import("../../src/domain/preflight");
    const compartido = "un-secreto-de-mas-de-treinta-y-dos-caracteres";
    const check = conCuentas(
      envSano({ SESSION_SECRET: compartido, CUSTOMER_SESSION_SECRET: compartido }),
    ).checks.find((c) => c.id === "customer_session_secret");

    // Es el error que más se va a cometer: copiar el valor de al lado.
    // Compartir el secreto entre empleados del panel y compradoras es lo que
    // hace posible que una cookie de una sirva del otro lado.
    expect(check?.severity).toBe("bloquea");
    expect(check?.detail).toMatch(/copia de SESSION_SECRET/);

    vi.doUnmock("@/config/tienda");
    vi.resetModules();
  });

  it("con las cuentas prendidas y un secreto propio, pasa", async () => {
    vi.resetModules();
    vi.doMock("@/config/tienda", () => ({
      MARCA_PLACEHOLDER: "TiendaPY",
      TIENDA: { nombre: "Tienda Test", cuentasClientes: true },
      cuentasClientesHabilitadas: () => true,
    }));

    const { preflight: conCuentas } = await import("../../src/domain/preflight");
    const check = conCuentas(
      envSano({ CUSTOMER_SESSION_SECRET: "otro-secreto-largo-y-distinto-del-panel-ok" }),
    ).checks.find((c) => c.id === "customer_session_secret");

    expect(check?.severity).toBe("ok");

    vi.doUnmock("@/config/tienda");
    vi.resetModules();
  });
});

/**
 * La marca del template (NEW-STORE.md §2).
 *
 * Igual que el flag de cuentas: `TIENDA` es un módulo, no una variable de
 * entorno, así que los dos lados se prueban mockeándolo. El test de arriba
 * ("sólo bloquean los pendientes del estado del repo") cubre además el repo
 * real, calculando la expectativa según si este checkout es el template o una
 * tienda renombrada.
 */
describe("preflight · marca de la tienda", () => {
  it("con el nombre del template sin tocar, bloquea", async () => {
    vi.resetModules();
    vi.doMock("@/config/tienda", () => ({
      MARCA_PLACEHOLDER: "TiendaPY",
      TIENDA: { nombre: "TiendaPY", cuentasClientes: false },
      cuentasClientesHabilitadas: () => false,
    }));

    const { preflight: sinRenombrar } = await import("../../src/domain/preflight");
    const check = sinRenombrar(envSano()).checks.find((c) => c.id === "marca");

    // Cobrar con "TiendaPY" en el header y en cada link compartido es el
    // papelón del primer deploy, y ningún otro control lo mira.
    expect(check?.severity).toBe("bloquea");
    expect(check?.detail).toMatch(/tienda\.ts/);

    vi.doUnmock("@/config/tienda");
    vi.resetModules();
  });

  it("el nombre cargado en /admin/ajustes cuenta como renombrada", async () => {
    vi.resetModules();
    vi.doMock("@/config/tienda", () => ({
      MARCA_PLACEHOLDER: "TiendaPY",
      TIENDA: { nombre: "TiendaPY", cuentasClientes: false },
      cuentasClientesHabilitadas: () => false,
    }));

    const { preflight: conPanel } = await import("../../src/domain/preflight");
    const check = conPanel(envSano(), undefined, { nombreTienda: "Mascota Feliz" }).checks.find(
      (c) => c.id === "marca",
    );
    expect(check?.severity).toBe("ok");
    expect(check?.detail).toContain("Mascota Feliz");

    vi.doUnmock("@/config/tienda");
    vi.resetModules();
  });

  it("con la tienda renombrada, pasa", async () => {
    vi.resetModules();
    vi.doMock("@/config/tienda", () => ({
      MARCA_PLACEHOLDER: "TiendaPY",
      TIENDA: { nombre: "Lencería Bella", cuentasClientes: false },
      cuentasClientesHabilitadas: () => false,
    }));

    const { preflight: renombrada } = await import("../../src/domain/preflight");
    const check = renombrada(envSano()).checks.find((c) => c.id === "marca");

    expect(check?.severity).toBe("ok");

    vi.doUnmock("@/config/tienda");
    vi.resetModules();
  });

});

describe("preflight entiende las dos fuentes: /admin/integraciones y el entorno", () => {
  const sinCloudinaryNiWhatsApp = envSano({
    CLOUDINARY_CLOUD_NAME: "",
    CLOUDINARY_API_KEY: "",
    CLOUDINARY_API_SECRET: "",
    WHATSAPP_NUMBER: "",
  });

  function check(env: PreflightEnv, panel: Parameters<typeof preflight>[1], id: string) {
    const encontrado = preflight(env, panel).checks.find((item) => item.id === id);
    if (!encontrado) throw new Error(`no existe el control "${id}"`);
    return encontrado;
  }

  it("lo cargado en el panel destraba lo que falta en el entorno, y lo dice", () => {
    const panel = {
      lectura: "ok" as const,
      filas: {
        cloudinary: {
          valores: { cloudName: "nube", apiKey: "123", apiSecret: "secreto-del-panel-largo" },
          ilegibles: [],
        },
        whatsapp: { valores: { numeroComercio: "+595971000222" }, ilegibles: [] },
      },
    };

    const cloudinary = check(sinCloudinaryNiWhatsApp, panel, "cloudinary");
    expect(cloudinary.severity).toBe("ok");
    expect(cloudinary.detail).toContain("desde el panel");
    // Nunca el valor de un secreto.
    expect(JSON.stringify(preflight(sinCloudinaryNiWhatsApp, panel))).not.toContain(
      "secreto-del-panel-largo",
    );

    expect(check(sinCloudinaryNiWhatsApp, panel, "whatsapp").severity).toBe("ok");
    expect(check(sinCloudinaryNiWhatsApp, panel, "integraciones_panel").detail).toContain("cloudinary");
  });

  it("sin panel, lo del entorno se marca como del entorno", () => {
    const cloudinary = check(envSano(), { lectura: "ok", filas: {} }, "cloudinary");
    expect(cloudinary.severity).toBe("ok");
    expect(cloudinary.detail).toContain("desde el entorno");
  });

  it("sin nada en ninguna de las dos, bloquea igual que antes", () => {
    expect(check(sinCloudinaryNiWhatsApp, { lectura: "ok", filas: {} }, "cloudinary").severity).toBe(
      "bloquea",
    );
    expect(check(sinCloudinaryNiWhatsApp, { lectura: "ok", filas: {} }, "whatsapp").severity).toBe(
      "bloquea",
    );
  });

  it("si la base no contesta, lo avisa y revisa sólo el entorno", () => {
    const panel = { lectura: "fallo" as const, motivo: "ECONNREFUSED" };
    const lectura = check(envSano(), panel, "integraciones_panel");
    expect(lectura.severity).toBe("advierte");
    expect(lectura.detail).toContain("ECONNREFUSED");
    expect(check(envSano(), panel, "cloudinary").severity).toBe("ok");
  });

  it("sin panel (llamada sólo con el entorno) no aparece el control de lectura", () => {
    expect(preflight(envSano()).checks.some((item) => item.id === "integraciones_panel")).toBe(false);
  });
});
