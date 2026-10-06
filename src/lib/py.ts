/**
 * Utilidades específicas de Paraguay: RUC/CI, teléfonos, WhatsApp, fechas.
 */

export const PY_TIMEZONE = 'America/Asuncion';

/** RUC genérico de consumidor final (DNIT). */
export const CONSUMIDOR_FINAL_RUC = '44444401-7';

// ---------------------------------------------------------------------------
// RUC / CI
// ---------------------------------------------------------------------------

/**
 * Dígito verificador módulo 11 sobre la base del RUC.
 * Multiplicadores 2..11 desde el dígito menos significativo.
 */
export function rucCheckDigit(base: string): number {
  const digits = base.replace(/\D/g, '');
  if (digits.length === 0) {
    throw new Error('La base del RUC no tiene dígitos');
  }
  let total = 0;
  let k = 2;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    total += Number(digits[i]) * k;
    k = k === 11 ? 2 : k + 1;
  }
  const rest = total % 11;
  return rest > 1 ? 11 - rest : 0;
}

/** `"80012345"` → `"80012345-2"`. Acepta la base con o sin DV pegado. */
export function formatRuc(base: string): string {
  const digits = base.replace(/\D/g, '');
  return `${digits}-${rucCheckDigit(digits)}`;
}

/**
 * Valida `12345678-9`. También acepta `123456789` (DV pegado) y espacios.
 * Devuelve el RUC normalizado con guion cuando es válido.
 */
export function validateRuc(input: string): { ok: boolean; normalized?: string; reason?: string } {
  const raw = (input ?? '').trim();
  if (raw === '') return { ok: false, reason: 'vacío' };

  const cleaned = raw.replace(/[.\s]/g, '');
  if (!/^\d{3,10}-?\d$/.test(cleaned)) {
    return { ok: false, reason: 'formato inválido' };
  }
  const digits = cleaned.replace(/-/g, '');
  const base = digits.slice(0, -1);
  const dv = Number(digits.slice(-1));

  if (rucCheckDigit(base) !== dv) {
    return { ok: false, reason: 'dígito verificador incorrecto' };
  }
  return { ok: true, normalized: `${base}-${dv}` };
}

export function isConsumidorFinalRuc(input: string): boolean {
  const result = validateRuc(input);
  return result.ok && result.normalized === CONSUMIDOR_FINAL_RUC;
}

/**
 * Cédula de identidad: sólo dígitos, 5 a 8. La CI **no** lleva DV — el DV
 * aparece recién cuando esa CI se usa como base de un RUC de persona física.
 */
export function validateCi(input: string): { ok: boolean; normalized?: string; reason?: string } {
  const digits = (input ?? '').replace(/[.\s-]/g, '');
  if (!/^\d{5,8}$/.test(digits)) {
    return { ok: false, reason: 'la CI debe tener entre 5 y 8 dígitos' };
  }
  return { ok: true, normalized: digits };
}

/** RUC de persona física a partir de la CI: `"1234567"` → `"1234567-4"`. */
export function rucFromCi(ci: string): string {
  const result = validateCi(ci);
  if (!result.ok || !result.normalized) {
    throw new Error(`CI inválida: ${ci}`);
  }
  return formatRuc(result.normalized);
}

export function validateDoc(
  docType: 'RUC' | 'CI' | 'NINGUNO',
  docNumber: string | null | undefined,
): { ok: boolean; normalized?: string | null; reason?: string } {
  if (docType === 'NINGUNO') {
    return { ok: true, normalized: null };
  }
  if (!docNumber) return { ok: false, reason: 'falta el número de documento' };
  return docType === 'RUC' ? validateRuc(docNumber) : validateCi(docNumber);
}

// ---------------------------------------------------------------------------
// Teléfonos
// ---------------------------------------------------------------------------

const PY_COUNTRY_CODE = '595';

/**
 * `normalizePhonePY("0981 123 456")` → `"+595981123456"`.
 *
 * Acepta `0981...`, `981...`, `595981...`, `+595 981...`, con espacios,
 * guiones o paréntesis. Devuelve `null` si no parece un número paraguayo.
 */
export function normalizePhonePY(input: string): string | null {
  if (!input) return null;
  let digits = input.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  digits = digits.startsWith('+') ? digits.slice(1) : digits;
  if (digits === '') return null;

  if (digits.startsWith('00595')) digits = digits.slice(2);
  if (digits.startsWith(PY_COUNTRY_CODE)) digits = digits.slice(PY_COUNTRY_CODE.length);
  // Nacional: 0981..., 021... — el 0 es prefijo de marcación, no parte del número.
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');

  // Móviles: 9XX + 6 dígitos. Fijos: código de área (2–3) + 6–7 dígitos.
  if (!/^\d{8,9}$/.test(digits)) return null;

  return `+${PY_COUNTRY_CODE}${digits}`;
}

export function isMobilePY(phone: string): boolean {
  const normalized = normalizePhonePY(phone);
  return normalized !== null && /^\+5959\d{8}$/.test(normalized);
}

/** `"+595981123456"` → `"(0981) 123-456"` para mostrar. */
export function formatPhonePY(phone: string): string {
  const normalized = normalizePhonePY(phone);
  if (!normalized) return phone;
  const national = normalized.slice(4);
  if (/^9\d{8}$/.test(national)) {
    return `(0${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
  }
  return `(0${national.slice(0, 2)}) ${national.slice(2)}`;
}

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

/** Los deeplinks largos se truncan en iOS; nos quedamos bien por debajo. */
export const WA_TEXT_LIMIT = 1500;

export class PhoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhoneError';
  }
}

/**
 * `waLink("0981123456", "Hola")` → `"https://wa.me/595981123456?text=Hola"`.
 * El texto se recorta a `limit` caracteres (con `…`) antes de codificarse.
 */
export function waLink(phone: string, text = '', limit: number = WA_TEXT_LIMIT): string {
  const normalized = normalizePhonePY(phone);
  if (!normalized) {
    throw new PhoneError(`Número de WhatsApp inválido: ${phone}`);
  }
  const target = normalized.slice(1); // wa.me no lleva el "+"
  const trimmed = text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}…` : text;
  return trimmed === ''
    ? `https://wa.me/${target}`
    : `https://wa.me/${target}?text=${encodeURIComponent(trimmed)}`;
}

/**
 * Un link de "compartir por WhatsApp" **sin destinatario fijo**: abre el
 * selector de contactos del navegador en vez de escribirle a un número en
 * particular. Es lo que usa `/favoritos` para compartir una lista — no hay
 * ningún teléfono al que mandarla, es la propia compradora eligiendo a quién.
 * Mismo recorte de largo que `waLink`, y por el mismo motivo.
 */
export function waShareLink(text: string, limit: number = WA_TEXT_LIMIT): string {
  const trimmed = text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}…` : text;
  return `https://wa.me/?text=${encodeURIComponent(trimmed)}`;
}

// ---------------------------------------------------------------------------
// Fechas — dd/mm/yyyy, America/Asuncion
// ---------------------------------------------------------------------------

const DATE_FMT = new Intl.DateTimeFormat('es-PY', {
  timeZone: PY_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const DATE_TIME_FMT = new Intl.DateTimeFormat('es-PY', {
  timeZone: PY_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatDatePY(date: Date): string {
  return DATE_FMT.format(date).replace(/\//g, '/');
}

export function formatDateTimePY(date: Date): string {
  return DATE_TIME_FMT.format(date).replace(', ', ' ');
}

// ---------------------------------------------------------------------------
// Límites de día y de mes en hora paraguaya
// ---------------------------------------------------------------------------

/**
 * Todo se guarda en UTC (`timezone: "Z"` en el pool), pero "las ventas de hoy"
 * es una pregunta en hora de Asunción. A las 21:00 de Asunción ya es el día
 * siguiente en UTC: sin convertir, el panel mostraría el día equivocado todas
 * las noches, que es justo cuando el dueño cierra la caja.
 *
 * La conversión sale de `Intl` y no de un `-3` hardcodeado. Paraguay eliminó
 * el horario de verano en 2024, pero el offset es un dato político: cuando
 * cambie, cambia la tzdata de Node y esto sigue andando.
 */
const PARTS_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: PY_TIMEZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function pyWallClock(instant: Date): WallClock {
  const parts = PARTS_FMT.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value ?? '0';
    return Number(value);
  };
  // `hour12: false` puede devolver 24 para la medianoche según la versión de ICU.
  const hour = get('hour') % 24;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Cuánto hay que sumarle a un instante UTC para leer el reloj de pared en PY. */
function pyOffsetMs(instant: Date): number {
  const wall = pyWallClock(instant);
  const asIfUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  // Se descartan los milisegundos del instante: el offset siempre es un
  // múltiplo de un minuto.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Reloj de pared paraguayo → el instante UTC que le corresponde. */
function pyWallToUtc(wall: WallClock): Date {
  const guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  // Dos pasadas: la primera usa el offset del instante equivocado. Con un
  // offset fijo la segunda no cambia nada; si algún día vuelve el horario de
  // verano, es la que salva los días del cambio.
  const first = guess - pyOffsetMs(new Date(guess));
  return new Date(guess - pyOffsetMs(new Date(first)));
}

/** Medianoche (00:00:00) del día paraguayo que contiene `instant`. */
export function startOfDayPY(instant: Date = new Date()): Date {
  const wall = pyWallClock(instant);
  return pyWallToUtc({ ...wall, hour: 0, minute: 0, second: 0 });
}

/**
 * Medianoche del día siguiente — el borde superior, exclusivo.
 *
 * Se avanzan 36 h desde el inicio del día y se vuelve al inicio del día: cae
 * siempre adentro del día siguiente, con o sin salto de offset.
 */
export function startOfNextDayPY(instant: Date = new Date()): Date {
  return startOfDayPY(new Date(startOfDayPY(instant).getTime() + 36 * 3600_000));
}

/** Medianoche del día 1 del mes paraguayo que contiene `instant`. */
export function startOfMonthPY(instant: Date = new Date()): Date {
  const wall = pyWallClock(instant);
  return pyWallToUtc({ ...wall, day: 1, hour: 0, minute: 0, second: 0 });
}

/**
 * `"2026-08-07"` (lo que manda un `<input type="date">`) → el instante UTC de
 * esa medianoche paraguaya. `null` si el formato no es el esperado.
 */
export function parsePyDateInput(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const parsed = { year: Number(year), month: Number(month), day: Number(day) };
  if (parsed.month < 1 || parsed.month > 12 || parsed.day < 1 || parsed.day > 31) return null;
  return pyWallToUtc({ ...parsed, hour: 0, minute: 0, second: 0 });
}

/**
 * Igual, pero devuelve el borde superior **exclusivo**: la medianoche
 * siguiente. Así "hasta el 07/08" incluye todo el 7 y el filtro se escribe
 * `created_at < fin` en vez de pelearse con el último segundo del día.
 */
export function parsePyDateInputEnd(value: string | null | undefined): Date | null {
  const start = parsePyDateInput(value);
  return start ? startOfNextDayPY(start) : null;
}
