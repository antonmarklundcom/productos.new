import { IVA_RATES, type IvaRate } from '@/db/enums';

/**
 * Dinero en guaraníes. Enteros, siempre.
 *
 * Cada función acá adentro asume y verifica enteros: si un float se cuela en el
 * camino del dinero, queremos que explote acá y no en un total mal facturado.
 */

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function assertGs(value: number, label = 'monto'): number {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${label} debe ser un entero en guaraníes, recibí ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} fuera del rango seguro de enteros: ${value}`);
  }
  return value;
}

const GROUPER = new Intl.NumberFormat('es-PY', {
  maximumFractionDigits: 0,
  useGrouping: true,
});

/**
 * `formatGs(1234567)` → `"₲ 1.234.567"`.
 *
 * No usamos `style: 'currency'` porque el símbolo que devuelve ICU para PYG
 * varía entre builds de Node ("Gs." en algunas, "₲" en otras) y el símbolo es
 * parte del diseño. El agrupado sí sale de `Intl` con locale es-PY.
 */
export function formatGs(value: number): string {
  assertGs(value);
  const abs = GROUPER.format(Math.abs(value));
  return `${value < 0 ? '-' : ''}₲ ${abs}`;
}

/** Igual que formatGs pero sin símbolo — para inputs y botones de copiar. */
export function formatGsPlain(value: number): string {
  assertGs(value);
  return GROUPER.format(value);
}

export function isIvaRate(rate: number): rate is IvaRate {
  return (IVA_RATES as readonly number[]).includes(rate);
}

/**
 * IVA **incluido** en un monto (convención PY: el precio de góndola ya lo trae).
 *
 * `ivaIncluded(110000, 10)` → `10000`.
 *
 * Se redondea **por línea**. Redondear sobre el total da diferencias de ₲1–2
 * contra la factura, que es exactamente el tipo de descuadre que después nadie
 * puede explicar.
 */
export function ivaIncluded(lineTotalPyg: number, rate: number): number {
  assertGs(lineTotalPyg, 'lineTotalPyg');
  if (!isIvaRate(rate)) {
    throw new MoneyError(`iva_rate inválida: ${rate} (esperaba 10, 5 o 0)`);
  }
  if (rate === 0) return 0;
  return Math.round((lineTotalPyg * rate) / (100 + rate));
}

export type IvaBreakdown = { iva10Pyg: number; iva5Pyg: number };

/** Suma el IVA incluido línea por línea (nunca sobre el total). */
export function ivaBreakdown(
  lines: ReadonlyArray<{ lineTotalPyg: number; ivaRate: number }>,
): IvaBreakdown {
  let iva10Pyg = 0;
  let iva5Pyg = 0;
  for (const line of lines) {
    const iva = ivaIncluded(line.lineTotalPyg, line.ivaRate);
    if (line.ivaRate === 10) iva10Pyg += iva;
    else if (line.ivaRate === 5) iva5Pyg += iva;
  }
  return { iva10Pyg, iva5Pyg };
}

export function lineTotal(unitPricePyg: number, qty: number): number {
  assertGs(unitPricePyg, 'unitPricePyg');
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new MoneyError(`qty debe ser un entero positivo, recibí ${qty}`);
  }
  return assertGs(unitPricePyg * qty, 'lineTotalPyg');
}
