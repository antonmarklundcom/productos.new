/**
 * **El** módulo de lectura de la configuración de integraciones: Cloudinary,
 * WhatsApp (el número del comercio y la Cloud API), Pagopar, la medición
 * (GA4/Pixel) y el reporte de errores.
 *
 * Precedencia, siempre la misma: **fila de la base > variable de entorno >
 * apagado**. La fila la carga el dueño desde `/admin/integraciones` sin tocar
 * el hPanel ni redeployar; el entorno es el camino de siempre y queda como
 * fallback legacy (igual que `BANCO_*` con `/admin/banco`), así que una tienda
 * que ya andaba con sus variables no cambia en nada al actualizar.
 *
 * ### Credenciales que van juntas
 *
 * Los campos marcados `grupo` (cloud_name + api_key + api_secret; phone id +
 * token; las tres de Pagopar) no se mezclan entre fuentes: si el panel tiene
 * **cualquiera** de ellos, el grupo entero sale del panel, y lo que falte ahí
 * falta — no se completa con el entorno. Mezclar el `cloud_name` de una cuenta
 * cargada en el panel con el `api_secret` de otra que quedó en el hPanel es una
 * integración que falla de formas rarísimas, o que sube los comprobantes a la
 * cuenta equivocada. El resto (plantillas, prefijo, versión de la API) se
 * resuelve campo por campo.
 *
 * ### Por qué la lectura es síncrona
 *
 * La base se lee en `integraciones-store.ts` (que descifra los secretos) y
 * deja acá una **foto** en memoria, compartida por todo el proceso vía
 * `globalThis` —también con `src/proxy.ts`, que se compila aparte—. Leer es
 * síncrono: las funciones de siempre (`pagoparConfig()`, `whatsappCloudConfig()`,
 * `cloudinaryConfigured()`, `analyticsConfig()`) siguen teniendo la misma
 * firma y sólo cambió **de dónde** sacan los valores.
 *
 * La foto se carga al arrancar (`instrumentation.ts`), se refresca cada
 * `TTL_MS` (una lectura vieja dispara la recarga en segundo plano) y se tira
 * al guardar desde el panel. Los caminos que tocan plata o credenciales
 * —webhook, checkout, subidas, crons— además hacen `await
 * cargarIntegraciones()` antes de leer, para no depender de la foto.
 *
 * Sin foto (tests, scripts que no la cargaron, la base caída, o sin
 * `SESSION_SECRET` válido) la lectura es exactamente la de antes: el entorno.
 *
 * **Este archivo no importa nada del servidor** (ni la base, ni `node:crypto`):
 * `src/lib/images.ts` lo usa y lo importan componentes cliente. En el
 * navegador no hay foto ni entorno, y todo da `null`, como antes.
 */

export const INTEGRACIONES = [
  "cloudinary",
  "whatsapp",
  "pagopar",
  "analitica",
  "errores",
] as const;
export type Integracion = (typeof INTEGRACIONES)[number];

export function esIntegracion(valor: string): valor is Integracion {
  return (INTEGRACIONES as readonly string[]).includes(valor);
}

export type CampoDef = {
  readonly campo: string;
  /** La variable de entorno de siempre: el fallback. */
  readonly env: string;
  /** Se guarda cifrado y nunca vuelve al navegador. */
  readonly secreto?: boolean;
  /** Credencial que va junto con las otras del grupo (ver arriba). */
  readonly grupo?: boolean;
};

export const CAMPOS = {
  cloudinary: [
    { campo: "cloudName", env: "CLOUDINARY_CLOUD_NAME", grupo: true },
    { campo: "apiKey", env: "CLOUDINARY_API_KEY", grupo: true },
    {
      campo: "apiSecret",
      env: "CLOUDINARY_API_SECRET",
      grupo: true,
      secreto: true,
    },
    { campo: "folderPrefix", env: "CLOUDINARY_FOLDER_PREFIX" },
  ],
  whatsapp: [
    { campo: "numeroComercio", env: "WHATSAPP_NUMBER" },
    {
      campo: "phoneNumberId",
      env: "WHATSAPP_CLOUD_PHONE_NUMBER_ID",
      grupo: true,
    },
    {
      campo: "accessToken",
      env: "WHATSAPP_CLOUD_ACCESS_TOKEN",
      grupo: true,
      secreto: true,
    },
    { campo: "apiVersion", env: "WHATSAPP_CLOUD_API_VERSION" },
    { campo: "plantillaLogin", env: "WHATSAPP_CLOUD_TEMPLATE_NAME" },
    {
      campo: "plantillaRecuperarPedido",
      env: "WHATSAPP_CLOUD_TEMPLATE_RECUPERAR_PEDIDO",
    },
    {
      campo: "plantillaPedidoNuevo",
      env: "WHATSAPP_CLOUD_TEMPLATE_PEDIDO_NUEVO",
    },
    {
      campo: "plantillaClienteConfirmado",
      env: "WHATSAPP_CLOUD_TEMPLATE_CLIENTE_CONFIRMADO",
    },
    {
      campo: "plantillaClientePagado",
      env: "WHATSAPP_CLOUD_TEMPLATE_CLIENTE_PAGADO",
    },
    {
      campo: "plantillaClienteEnviado",
      env: "WHATSAPP_CLOUD_TEMPLATE_CLIENTE_ENVIADO",
    },
    {
      campo: "plantillaClienteRecordatorio",
      env: "WHATSAPP_CLOUD_TEMPLATE_CLIENTE_RECORDATORIO",
    },
    {
      campo: "plantillaClienteResena",
      env: "WHATSAPP_CLOUD_TEMPLATE_CLIENTE_RESENA",
    },
    {
      campo: "plantillaResumenDiario",
      env: "WHATSAPP_CLOUD_TEMPLATE_RESUMEN_DIARIO",
    },
    {
      campo: "plantillaStockDisponible",
      env: "WHATSAPP_CLOUD_TEMPLATE_STOCK_DISPONIBLE",
    },
  ],
  pagopar: [
    { campo: "publicKey", env: "PAGOPAR_PUBLIC_KEY", grupo: true },
    {
      campo: "privateKey",
      env: "PAGOPAR_PRIVATE_KEY",
      grupo: true,
      secreto: true,
    },
    { campo: "baseUrl", env: "PAGOPAR_BASE_URL", grupo: true },
  ],
  analitica: [
    { campo: "ga4Id", env: "NEXT_PUBLIC_GA4_ID" },
    { campo: "metaPixelId", env: "NEXT_PUBLIC_META_PIXEL_ID" },
  ],
  errores: [{ campo: "reportUrl", env: "ERROR_REPORT_URL" }],
} as const satisfies Record<Integracion, readonly CampoDef[]>;

export type CampoDe<N extends Integracion> =
  (typeof CAMPOS)[N][number]["campo"];

export type Fuente = "panel" | "entorno";

/** Lo que dejó la base para una integración, ya descifrado. */
export type FilaIntegracion = {
  /** Valores cargados en el panel (los secretos, en claro: nunca salen del servidor). */
  valores: Readonly<Record<string, string>>;
  /** Secretos guardados que no se pudieron descifrar (cambió `SESSION_SECRET`). */
  ilegibles: readonly string[];
};

export type ConfigEfectiva<N extends Integracion> = {
  valores: { readonly [K in CampoDe<N>]: string | null };
  fuentes: { readonly [K in CampoDe<N>]: Fuente | null };
  /** Campos cuyo secreto está en el panel pero no se puede descifrar. */
  ilegibles: readonly CampoDe<N>[];
};

type Entorno = Record<string, string | undefined>;

/**
 * Un valor que no cuenta como cargado: vacío, o el `changeme` que traían los
 * `.env.example` viejos (un `.env.local` copiado de esa época lo tiene, y con
 * él `cloudinaryConfigured()` daba true con credenciales de mentira).
 */
function limpio(valor: string | undefined | null): string | null {
  const texto = (valor ?? "").trim();
  if (texto === "" || /^changeme/i.test(texto)) return null;
  return texto;
}

/**
 * La precedencia, pura: fila de la base > entorno > `null` (apagado).
 * Es lo que prueban los tests; `integracion()` sólo le pasa la foto y el
 * entorno del proceso.
 */
export function resolverIntegracion<N extends Integracion>(
  nombre: N,
  fila: FilaIntegracion | undefined,
  env: Entorno
): ConfigEfectiva<N> {
  const defs: readonly CampoDef[] = CAMPOS[nombre];
  const enPanel = (campo: string): string | null =>
    limpio(fila?.valores[campo]);
  const ilegible = (campo: string): boolean =>
    fila?.ilegibles.includes(campo) ?? false;

  const grupoEnPanel = defs.some(
    (def) =>
      def.grupo === true && (enPanel(def.campo) !== null || ilegible(def.campo))
  );

  const valores: Record<string, string | null> = {};
  const fuentes: Record<string, Fuente | null> = {};
  for (const def of defs) {
    const delPanel = enPanel(def.campo);
    if (def.grupo === true && grupoEnPanel) {
      valores[def.campo] = delPanel;
      fuentes[def.campo] = delPanel === null ? null : "panel";
      continue;
    }
    if (delPanel !== null) {
      valores[def.campo] = delPanel;
      fuentes[def.campo] = "panel";
      continue;
    }
    const delEntorno = limpio(env[def.env]);
    valores[def.campo] = delEntorno;
    fuentes[def.campo] = delEntorno === null ? null : "entorno";
  }

  return {
    valores: valores as ConfigEfectiva<N>["valores"],
    fuentes: fuentes as ConfigEfectiva<N>["fuentes"],
    ilegibles: defs.map((def) => def.campo).filter(ilegible) as CampoDe<N>[],
  };
}

// ---------------------------------------------------------------------------
// La foto en memoria
// ---------------------------------------------------------------------------

/** Cuánto vale la foto antes de pedir una recarga. Corto a propósito. */
export const TTL_MS = 30_000;

type Foto = {
  filas: Partial<Record<Integracion, FilaIntegracion>>;
  /** 0 = nunca se cargó. */
  cargadaEn: number;
  /** Lo registra `integraciones-store.ts`: acá no se importa la base. */
  cargador: (() => Promise<void>) | null;
  recargando: Promise<void> | null;
};

const CLAVE = Symbol.for("ecom.integraciones.foto");

function foto(): Foto {
  const global = globalThis as typeof globalThis & { [CLAVE]?: Foto };
  global[CLAVE] ??= {
    filas: {},
    cargadaEn: 0,
    cargador: null,
    recargando: null,
  };
  return global[CLAVE];
}

function entornoDelProceso(): Entorno {
  return typeof process === "undefined" ? {} : process.env;
}

/** Sólo `integraciones-store.ts`: publica lo que leyó de la base. */
export function publicarFoto(
  filas: Partial<Record<Integracion, FilaIntegracion>>,
  ahora = Date.now()
): void {
  const actual = foto();
  actual.filas = filas;
  actual.cargadaEn = ahora;
}

/** Lo que hay en la foto ahora (para no perderlo si una recarga falla). */
export function filasEnFoto(): Partial<Record<Integracion, FilaIntegracion>> {
  return foto().filas;
}

/** ¿Se cargó la foto alguna vez en este proceso? */
export function fotoCargada(): boolean {
  return foto().cargadaEn > 0;
}

/** Sólo `integraciones-store.ts`: cómo recargar sin que este archivo importe la base. */
export function registrarCargador(cargador: () => Promise<void>): void {
  foto().cargador = cargador;
}

/** ¿Hace falta ir a la base? */
export function fotoVencida(ahora = Date.now()): boolean {
  return ahora - foto().cargadaEn > TTL_MS;
}

/** La recarga en curso, compartida: diez lecturas vencidas no son diez consultas. */
export function recargaEnCurso(): Promise<void> | null {
  return foto().recargando;
}

export function marcarRecarga(promesa: Promise<void> | null): void {
  foto().recargando = promesa;
}

/** Tira la foto: la próxima lectura va a la base. Se llama al guardar. */
export function invalidarIntegraciones(): void {
  foto().cargadaEn = 0;
}

/** Sólo tests. */
export function resetIntegracionesForTests(): void {
  const actual = foto();
  actual.filas = {};
  actual.cargadaEn = 0;
  actual.recargando = null;
  actual.cargador = null;
}

/**
 * La config efectiva de una integración: panel > entorno > apagado.
 *
 * Nunca tira. Si la foto está vencida y hay cargador, dispara la recarga en
 * segundo plano y contesta con lo que hay (stale-while-revalidate): una
 * lectura no espera a la base.
 */
export function integracion<N extends Integracion>(
  nombre: N,
  env: Entorno = entornoDelProceso()
): ConfigEfectiva<N> {
  const actual = foto();
  if (actual.cargador && actual.recargando === null && fotoVencida()) {
    void actual.cargador().catch(() => {
      // El cargador ya deja el motivo en el log y nunca tira; esto es por las dudas.
    });
  }
  return resolverIntegracion(nombre, actual.filas[nombre], env);
}

/** Atajo: el valor efectivo de un campo, o `null`. */
export function valorIntegracion<N extends Integracion>(
  nombre: N,
  campo: CampoDe<N>
): string | null {
  return integracion(nombre).valores[campo];
}

// ---------------------------------------------------------------------------
// ¿Está prendida?
// ---------------------------------------------------------------------------

/**
 * Qué hace falta para que cada integración funcione. `todos`: sin cualquiera
 * no anda (credenciales). `alguno`: con uno alcanza (GA4 **o** Pixel).
 */
export const REQUERIDOS: {
  [N in Integracion]: {
    modo: "todos" | "alguno";
    campos: readonly CampoDe<N>[];
  };
} = {
  cloudinary: { modo: "todos", campos: ["cloudName", "apiKey", "apiSecret"] },
  whatsapp: { modo: "todos", campos: ["phoneNumberId", "accessToken"] },
  pagopar: { modo: "todos", campos: ["publicKey", "privateKey", "baseUrl"] },
  analitica: { modo: "alguno", campos: ["ga4Id", "metaPixelId"] },
  errores: { modo: "todos", campos: ["reportUrl"] },
};

export type EstadoResumen =
  | { estado: "activa"; fuente: Fuente }
  | { estado: "incompleta"; faltan: string[] }
  | { estado: "apagada" };

/**
 * El estado de una integración a partir de su config efectiva. Lo usan el
 * panel (el cartel de cada tarjeta) y `pnpm preflight` (para decir de dónde
 * sale cada cosa). `faltan` trae nombres de variables de entorno, que es lo
 * que la gente busca en la documentación.
 */
export function resumirIntegracion<N extends Integracion>(
  nombre: N,
  config: ConfigEfectiva<N>
): EstadoResumen {
  const { modo, campos } = REQUERIDOS[nombre] as {
    modo: "todos" | "alguno";
    campos: readonly string[];
  };
  const valores = config.valores as Record<string, string | null>;
  const fuentes = config.fuentes as Record<string, Fuente | null>;
  const cargados = campos.filter((campo) => valores[campo] !== null);
  const fuente: Fuente = cargados.some((campo) => fuentes[campo] === "panel")
    ? "panel"
    : "entorno";

  if (modo === "alguno") {
    return cargados.length > 0
      ? { estado: "activa", fuente }
      : { estado: "apagada" };
  }
  if (cargados.length === campos.length) return { estado: "activa", fuente };
  if (cargados.length === 0 && config.ilegibles.length === 0)
    return { estado: "apagada" };

  const defs: readonly CampoDef[] = CAMPOS[nombre];
  const faltan = campos
    .filter((campo) => valores[campo] === null)
    .map((campo) => defs.find((def) => def.campo === campo)?.env ?? campo);
  return { estado: "incompleta", faltan };
}

/**
 * El lector del `cloud_name` que usa `src/lib/images.ts` sin importar este
 * módulo (se usa en componentes cliente y el presupuesto de JS de la home no
 * da para la tabla de campos). Se registra al cargar este archivo.
 */
(globalThis as { [K: symbol]: unknown })[
  Symbol.for("ecom.integraciones.cloudName")
] = (): string | null => integracion("cloudinary").valores.cloudName;
