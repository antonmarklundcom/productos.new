import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { integrationSettings } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { t, type MessageKey, type Params } from "@/i18n";
import { log, mensajeDe } from "@/lib/log";
import { normalizePhonePY } from "@/lib/py";

import {
  CAMPOS,
  INTEGRACIONES,
  filasEnFoto,
  fotoVencida,
  invalidarIntegraciones,
  marcarRecarga,
  publicarFoto,
  recargaEnCurso,
  registrarCargador,
  resolverIntegracion,
  resumirIntegracion,
  type CampoDef,
  type EstadoResumen,
  type FilaIntegracion,
  type Fuente,
  type Integracion,
} from "./integraciones";
import {
  SecretBoxDecryptError,
  cifrarSecreto,
  descifrarSecreto,
  enmascararSecreto,
  secretBoxDisponible,
} from "./secret-box";
import { ETIQUETA_CAMPO } from "./integraciones-textos";

/**
 * La mitad del servidor de `src/lib/integraciones.ts`: lee la tabla
 * `integration_settings`, descifra los secretos, publica la foto en memoria y
 * guarda lo que manda `/admin/integraciones`.
 *
 * Tres reglas:
 *
 * 1. **Leer nunca tira.** Sin `DATABASE_URL`, con la tabla todavía sin crear
 *    (una tienda que actualizó el código antes de migrar), con la base caída o
 *    sin `SESSION_SECRET` válido: la foto queda vacía (o la última buena) y
 *    todo sale del entorno, que es exactamente la tienda de antes.
 * 2. **Un secreto no sale de acá en claro** salvo hacia la foto del proceso.
 *    `estadoParaPanel()` —lo único que ve el navegador— trae `••••1234`, y el
 *    log trae nombres de campos, nunca valores.
 * 3. **Sin `SESSION_SECRET` válido no se lee ni se guarda nada**: guardar
 *    tira un error que el panel muestra, y leer ignora la tabla entera.
 */

export class IntegracionError extends DomainError {
  constructor(code: MessageKey, params?: Params) {
    super(code, params);
    this.name = "IntegracionError";
  }
}

/** El contexto de HKDF/AAD de cada secreto: una clave por campo. */
export function contextoSecreto(nombre: Integracion, campo: string): string {
  return `integraciones/${nombre}/${campo}`;
}

type FilaCruda = {
  integration: string;
  data: unknown;
  secrets: unknown;
  updatedAt: Date | null;
  updatedByUserId: number | null;
};

function comoTextos(valor: unknown): Record<string, string> {
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) return {};
  return Object.fromEntries(
    Object.entries(valor as Record<string, unknown>).filter(
      (entrada): entrada is [string, string] => typeof entrada[1] === "string",
    ),
  );
}

/**
 * Una fila cruda → lo que va a la foto: valores en claro, y los secretos que
 * no abrieron en `ilegibles`. Pura salvo por el descifrado (que depende de
 * `env`), para poder testearla sin base.
 */
export function descifrarFila(
  nombre: Integracion,
  fila: Pick<FilaCruda, "data" | "secrets">,
  env: Record<string, string | undefined> = process.env,
): FilaIntegracion {
  const defs: readonly CampoDef[] = CAMPOS[nombre];
  const data = comoTextos(fila.data);
  const secretos = comoTextos(fila.secrets);
  const valores: Record<string, string> = {};
  const ilegibles: string[] = [];

  for (const def of defs) {
    if (def.secreto) {
      const blob = secretos[def.campo];
      if (!blob) continue;
      try {
        valores[def.campo] = descifrarSecreto(blob, contextoSecreto(nombre, def.campo), env);
      } catch (error) {
        if (!(error instanceof SecretBoxDecryptError)) throw error;
        ilegibles.push(def.campo);
      }
      continue;
    }
    const valor = data[def.campo];
    if (valor !== undefined && valor.trim() !== "") valores[def.campo] = valor;
  }

  return { valores, ilegibles };
}

async function leerFilasCrudas(): Promise<FilaCruda[]> {
  return getDb().select().from(integrationSettings);
}

/**
 * Las filas descifradas, o por qué no se pudieron leer. Para `pnpm preflight`,
 * que tiene que decir de dónde sale cada valor sin depender de la foto.
 * Nunca tira.
 */
export async function leerIntegracionesDelPanel(
  env: Record<string, string | undefined> = process.env,
): Promise<
  | { lectura: "ok"; filas: Partial<Record<Integracion, FilaIntegracion>> }
  | { lectura: "fallo"; motivo: string }
> {
  if ((env.DATABASE_URL ?? "").trim() === "") return { lectura: "fallo", motivo: "sin DATABASE_URL" };
  if (!secretBoxDisponible(env)) {
    return { lectura: "fallo", motivo: "SESSION_SECRET no es válido, así que no se puede descifrar" };
  }
  try {
    const filas: Partial<Record<Integracion, FilaIntegracion>> = {};
    for (const fila of await leerFilasCrudas()) {
      if (!(INTEGRACIONES as readonly string[]).includes(fila.integration)) continue;
      const nombre = fila.integration as Integracion;
      filas[nombre] = descifrarFila(nombre, fila, env);
    }
    return { lectura: "ok", filas };
  } catch (error) {
    return { lectura: "fallo", motivo: mensajeDe(error) };
  }
}

let avisoSinClave = false;

/**
 * Carga la foto desde la base si está vencida (o si `forzar`). Nunca tira.
 *
 * Los caminos que tocan plata o credenciales la llaman antes de leer:
 * `await cargarIntegraciones()` es gratis mientras la foto esté fresca.
 */
export async function cargarIntegraciones(opciones: { forzar?: boolean } = {}): Promise<void> {
  if (!opciones.forzar && !fotoVencida()) return;

  const enCurso = recargaEnCurso();
  if (enCurso) return enCurso;

  const recarga = (async () => {
    // Sin base configurada (un script, un test unitario) no hay nada que leer.
    if ((process.env.DATABASE_URL ?? "").trim() === "") {
      publicarFoto({});
      return;
    }
    if (!secretBoxDisponible()) {
      if (!avisoSinClave) {
        avisoSinClave = true;
        log.warn(
          "SESSION_SECRET no es válido: se ignora la configuración de integraciones del panel " +
            "y todo sale del entorno",
        );
      }
      publicarFoto({});
      return;
    }

    try {
      const filas = await leerFilasCrudas();
      const nuevas: Partial<Record<Integracion, FilaIntegracion>> = {};
      for (const fila of filas) {
        if (!(INTEGRACIONES as readonly string[]).includes(fila.integration)) continue;
        const nombre = fila.integration as Integracion;
        const descifrada = descifrarFila(nombre, fila);
        if (descifrada.ilegibles.length > 0) {
          log.warn("hay secretos de integraciones que no se pueden descifrar (¿cambió SESSION_SECRET?)", {
            integracion: nombre,
            campos: descifrada.ilegibles,
          });
        }
        nuevas[nombre] = descifrada;
      }
      publicarFoto(nuevas);
    } catch (error) {
      // La base caída o la tabla sin migrar: se queda la última foto buena
      // (vacía, la primera vez) y se reintenta cuando vuelva a vencer.
      log.warn("no se pudo leer la configuración de integraciones; sigue la anterior", {
        error: mensajeDe(error),
      });
      publicarFoto(filasEnFoto());
    }
  })();

  marcarRecarga(recarga);
  try {
    await recarga;
  } finally {
    marcarRecarga(null);
  }
}

registrarCargador(() => cargarIntegraciones());

// ---------------------------------------------------------------------------
// Lo que ve el panel
// ---------------------------------------------------------------------------

export type CampoPanel = {
  campo: string;
  env: string;
  secreto: boolean;
  /** Valor cargado en el panel. **Siempre `null` para un secreto.** */
  valorPanel: string | null;
  /** `••••1234` si hay un secreto cargado en el panel. */
  mascara: string | null;
  /** El secreto está guardado pero no se puede descifrar. */
  ilegible: boolean;
  /** De dónde sale el valor que usa la tienda hoy. */
  fuente: Fuente | null;
  /** ¿Hay algo en la variable de entorno? (sin el valor, por si es secreto) */
  enEntorno: boolean;
};

export type EstadoIntegracion = {
  integracion: Integracion;
  campos: CampoPanel[];
  actualizado: Date | null;
  /** Hay una fila guardada desde el panel. */
  enPanel: boolean;
  /** Activa (y de dónde), incompleta o apagada: el cartel de la tarjeta. */
  resumen: EstadoResumen;
};

/**
 * El estado de cada integración, **sin un solo secreto**: es lo que se le
 * manda a la página. Lee la base directo (no la foto) para mostrar lo que
 * quedó guardado.
 */
export async function estadoParaPanel(
  env: Record<string, string | undefined> = process.env,
): Promise<{ estados: EstadoIntegracion[]; claveDisponible: boolean }> {
  const claveDisponible = secretBoxDisponible(env);
  const filas = claveDisponible ? await leerFilasCrudas() : [];

  const estados = INTEGRACIONES.map((nombre): EstadoIntegracion => {
    const cruda = filas.find((fila) => fila.integration === nombre);
    const fila = cruda ? descifrarFila(nombre, cruda, env) : undefined;
    const efectiva = resolverIntegracion(nombre, fila, env);
    const fuentes = efectiva.fuentes as Record<string, Fuente | null>;
    const defs: readonly CampoDef[] = CAMPOS[nombre];

    return {
      integracion: nombre,
      enPanel: cruda !== undefined,
      actualizado: cruda?.updatedAt ?? null,
      resumen: resumirIntegracion(nombre, efectiva),
      campos: defs.map((def): CampoPanel => {
        const delPanel = fila?.valores[def.campo] ?? null;
        return {
          campo: def.campo,
          env: def.env,
          secreto: def.secreto === true,
          valorPanel: def.secreto ? null : delPanel,
          mascara: def.secreto && delPanel ? enmascararSecreto(delPanel) : null,
          ilegible: fila?.ilegibles.includes(def.campo) ?? false,
          fuente: fuentes[def.campo] ?? null,
          enEntorno: (env[def.env] ?? "").trim() !== "",
        };
      }),
    };
  });

  return { estados, claveDisponible };
}

// ---------------------------------------------------------------------------
// Guardar
// ---------------------------------------------------------------------------

/** Formato de cada campo no secreto. Vacío siempre vale: es "borrar". */
const FORMATOS: Record<string, { re: RegExp; clave: MessageKey } | undefined> = {
  cloudName: { re: /^[A-Za-z0-9_-]{1,100}$/, clave: "adminError.integraciones.formato" },
  apiKey: { re: /^[A-Za-z0-9_-]{1,100}$/, clave: "adminError.integraciones.formato" },
  folderPrefix: { re: /^[A-Za-z0-9_/-]{1,60}$/, clave: "adminError.integraciones.formato" },
  phoneNumberId: { re: /^\d{5,30}$/, clave: "adminError.integraciones.formato" },
  apiVersion: { re: /^v\d{1,3}\.\d{1,3}$/, clave: "adminError.integraciones.formato" },
  publicKey: { re: /^[A-Za-z0-9_-]{1,200}$/, clave: "adminError.integraciones.formato" },
  // Mismos regex que `src/lib/analytics.ts`: un id raro no se guarda.
  ga4Id: { re: /^G-[A-Z0-9]{4,20}$/, clave: "adminError.integraciones.ga4" },
  metaPixelId: { re: /^[0-9]{5,20}$/, clave: "adminError.integraciones.pixel" },
};

const PLANTILLA_RE = /^[a-z0-9_]{1,512}$/;

/** Valida y normaliza un campo no secreto. `""` = borrar. */
export function normalizarCampo(campo: string, crudo: string): string {
  const valor = crudo.trim();
  if (valor === "") return "";
  // En el mensaje va la etiqueta del formulario, no el nombre interno.
  const etiqueta = ETIQUETA_CAMPO[campo];
  const nombreVisible = etiqueta ? t(etiqueta) : campo;

  if (campo.startsWith("plantilla")) {
    if (!PLANTILLA_RE.test(valor)) {
      throw new IntegracionError("adminError.integraciones.plantilla", { campo: nombreVisible });
    }
    return valor;
  }
  if (campo === "numeroComercio") {
    const telefono = normalizePhonePY(valor);
    if (!telefono) throw new IntegracionError("adminError.integraciones.whatsapp");
    return telefono;
  }
  if (campo === "baseUrl" || campo === "reportUrl") {
    let url: URL;
    try {
      url = new URL(valor);
    } catch {
      throw new IntegracionError("adminError.integraciones.https", { campo: nombreVisible });
    }
    if (url.protocol !== "https:") throw new IntegracionError("adminError.integraciones.https", { campo: nombreVisible });
    // `PAGOPAR_BASE_URL` va sin barra final: el path lo pone el cliente.
    return campo === "baseUrl" ? valor.replace(/\/+$/, "") : url.toString();
  }
  const formato = FORMATOS[campo];
  if (formato && !formato.re.test(valor)) throw new IntegracionError(formato.clave, { campo: nombreVisible });
  return valor;
}

export type CambiosIntegracion = {
  /** campo → valor. Un secreto vacío o ausente **no** se toca. */
  valores: Record<string, string | undefined>;
  /** Secretos a borrar explícitamente. */
  borrarSecretos?: readonly string[];
};

/**
 * Guarda una integración. Upsert de su fila, con la validación adentro.
 *
 * - Campo no secreto: lo que venga (vacío = se borra y vuelve a mandar el
 *   entorno).
 * - Secreto: vacío = se deja el que está (el navegador nunca lo tuvo, así que
 *   un formulario reenviado no puede borrarlo sin querer); con valor = se
 *   reemplaza; en `borrarSecretos` = se borra.
 *
 * Devuelve los **nombres** de los campos que cambiaron — nunca valores — para
 * el log de auditoría y para el mensaje del panel.
 */
export async function guardarIntegracion(
  nombre: Integracion,
  cambios: CambiosIntegracion,
  actor: { userId: number | null },
  env: Record<string, string | undefined> = process.env,
): Promise<{ cambiados: string[] }> {
  if (!secretBoxDisponible(env)) throw new IntegracionError("adminError.integraciones.sinClave");

  const defs: readonly CampoDef[] = CAMPOS[nombre];
  const conocidos = new Set(defs.map((def) => def.campo));
  for (const campo of [...Object.keys(cambios.valores), ...(cambios.borrarSecretos ?? [])]) {
    if (!conocidos.has(campo)) throw new IntegracionError("adminError.integraciones.campo", { campo });
  }

  // Validar todo antes de abrir la transacción: un campo malo no guarda nada.
  const normalizados: Record<string, string> = {};
  for (const def of defs) {
    const crudo = cambios.valores[def.campo];
    if (crudo === undefined || def.secreto) continue;
    normalizados[def.campo] = normalizarCampo(def.campo, crudo);
  }

  const cambiados = await getDb().transaction(async (tx) => {
    const [fila] = await tx
      .select()
      .from(integrationSettings)
      .where(eq(integrationSettings.integration, nombre))
      .limit(1)
      .for("update");

    const data = comoTextos(fila?.data);
    const secretos = comoTextos(fila?.secrets);
    const tocados: string[] = [];

    for (const def of defs) {
      if (def.secreto) {
        const nuevo = (cambios.valores[def.campo] ?? "").trim();
        if (nuevo !== "") {
          secretos[def.campo] = cifrarSecreto(nuevo, contextoSecreto(nombre, def.campo), env);
          tocados.push(def.campo);
        } else if (cambios.borrarSecretos?.includes(def.campo) && secretos[def.campo] !== undefined) {
          delete secretos[def.campo];
          tocados.push(def.campo);
        }
        continue;
      }
      const nuevo = normalizados[def.campo];
      if (nuevo === undefined) continue;
      const anterior = data[def.campo] ?? "";
      if (nuevo === anterior) continue;
      if (nuevo === "") delete data[def.campo];
      else data[def.campo] = nuevo;
      tocados.push(def.campo);
    }

    if (tocados.length === 0) return tocados;

    if (fila) {
      await tx
        .update(integrationSettings)
        .set({ data, secrets: secretos, updatedByUserId: actor.userId })
        .where(eq(integrationSettings.integration, nombre));
    } else {
      await tx
        .insert(integrationSettings)
        .values({ integration: nombre, data, secrets: secretos, updatedByUserId: actor.userId });
    }
    return tocados;
  });

  // La auditoría de siempre para lo que no es un pedido: el log del hPanel,
  // con quién y qué campos. Nunca valores (y `log` además redacta por nombre).
  if (cambiados.length > 0) {
    log.info("integración guardada desde el panel", {
      integracion: nombre,
      campos: cambiados,
      actorUserId: actor.userId,
    });
  }

  invalidarIntegraciones();
  await cargarIntegraciones({ forzar: true });
  return { cambiados };
}

/**
 * Borra la fila entera de una integración: vuelve a mandar el entorno (o
 * queda apagada si el entorno tampoco la tiene).
 */
export async function borrarIntegracion(
  nombre: Integracion,
  actor: { userId: number | null },
): Promise<void> {
  await getDb().delete(integrationSettings).where(eq(integrationSettings.integration, nombre));
  log.info("integración borrada desde el panel (vuelve al entorno)", {
    integracion: nombre,
    actorUserId: actor.userId,
  });
  invalidarIntegraciones();
  await cargarIntegraciones({ forzar: true });
}
