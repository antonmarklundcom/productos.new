import { validSessionSecret } from "@/lib/session-secret";
import { MARCA_PLACEHOLDER, TIENDA } from "@/config/tienda";
import {
  CAMPOS,
  INTEGRACIONES,
  resolverIntegracion,
  type CampoDef,
  type FilaIntegracion,
  type Fuente,
  type Integracion,
} from "@/lib/integraciones";

import { WEBHOOK_ENVELOPE_CONFIRMED } from "./pagopar/protocol";
import { PAGOPAR_MOCK_MODE } from "./pagopar/mode";

/**
 * `pnpm preflight` — qué falta para cobrar plata de verdad.
 *
 * La pregunta que contesta no es "¿compila?" sino "**si mañana un desconocido
 * compra en este sitio, se pierde algo?**". Cada control de acá salió de un
 * pendiente real de TASKS.md o de un candado que existe en el código y que hay
 * que verificar que esté puesto en el servidor donde va a correr.
 *
 * Tres severidades:
 *
 *  - `bloquea`  — con esto así, cobrar es inseguro o se pierde plata. Salida 1.
 *  - `advierte` — funciona, pero degradado y conviene saberlo. Salida 0.
 *  - `ok`       — verificado.
 *
 * No se conecta a la base ni a la red: lee el entorno, constantes del código
 * y —si quien llama se la pasa— la configuración de integraciones que el
 * dueño cargó en `/admin/integraciones` (`scripts/preflight.ts` la lee de la
 * base, sólo lectura, y si no puede lo dice y sigue con el entorno). Con las
 * dos fuentes aplica la misma precedencia que la tienda —panel > entorno >
 * apagado, `src/lib/integraciones.ts`— y cada control dice **de dónde** sale
 * lo que verificó. Nunca imprime el **valor** de un secreto: sólo si está, y
 * si tiene largo suficiente.
 */

export type PreflightSeverity = "bloquea" | "advierte" | "ok";

export type PreflightCheck = {
  /** Id estable, para grepear en el log del deploy. */
  id: string;
  severity: PreflightSeverity;
  title: string;
  /** Qué se encontró, y qué hacer si no está bien. Sin valores de secretos. */
  detail: string;
};

export type PreflightReport = {
  checks: PreflightCheck[];
  /** `false` si hay al menos un `bloquea`. */
  ok: boolean;
  blocking: number;
  warnings: number;
};

/** El entorno que se inspecciona. Inyectable para poder testearlo. */
export type PreflightEnv = Record<string, string | undefined>;

function value(env: PreflightEnv, name: string): string {
  return (env[name] ?? "").trim();
}

function isProduction(env: PreflightEnv): boolean {
  return value(env, "NODE_ENV") === "production";
}

/** Los cinco datos bancarios sin los cuales la página SPI/QR no muestra nada. */
const BANCO_VARS = [
  "BANCO_NOMBRE",
  "BANCO_TITULAR",
  "BANCO_RUC",
  "BANCO_CUENTA",
  "BANCO_TIPO_CUENTA",
] as const;

/**
 * Lo que `scripts/preflight.ts` leyó de `/admin/integraciones`. Sin esto
 * (tests, o quien llame sólo con el entorno) se revisa sólo el entorno.
 */
export type PreflightPanel =
  | { lectura: "ok"; filas: Partial<Record<Integracion, FilaIntegracion>> }
  | { lectura: "fallo"; motivo: string };

type Origenes = Record<string, Fuente | null>;

/**
 * El entorno **efectivo**: cada variable de integración reemplazada por lo que
 * la tienda usa de verdad (panel > entorno), y de dónde salió cada una. Los
 * controles de abajo no cambiaron: siguen leyendo `CLOUDINARY_API_SECRET` y
 * compañía, sólo que ahora de esta vista.
 */
function entornoEfectivo(
  env: PreflightEnv,
  panel: PreflightPanel | undefined
): { efectivo: PreflightEnv; origenes: Origenes } {
  const efectivo: PreflightEnv = { ...env };
  const origenes: Origenes = {};
  const filas = panel?.lectura === "ok" ? panel.filas : {};

  for (const nombre of INTEGRACIONES) {
    const config = resolverIntegracion(nombre, filas[nombre], env);
    const valores = config.valores as Record<string, string | null>;
    const fuentes = config.fuentes as Record<string, Fuente | null>;
    const defs: readonly CampoDef[] = CAMPOS[nombre];
    for (const def of defs) {
      efectivo[def.env] = valores[def.campo] ?? "";
      origenes[def.env] = fuentes[def.campo] ?? null;
    }
  }
  return { efectivo, origenes };
}

/** Qué variables mira cada control, para decir de dónde salieron. */
const VARIABLES_DEL_CONTROL: Record<string, readonly string[]> = {
  cloudinary: [
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ],
  backups: [
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ],
  pagopar_credenciales: [
    "PAGOPAR_PUBLIC_KEY",
    "PAGOPAR_PRIVATE_KEY",
    "PAGOPAR_BASE_URL",
  ],
  whatsapp: ["WHATSAPP_NUMBER"],
  aviso_pedido_nuevo: [
    "WHATSAPP_CLOUD_PHONE_NUMBER_ID",
    "WHATSAPP_CLOUD_ACCESS_TOKEN",
    "WHATSAPP_CLOUD_TEMPLATE_PEDIDO_NUEVO",
  ],
  resumen_diario: [
    "WHATSAPP_CLOUD_PHONE_NUMBER_ID",
    "WHATSAPP_CLOUD_ACCESS_TOKEN",
    "WHATSAPP_CLOUD_TEMPLATE_RESUMEN_DIARIO",
  ],
  aviso_cliente_confirmado: ["WHATSAPP_CLOUD_TEMPLATE_CLIENTE_CONFIRMADO"],
  aviso_cliente_pagado: ["WHATSAPP_CLOUD_TEMPLATE_CLIENTE_PAGADO"],
  aviso_cliente_enviado: ["WHATSAPP_CLOUD_TEMPLATE_CLIENTE_ENVIADO"],
  aviso_cliente_recordatorio: ["WHATSAPP_CLOUD_TEMPLATE_CLIENTE_RECORDATORIO"],
  aviso_cliente_resena: ["WHATSAPP_CLOUD_TEMPLATE_CLIENTE_RESENA"],
};

/** `configurado` → `configurado · desde el panel`. Sin valores, sólo el origen. */
function conOrigen(check: PreflightCheck, origenes: Origenes): PreflightCheck {
  const variables = VARIABLES_DEL_CONTROL[check.id];
  if (!variables) return check;
  const usados = new Set(
    variables.map((name) => origenes[name]).filter((origen) => origen != null)
  );
  if (usados.size === 0) return check;
  const texto =
    usados.size === 2
      ? "desde el panel y el entorno"
      : usados.has("panel")
        ? "desde el panel (/admin/integraciones)"
        : "desde el entorno";
  return { ...check, detail: `${check.detail} · ${texto}` };
}

/** Si se pudo leer lo cargado en el panel. Sólo aparece cuando se intentó. */
function checkLecturaPanel(panel: PreflightPanel): PreflightCheck {
  const title = "Integraciones cargadas en el panel";
  if (panel.lectura === "fallo") {
    return {
      id: "integraciones_panel",
      severity: "advierte",
      title,
      detail:
        `no se pudo leer /admin/integraciones (${panel.motivo}): lo de abajo revisa sólo el ` +
        "entorno, y lo que el dueño haya cargado en el panel puede cambiar el resultado",
    };
  }
  const cargadas = INTEGRACIONES.filter(
    (nombre) => panel.filas[nombre] !== undefined
  );
  return {
    id: "integraciones_panel",
    severity: "ok",
    title,
    detail:
      cargadas.length === 0
        ? "ninguna: todo sale del entorno"
        : `${cargadas.join(", ")} (mandan sobre el entorno)`,
  };
}

/**
 * Lo que el dueño cargó en `/admin/ajustes` y cambia la respuesta de algún
 * control: el nombre de la tienda y si prendió las cuentas de cliente. Lo
 * lee `scripts/preflight.ts`; sin esto manda `src/config/tienda.ts`.
 */
export type PreflightAjustes = {
  nombreTienda?: string | null;
  cuentasClientes?: boolean | null;
};

export function preflight(
  envCrudo: PreflightEnv = process.env,
  panel?: PreflightPanel,
  ajustes: PreflightAjustes = {}
): PreflightReport {
  const { efectivo: env, origenes } = entornoEfectivo(envCrudo, panel);
  const checks: PreflightCheck[] = [
    ...(panel ? [checkLecturaPanel(panel)] : []),
    checkMarca(ajustes.nombreTienda),
    checkWebhookEnvelope(env),
    checkPagoparMode(env),
    checkBancoVars(env),
    checkCronSecret(env),
    checkSetupSecret(env),
    checkSessionSecret(env),
    checkCustomerSessionSecret(
      env,
      ajustes.cuentasClientes ?? TIENDA.cuentasClientes
    ),
    checkPagoparCredentials(env),
    checkCloudinary(env),
    checkWhatsApp(env),
    checkAvisoPedidoNuevo(env),
    checkAvisoCliente(
      env,
      "confirmado",
      "WHATSAPP_CLOUD_TEMPLATE_CLIENTE_CONFIRMADO"
    ),
    checkAvisoCliente(env, "pagado", "WHATSAPP_CLOUD_TEMPLATE_CLIENTE_PAGADO"),
    checkAvisoCliente(
      env,
      "enviado",
      "WHATSAPP_CLOUD_TEMPLATE_CLIENTE_ENVIADO"
    ),
    // O15. Advertencia, nunca bloqueo: sin esta plantilla la tienda cobra
    // exactamente igual que antes — lo que pierde son los pedidos que vencen
    // sin que nadie les haya dicho nada.
    checkAvisoCliente(
      env,
      "recordatorio",
      "WHATSAPP_CLOUD_TEMPLATE_CLIENTE_RECORDATORIO"
    ),
    checkAvisoCliente(env, "resena", "WHATSAPP_CLOUD_TEMPLATE_CLIENTE_RESENA"),
    checkResumenDiario(env),
    checkBackups(env),
    checkDatabaseUrl(env),
    checkSiteUrl(env),
  ].map((check) => conOrigen(check, origenes));

  const blocking = checks.filter(
    (check) => check.severity === "bloquea"
  ).length;
  const warnings = checks.filter(
    (check) => check.severity === "advierte"
  ).length;

  return { checks, ok: blocking === 0, blocking, warnings };
}

/**
 * La marca sigue siendo la del template.
 *
 * Ningún otro control mira `tienda.ts`, y éste existe porque el olvido es el
 * más visible de todos: "TiendaPY" queda en el header, en el `<title>`, en el
 * pie y en la imagen de Open Graph que se dibuja para **cada** link compartido
 * por WhatsApp. La tienda cobra igual — por eso no lo frena ningún candado del
 * código — pero cobrar con la marca del template es el papelón del primer
 * deploy, y es exactamente el paso 2 de NEW-STORE.md.
 */
function checkMarca(nombreDelPanel?: string | null): PreflightCheck {
  // El nombre de /admin/ajustes → Identidad manda sobre el de `tienda.ts`.
  const nombre = nombreDelPanel?.trim() || TIENDA.nombre.trim();

  if (nombre.toLowerCase() !== MARCA_PLACEHOLDER.toLowerCase()) {
    return {
      id: "marca",
      severity: "ok",
      title: "Marca de la tienda",
      detail: `"${nombre}"`,
    };
  }

  return {
    id: "marca",
    severity: "bloquea",
    title: "Marca de la tienda",
    detail:
      `la tienda sigue con el nombre del template ("${MARCA_PLACEHOLDER}"): header, ` +
      "títulos del navegador y la imagen de Open Graph de cada link compartido van a decir eso. " +
      "Cargá el nombre en /admin/ajustes → Identidad (o editá TIENDA en src/config/tienda.ts, " +
      "NEW-STORE.md §2) — y de " +
      "paso el logo y el favicon, que ningún control verifica",
  };
}

/**
 * El sobre de la respuesta del webhook, sin confirmar (TASKS.md §21).
 *
 * Es un hecho sobre el código, no sobre el entorno. Si Pagopar espera otra
 * forma, reintenta el aviso una y otra vez y termina marcando el pago como no
 * notificado, con la plata cobrada y el pedido sin marcar.
 *
 * Bloquea sólo si la tienda cargó credenciales de Pagopar: sin ellas el
 * checkout no ofrece tarjeta y el webhook no existe para esta tienda —
 * frenarle el deploy a una tienda de transferencia y contra entrega por un
 * protocolo que no usa sería un falso positivo permanente. Queda en
 * `advierte` para que el día que carguen las credenciales ya sepan qué falta.
 */
function checkWebhookEnvelope(env: PreflightEnv): PreflightCheck {
  if (WEBHOOK_ENVELOPE_CONFIRMED) {
    return {
      id: "pagopar_webhook_envelope",
      severity: "ok",
      title: "Sobre de la respuesta del webhook de Pagopar",
      detail: "confirmado contra la doc v2 vigente",
    };
  }

  const sinCredenciales = [
    "PAGOPAR_PUBLIC_KEY",
    "PAGOPAR_PRIVATE_KEY",
    "PAGOPAR_BASE_URL",
  ].every((name) => value(env, name) === "");

  if (sinCredenciales) {
    return {
      id: "pagopar_webhook_envelope",
      severity: "advierte",
      title: "Sobre de la respuesta del webhook de Pagopar",
      detail:
        "sin confirmar contra la doc v2 vigente — irrelevante mientras esta tienda no cargue " +
        "credenciales de Pagopar (sin ellas no hay tarjeta ni webhook). Al cargarlas, esto pasa " +
        "a bloquear hasta confirmarlo contra el sandbox",
    };
  }

  return {
    id: "pagopar_webhook_envelope",
    severity: "bloquea",
    title: "Sobre de la respuesta del webhook de Pagopar",
    detail:
      "sin confirmar contra la doc v2 vigente ni contra el sandbox. ARCH.md §4 avisa que " +
      "cambió entre revisiones. Corré tests/integration/pagopar-sandbox.test.ts con " +
      "credenciales, ajustá webhookResponseBody() si difiere y poné " +
      "WEBHOOK_ENVELOPE_CONFIRMED en true",
  };
}

/**
 * `PAGOPAR_MODE` en un entorno de producción.
 *
 * El candado de `mode.ts` ya hace que el simulador no se encienda con
 * `NODE_ENV=production`, así que esto no es la defensa: es el aviso de que
 * alguien copió el `.env` de desarrollo al servidor. Si mañana ese candado se
 * toca, la variable ya estaba puesta y esperando.
 */
function checkPagoparMode(env: PreflightEnv): PreflightCheck {
  const mode = value(env, "PAGOPAR_MODE").toLowerCase();

  if (mode === "" || mode === "real") {
    return {
      id: "pagopar_mode",
      severity: "ok",
      title: "Modo de la pasarela",
      detail: mode === "" ? "sin definir (real)" : "real",
    };
  }

  if (mode !== PAGOPAR_MOCK_MODE) {
    return {
      id: "pagopar_mode",
      severity: "advierte",
      title: "Modo de la pasarela",
      detail: `PAGOPAR_MODE="${mode}" no es un valor conocido; se va a tratar como "real"`,
    };
  }

  if (isProduction(env)) {
    return {
      id: "pagopar_mode",
      severity: "bloquea",
      title: "Modo de la pasarela",
      detail:
        'PAGOPAR_MODE="mock" con NODE_ENV=production. El candado de mode.ts lo apaga igual, ' +
        "pero que la variable esté puesta en el servidor real significa que se copió el .env " +
        "de desarrollo: sacala antes de que alguien toque el candado",
    };
  }

  return {
    id: "pagopar_mode",
    severity: "advierte",
    title: "Modo de la pasarela",
    detail: "simulador encendido (PAGOPAR_MODE=mock): no entra plata de verdad",
  };
}

/**
 * Los cinco `BANCO_*` del entorno.
 *
 * **Advierte y ya no bloquea** (PLAN.md FASE 2, PR T). Desde que los datos
 * bancarios se editan desde `/admin/banco`, el entorno pasó a ser el fallback
 * y no la única fuente: una tienda perfectamente configurada puede tener las
 * cinco variables vacías y la tabla cargada, y frenarle el deploy por eso
 * sería un falso positivo permanente.
 *
 * Este script **no toca la base a propósito** —se corre en el servidor de
 * producción y no puede tener efectos ni depender de que la base esté arriba—
 * así que desde acá no hay forma de saber si la tabla está cargada. Lo que
 * queda es decir la verdad completa: faltan en el entorno, y hay otro lugar
 * donde pueden estar. El aviso que sí sabe es el del panel, que lee la base y
 * aparece en `/admin` cuando no hay datos en **ninguna** de las dos fuentes.
 */
function checkBancoVars(env: PreflightEnv): PreflightCheck {
  const missing = BANCO_VARS.filter((name) => value(env, name) === "");

  if (missing.length === 0) {
    return {
      id: "banco",
      severity: "ok",
      title: "Datos bancarios (SPI/QR)",
      detail: "los cinco configurados en el entorno",
    };
  }

  return {
    id: "banco",
    severity: "advierte",
    title: "Datos bancarios (SPI/QR)",
    detail:
      `faltan ${missing.join(", ")} en el entorno. Desde la FASE 2 esto es configurable desde ` +
      "/admin/banco y lo que se cargue ahí manda sobre el entorno, así que puede estar bien. " +
      "Si tampoco están cargados en el panel, la página del pedido muestra un aviso en vez de " +
      "la cuenta y la transferencia —el método principal del MVP— no se puede completar: " +
      "el resumen de /admin lo dice con la base a la vista",
  };
}

/**
 * `CRON_SECRET`, con el mismo mínimo que exige la ruta.
 *
 * Sin él la ruta responde 503 y nadie vence los pedidos: las reservas se
 * sueltan solas (la disponibilidad se calcula en vivo), pero los pedidos
 * muertos quedan para siempre en `pendiente_pago` y el panel miente.
 */
function checkCronSecret(env: PreflightEnv): PreflightCheck {
  const secret = value(env, "CRON_SECRET");

  if (secret === "") {
    return {
      id: "cron_secret",
      severity: "bloquea",
      title: "Secreto del cron",
      detail:
        "CRON_SECRET vacío: la ruta responde 503 y no se vence ningún pedido",
    };
  }
  if (secret.length < 16) {
    return {
      id: "cron_secret",
      severity: "bloquea",
      title: "Secreto del cron",
      detail: `CRON_SECRET tiene ${secret.length} caracteres; la ruta exige 16 o más`,
    };
  }

  return {
    id: "cron_secret",
    severity: "ok",
    title: "Secreto del cron",
    detail: "configurado",
  };
}

/**
 * `SETUP_SECRET` sobreviviendo al setup.
 *
 * `POST /api/setup/init` existe para inicializar la tienda una vez y después
 * desaparecer: sacada la variable del hPanel, la ruta vuelve a 503. Dejarla
 * puesta es dejar viva una ruta que corre migraciones, siembra el catálogo y
 * puede cambiarle la contraseña al dueño — todo detrás de un solo secreto que
 * ya circuló por un curl, por el historial de la terminal y por el panel.
 *
 * Advierte y no bloquea: la ruta igual pide `force` para volver a tocar datos,
 * y frenar un deploy por esto sería frenar justo el deploy en el que se está
 * usando. Lo que no puede pasar es que nadie lo mire.
 */
function checkSetupSecret(env: PreflightEnv): PreflightCheck {
  const secret = value(env, "SETUP_SECRET");

  if (secret === "") {
    return {
      id: "setup_secret",
      severity: "ok",
      title: "Secreto del setup",
      detail:
        "SETUP_SECRET no está: /api/setup/init responde 503, que es como tiene que quedar",
    };
  }

  if (isProduction(env)) {
    return {
      id: "setup_secret",
      severity: "advierte",
      title: "Secreto del setup",
      detail:
        "SETUP_SECRET sigue configurado con NODE_ENV=production: /api/setup/init está viva y " +
        "corre migraciones, siembra y puede cambiar la contraseña del dueño. Terminado el " +
        "setup, sacala del hPanel y apretá Redeploy (DEPLOY.md §4)",
    };
  }

  return {
    id: "setup_secret",
    severity: "ok",
    title: "Secreto del setup",
    detail: "configurado fuera de producción",
  };
}

/** iron-session revienta en runtime, no en build, si tiene menos de 32. */
function checkSessionSecret(env: PreflightEnv): PreflightCheck {
  const secret = value(env, "SESSION_SECRET");

  if (secret === "") {
    return {
      id: "session_secret",
      severity: "bloquea",
      title: "Secreto de sesión",
      detail: "SESSION_SECRET vacío: el panel no se puede usar",
    };
  }
  if (secret.length < 32) {
    return {
      id: "session_secret",
      severity: "bloquea",
      title: "Secreto de sesión",
      detail: `SESSION_SECRET tiene ${secret.length} caracteres; iron-session exige 32 o más`,
    };
  }
  if (!validSessionSecret(secret)) {
    return {
      id: "session_secret",
      severity: "bloquea",
      title: "Secreto de sesión",
      detail: "SESSION_SECRET sigue siendo el placeholder de .env.example",
    };
  }

  return {
    id: "session_secret",
    severity: "ok",
    title: "Secreto de sesión",
    detail: "configurado",
  };
}

/**
 * El secreto de la sesión de cliente (FASE 2, PR E).
 *
 * Sólo aplica si esta tienda prendió las cuentas (en `/admin/ajustes` o en
 * `tienda.ts`). Con el flag apagado —el default— nadie lee esta variable.
 *
 * Vacía está bien: el secreto se deriva de `SESSION_SECRET`. Lo que
 * **bloquea** es no tener de dónde sacarlo, o una variable propia rota: sin
 * secreto las rutas de `/cuenta` tiran en runtime, y este script existe
 * justamente para que eso se descubra antes del deploy.
 *
 * El caso que más se chequea es el que más va a pasar: copiar el valor de
 * `SESSION_SECRET`. Compartir el secreto entre las dos poblaciones —empleados
 * del panel y compradoras— es lo que hace posible que una cookie de una sirva
 * del otro lado.
 */
function checkCustomerSessionSecret(
  env: PreflightEnv,
  cuentasActivas: boolean
): PreflightCheck {
  const title = "Secreto de sesión de cliente";

  if (!cuentasActivas) {
    return {
      id: "customer_session_secret",
      severity: "ok",
      title,
      detail: "esta tienda no tiene cuentas de cliente: no hace falta",
    };
  }

  const secret = value(env, "CUSTOMER_SESSION_SECRET");

  if (secret === "") {
    // Vacío ya no es un error: se deriva de SESSION_SECRET con HKDF
    // (src/lib/customer-session.ts). Sólo falla si SESSION_SECRET tampoco sirve.
    const base = value(env, "SESSION_SECRET");
    if (validSessionSecret(base)) {
      return {
        id: "customer_session_secret",
        severity: "ok",
        title,
        detail:
          "derivado de SESSION_SECRET (HKDF, independiente del del panel)",
      };
    }
    return {
      id: "customer_session_secret",
      severity: "bloquea",
      title,
      detail:
        "las cuentas de cliente están prendidas y no hay de dónde sacar su secreto: " +
        "CUSTOMER_SESSION_SECRET está vacío y SESSION_SECRET no es válido. /cuenta revienta en runtime",
    };
  }
  if (secret.length < 32) {
    return {
      id: "customer_session_secret",
      severity: "bloquea",
      title,
      detail: `CUSTOMER_SESSION_SECRET tiene ${secret.length} caracteres; iron-session exige 32 o más`,
    };
  }
  if (secret === value(env, "SESSION_SECRET")) {
    return {
      id: "customer_session_secret",
      severity: "bloquea",
      title,
      detail:
        "CUSTOMER_SESSION_SECRET es una copia de SESSION_SECRET: las sesiones del panel y las de " +
        "las compradoras tienen que ser criptográficamente independientes. Generá uno nuevo con " +
        "openssl rand -base64 32",
    };
  }
  if (!validSessionSecret(secret)) {
    return {
      id: "customer_session_secret",
      severity: "bloquea",
      title,
      detail: "CUSTOMER_SESSION_SECRET sigue siendo un placeholder",
    };
  }

  return {
    id: "customer_session_secret",
    severity: "ok",
    title,
    detail: "configurado",
  };
}

/**
 * Credenciales de Pagopar.
 *
 * Advierte y no bloquea: la tienda cobra igual por transferencia y contra
 * entrega, que es el MVP. Sin las tres, el checkout simplemente no ofrece
 * tarjeta.
 */
function checkPagoparCredentials(env: PreflightEnv): PreflightCheck {
  const missing = [
    "PAGOPAR_PUBLIC_KEY",
    "PAGOPAR_PRIVATE_KEY",
    "PAGOPAR_BASE_URL",
  ].filter((name) => value(env, name) === "");

  if (missing.length === 0) {
    return {
      id: "pagopar_credenciales",
      severity: "ok",
      title: "Credenciales de Pagopar",
      detail: "las tres configuradas",
    };
  }

  return {
    id: "pagopar_credenciales",
    severity: "advierte",
    title: "Credenciales de Pagopar",
    detail:
      `faltan ${missing.join(", ")} (en /admin/integraciones o en el entorno): el checkout no ` +
      "va a ofrecer tarjeta",
  };
}

/** Sin Cloudinary no hay comprobantes: el comprador no puede probar que pagó. */
function checkCloudinary(env: PreflightEnv): PreflightCheck {
  const missing = [
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ].filter((name) => {
    const current = value(env, name);
    return current === "" || /changeme/i.test(current);
  });

  if (missing.length === 0) {
    return {
      id: "cloudinary",
      severity: "ok",
      title: "Cloudinary",
      detail: "configurado",
    };
  }

  return {
    id: "cloudinary",
    severity: "bloquea",
    title: "Cloudinary",
    detail:
      `faltan ${missing.join(", ")} (cargalas en /admin/integraciones o en el entorno). Sin ` +
      "esto el comprador no puede subir el comprobante, " +
      "que es el único paso que convierte una transferencia en un pedido verificable",
  };
}

/**
 * El número que `.env.example` traía de ejemplo hasta 2026-09. Una tienda
 * con un `.env.local` copiado de esa época lo tiene cargado y con forma
 * válida, así que el chequeo de formato lo dejaba pasar: los compradores
 * terminaban escribiéndole a un WhatsApp ajeno.
 */
export const WHATSAPP_DE_EJEMPLO = "+595981123456";

/** El aviso al dueño llega por WhatsApp; sin número, no llega. */
function checkWhatsApp(env: PreflightEnv): PreflightCheck {
  const phone = value(env, "WHATSAPP_NUMBER");

  if (phone === "") {
    return {
      id: "whatsapp",
      severity: "bloquea",
      title: "WhatsApp del comercio",
      detail:
        "sin WhatsApp del comercio (ni en /admin/integraciones ni en WHATSAPP_NUMBER): el " +
        "comprador no tiene botón para avisar del pedido",
    };
  }
  if (phone.replace(/[^\d+]/g, "") === WHATSAPP_DE_EJEMPLO) {
    return {
      id: "whatsapp",
      severity: "bloquea",
      title: "WhatsApp del comercio",
      detail:
        "WHATSAPP_NUMBER es el número de ejemplo del template, no el del comercio: " +
        "los compradores le escribirían a un WhatsApp ajeno",
    };
  }
  if (!/^\+595\d{9}$/.test(phone)) {
    return {
      id: "whatsapp",
      severity: "advierte",
      title: "WhatsApp del comercio",
      detail:
        "WHATSAPP_NUMBER no tiene la forma +5959XXXXXXXX; wa.me puede rechazarlo",
    };
  }

  return {
    id: "whatsapp",
    severity: "ok",
    title: "WhatsApp del comercio",
    detail: "configurado",
  };
}

/**
 * El aviso de pedido nuevo al comercio (fable/plan.md §5.2).
 *
 * Advierte, no bloquea: una tienda puede vender igual mirando el panel. Pero
 * mirarlo es una disciplina, y un pedido por transferencia que nadie ve en 24
 * horas es una venta perdida, así que conviene que salga escrito en el deploy.
 */
function checkAvisoPedidoNuevo(env: PreflightEnv): PreflightCheck {
  const template = value(env, "WHATSAPP_CLOUD_TEMPLATE_PEDIDO_NUEVO");
  const cloudListo =
    value(env, "WHATSAPP_CLOUD_PHONE_NUMBER_ID") !== "" &&
    value(env, "WHATSAPP_CLOUD_ACCESS_TOKEN") !== "";
  const destino = value(env, "WHATSAPP_NUMBER");

  const faltan = [
    ...(cloudListo ? [] : ["las credenciales de WhatsApp Cloud"]),
    ...(template === "" ? ["WHATSAPP_CLOUD_TEMPLATE_PEDIDO_NUEVO"] : []),
    ...(destino === "" ? ["WHATSAPP_NUMBER"] : []),
  ];

  if (faltan.length > 0) {
    return {
      id: "aviso_pedido_nuevo",
      severity: "advierte",
      title: "Aviso de pedido nuevo",
      detail:
        `el comercio no recibe aviso de pedidos nuevos: falta ${faltan.join(", ")}. ` +
        "Se entera sólo si mira el panel o si la compradora toca el botón de WhatsApp",
    };
  }

  return {
    id: "aviso_pedido_nuevo",
    severity: "ok",
    title: "Aviso de pedido nuevo",
    detail: "configurado",
  };
}

/**
 * Copias de seguridad automáticas (O8).
 *
 * Advierte, no bloquea: una tienda puede cobrar perfectamente sin backups
 * automáticos, y `pnpm backup` desde la máquina de Anton sigue existiendo.
 * Pero es la advertencia que más caro sale ignorar de todo este archivo — con
 * una tienda es un encogerse de hombros, con cuatro andando es lo que termina
 * con el negocio.
 *
 * De lo que este control **no** puede saber nada es de la entrada de cron del
 * hPanel: con Cloudinary configurado y sin la entrada, la ruta existe y nadie
 * la llama nunca. Eso está en DEPLOY.md §5 y hay que mirarlo a mano.
 */
function checkBackups(env: PreflightEnv): PreflightCheck {
  const faltan = [
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ].filter((name) => value(env, name) === "");

  if (faltan.length > 0) {
    return {
      id: "backups",
      severity: "advierte",
      title: "Copias de seguridad automáticas",
      detail:
        `sin Cloudinary (falta ${faltan.join(", ")}) no hay dónde guardar la copia diaria: ` +
        "/api/cron/backup se saltea sola. Queda `pnpm backup` a mano desde tu máquina",
    };
  }

  return {
    id: "backups",
    severity: "ok",
    title: "Copias de seguridad automáticas",
    detail:
      "Cloudinary configurado (falta verificar la entrada de cron del hPanel, DEPLOY.md §5)",
  };
}

/**
 * El resumen diario al dueño (O6).
 *
 * Advierte y no bloquea, como el resto de los avisos: no tenerlo no le impide
 * vender a nadie. Pero se chequea aparte y con su propio texto porque lo que
 * se pierde sin él es concreto y no se nota: los comprobantes sin revisar y
 * los pedidos sin pagar se quedan quietos hasta que alguien abre el panel, y
 * el motivo por el que este mensaje existe es que **nadie abre el panel a las
 * ocho de la mañana**.
 *
 * `WHATSAPP_CLOUD_TEMPLATE_STOCK_DISPONIBLE` no se chequea acá: "avisame
 * cuando haya stock" es opcional de verdad — sin ella, el formulario no
 * aparece y no se pierde nada que la tienda estuviera esperando.
 */
function checkResumenDiario(env: PreflightEnv): PreflightCheck {
  const template = value(env, "WHATSAPP_CLOUD_TEMPLATE_RESUMEN_DIARIO");
  const cloudListo =
    value(env, "WHATSAPP_CLOUD_PHONE_NUMBER_ID") !== "" &&
    value(env, "WHATSAPP_CLOUD_ACCESS_TOKEN") !== "";
  const destino = value(env, "WHATSAPP_NUMBER");

  const faltan = [
    ...(cloudListo ? [] : ["las credenciales de WhatsApp Cloud"]),
    ...(template === "" ? ["WHATSAPP_CLOUD_TEMPLATE_RESUMEN_DIARIO"] : []),
    ...(destino === "" ? ["WHATSAPP_NUMBER"] : []),
  ];

  if (faltan.length > 0) {
    return {
      id: "resumen_diario",
      severity: "advierte",
      title: "Resumen diario",
      detail:
        `el dueño no recibe el resumen diario: falta ${faltan.join(", ")}. ` +
        "Los comprobantes por revisar y los pedidos sin pagar se quedan quietos hasta que " +
        "alguien abra el panel",
    };
  }

  return {
    id: "resumen_diario",
    severity: "ok",
    title: "Resumen diario",
    detail:
      "configurado (acordate de la entrada de cron diaria del hPanel, DEPLOY.md)",
  };
}

/**
 * Los tres avisos a la COMPRADORA (fase O3): confirmado, pagado, enviado.
 *
 * Advierte, no bloquea — igual que el aviso al comercio: cada uno es una
 * decisión aparte de la tienda, y no tenerlos configurados no le impide
 * vender. A diferencia del aviso al comercio, acá no hay `WHATSAPP_NUMBER`
 * que chequear: el destino es el WhatsApp de cada compradora, que ya está en
 * su pedido.
 */
function checkAvisoCliente(
  env: PreflightEnv,
  id: "confirmado" | "pagado" | "enviado" | "recordatorio" | "resena",
  templateVar: string
): PreflightCheck {
  const template = value(env, templateVar);
  const cloudListo =
    value(env, "WHATSAPP_CLOUD_PHONE_NUMBER_ID") !== "" &&
    value(env, "WHATSAPP_CLOUD_ACCESS_TOKEN") !== "";

  const titulo = `Aviso a la compradora: ${id}`;

  if (template === "") {
    return {
      id: `aviso_cliente_${id}`,
      severity: "advierte",
      title: titulo,
      detail:
        id === "recordatorio"
          ? `${templateVar} vacío: las compradoras no reciben recordatorio de pago y el pedido ` +
            "que se olvidaron vence sin que nadie les haya dicho nada"
          : `${templateVar} vacío: la compradora no recibe este aviso. Sin plantilla no sale ` +
            "ni por la consola de dev — es una decisión de esta tienda, no un default",
    };
  }

  if (!cloudListo) {
    return {
      id: `aviso_cliente_${id}`,
      severity: "advierte",
      title: titulo,
      detail:
        `${templateVar} está cargado pero faltan las credenciales de WhatsApp Cloud: fuera de ` +
        "producción sale por la consola del servidor, en producción no sale",
    };
  }

  return {
    id: `aviso_cliente_${id}`,
    severity: "ok",
    title: titulo,
    detail: "configurado",
  };
}

/** Una base local en el servidor real es una tienda sin datos. */
function checkDatabaseUrl(env: PreflightEnv): PreflightCheck {
  const url = value(env, "DATABASE_URL");

  if (url === "") {
    return {
      id: "database_url",
      severity: "bloquea",
      title: "Base de datos",
      detail: "DATABASE_URL vacía",
    };
  }

  if (isProduction(env) && /@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    return {
      id: "database_url",
      severity: "advierte",
      title: "Base de datos",
      detail:
        "DATABASE_URL apunta a localhost con NODE_ENV=production. En Hostinger puede ser " +
        "correcto (la base vive en el mismo host); verificá que no sea el .env de desarrollo",
    };
  }

  return {
    id: "database_url",
    severity: "ok",
    title: "Base de datos",
    detail: "configurada",
  };
}

/** Los links de WhatsApp que se le mandan al comprador salen de acá. */
function checkSiteUrl(env: PreflightEnv): PreflightCheck {
  const url = value(env, "NEXT_PUBLIC_SITE_URL");

  if (url === "") {
    return {
      id: "site_url",
      severity: "bloquea",
      title: "URL del sitio",
      detail: "NEXT_PUBLIC_SITE_URL vacía: los links del pedido salen rotos",
    };
  }

  if (isProduction(env) && !url.startsWith("https://")) {
    return {
      id: "site_url",
      severity: "bloquea",
      title: "URL del sitio",
      detail:
        `NEXT_PUBLIC_SITE_URL no es https en producción. El token del pedido viaja en esa ` +
        "URL y Pagopar no llama a un endpoint sin certificado",
    };
  }

  return {
    id: "site_url",
    severity: "ok",
    title: "URL del sitio",
    detail: url,
  };
}
