import { describe, expect, it } from 'vitest';

import { shippingMethodsWithoutZones } from '@/domain/admin-shipping-methods';
import {
  IMPLICIT_SHIPPING_METHOD_SLUG,
  resolveShippingMethods,
  selectShippingMethod,
  type ShippingMethodOption,
  type ShippingMethodRow,
  type ShippingQuote,
} from '@/domain/shipping';

/**
 * Métodos de envío (FASE 3), la parte que no toca la base.
 *
 * Lo que se prueba acá es la traducción de filas a opciones cotizadas, que es
 * donde vive la plata: qué método aplica a qué ciudad, cuánto sale cada uno, y
 * qué medios de pago habilita. La cotización de la zona, las transacciones y
 * la re-validación al confirmar tienen sus propios tests de integración —
 * `resolveShippingMethods` es pura a propósito, para que estas reglas se
 * puedan afirmar sin MySQL.
 *
 * El caso que más importa es el primero: **la tienda sin métodos
 * configurados**, que es el estado de toda tienda ya clonada. Si eso deja de
 * comportarse como el checkout de siempre, se rompe la actualización de todas
 * las tiendas que ya están vendiendo.
 */

const ZONA_ASUNCION: ShippingQuote = {
  zoneId: 1,
  zoneName: 'Asunción',
  shippingPyg: 25_000,
  isFree: false,
  match: 'exacta',
  freeThresholdPyg: 500_000,
};

const ZONA_MAS_CARA: ShippingQuote = {
  zoneId: 3,
  zoneName: 'Interior',
  shippingPyg: 60_000,
  isFree: false,
  match: 'mas_cara',
  freeThresholdPyg: null,
};

const SIN_ZONAS: ShippingQuote = {
  zoneId: null,
  zoneName: 'Sin zonas configuradas',
  shippingPyg: 0,
  isFree: true,
  match: 'sin_zonas',
  freeThresholdPyg: null,
};

function row(overrides: Partial<ShippingMethodRow> = {}): ShippingMethodRow {
  return {
    id: overrides.id ?? 1,
    slug: overrides.slug ?? 'courier',
    name: overrides.name ?? 'Courier nacional',
    kind: overrides.kind ?? 'courier',
    pricing: overrides.pricing ?? 'zona',
    fixedPricePyg: overrides.fixedPricePyg ?? null,
    zoneIds: overrides.zoneIds ?? [],
    allowedPaymentMethods: overrides.allowedPaymentMethods ?? ['transferencia', 'tarjeta'],
    description: overrides.description ?? null,
    isActive: overrides.isActive ?? true,
    position: overrides.position ?? 0,
  };
}

describe('una tienda sin métodos configurados sigue siendo la de siempre', () => {
  it('devuelve un único método implícito con el precio de la zona', () => {
    const [metodo, ...resto] = resolveShippingMethods([], ZONA_ASUNCION);

    expect(resto).toEqual([]);
    expect(metodo).toMatchObject({
      id: null,
      slug: IMPLICIT_SHIPPING_METHOD_SLUG,
      shippingPyg: 25_000,
      isFree: false,
    });
  });

  it('el implícito habilita los tres medios de pago, como antes de la tabla', () => {
    const [metodo] = resolveShippingMethods([], ZONA_ASUNCION);

    expect(metodo?.allowedPaymentMethods).toEqual([
      'transferencia',
      'contra_entrega',
      'tarjeta',
    ]);
  });

  it('el implícito hereda el envío gratis de la zona', () => {
    const [metodo] = resolveShippingMethods(
      [],
      { ...ZONA_ASUNCION, shippingPyg: 0, isFree: true },
    );

    expect(metodo).toMatchObject({ shippingPyg: 0, isFree: true });
  });

  it('con la tienda sin zonas tampoco cobra nada: el estado recién clonado', () => {
    const [metodo] = resolveShippingMethods([], SIN_ZONAS);

    expect(metodo).toMatchObject({ shippingPyg: 0, isFree: true });
  });

  it('un método inactivo no cuenta: la tienda vuelve al implícito', () => {
    const opciones = resolveShippingMethods([row({ isActive: false })], ZONA_ASUNCION);

    expect(opciones).toHaveLength(1);
    expect(opciones[0]?.id).toBeNull();
  });
});

describe('precio de cada método', () => {
  it('`zona` cobra lo que salga de la zona, con su umbral de envío gratis ya aplicado', () => {
    const gratis = { ...ZONA_ASUNCION, shippingPyg: 0, isFree: true };
    const [metodo] = resolveShippingMethods([row({ pricing: 'zona' })], gratis);

    expect(metodo).toMatchObject({ shippingPyg: 0, isFree: true });
  });

  it('`fijo` cobra su tarifa plana aunque la zona diga otra cosa', () => {
    const [metodo] = resolveShippingMethods(
      [row({ pricing: 'fijo', fixedPricePyg: 15_000 })],
      ZONA_ASUNCION,
    );

    expect(metodo?.shippingPyg).toBe(15_000);
  });

  it('`fijo` no hereda el envío gratis de la zona: una tarifa plana no depende del monto', () => {
    const gratis = { ...ZONA_ASUNCION, shippingPyg: 0, isFree: true };
    const [metodo] = resolveShippingMethods(
      [row({ pricing: 'fijo', fixedPricePyg: 15_000 })],
      gratis,
    );

    expect(metodo).toMatchObject({ shippingPyg: 15_000, isFree: false });
  });

  it('`retiro` cuesta ₲0 pase lo que pase', () => {
    const [metodo] = resolveShippingMethods(
      [row({ kind: 'retiro', pricing: 'zona' })],
      ZONA_ASUNCION,
    );

    expect(metodo).toMatchObject({ shippingPyg: 0, isFree: true });
  });

  it('una tarifa plana negativa cargada a mano no devuelve plata: se piso en ₲0', () => {
    const [metodo] = resolveShippingMethods(
      [row({ pricing: 'fijo', fixedPricePyg: -5_000 })],
      ZONA_ASUNCION,
    );

    expect(metodo?.shippingPyg).toBe(0);
  });
});

describe('a qué ciudades aplica cada método', () => {
  it('sin zonas declaradas aplica siempre: es el courier que llega a todos lados', () => {
    const opciones = resolveShippingMethods([row({ zoneIds: [] })], ZONA_MAS_CARA);

    expect(opciones.map((option) => option.id)).toEqual([1]);
  });

  it('con zonas declaradas aplica sólo si la ciudad cayó en una de ellas', () => {
    const moto = row({ id: 2, slug: 'moto', kind: 'local', zoneIds: [1] });

    expect(resolveShippingMethods([moto], ZONA_ASUNCION)).toHaveLength(1);
    expect(resolveShippingMethods([moto], { ...ZONA_ASUNCION, zoneId: 9 })).toHaveLength(0);
  });

  it('una ciudad cotizada "por descarte" no habilita la moto del barrio', () => {
    // `mas_cara` significa que la ciudad no está en ninguna lista: se le cobró
    // la tarifa más alta. Eso no la convierte en una ciudad donde el comercio
    // reparte, y ofrecerle contra entrega ahí es prometer una visita que nadie
    // va a hacer.
    const moto = row({ id: 2, kind: 'local', zoneIds: [ZONA_MAS_CARA.zoneId ?? 0] });

    expect(resolveShippingMethods([moto], ZONA_MAS_CARA)).toEqual([]);
  });

  it('`retiro` ignora las zonas: no viaja a ningún lado', () => {
    const retiro = row({ id: 5, kind: 'retiro', zoneIds: [999] });

    expect(resolveShippingMethods([retiro], ZONA_MAS_CARA)).toHaveLength(1);
  });

  it('respeta el orden del panel y no el de la consulta', () => {
    const opciones = resolveShippingMethods(
      [row({ id: 1, slug: 'a', position: 2 }), row({ id: 2, slug: 'b', position: 1 })],
      ZONA_ASUNCION,
    );

    expect(opciones.map((option) => option.id)).toEqual([2, 1]);
  });
});

describe('medios de pago de cada método', () => {
  it('devuelve los declarados, siempre en el orden del enum', () => {
    const [metodo] = resolveShippingMethods(
      [row({ allowedPaymentMethods: ['tarjeta', 'transferencia'] })],
      ZONA_ASUNCION,
    );

    expect(metodo?.allowedPaymentMethods).toEqual(['transferencia', 'tarjeta']);
  });

  it('descarta un método sin ningún medio de pago válido', () => {
    // No se puede elegir sin elegir cómo pagar: devolverlo dibujaría en el
    // checkout una opción que rebota al confirmar. El ABM no deja crearla;
    // esto cubre la fila editada a mano.
    const opciones = resolveShippingMethods(
      [row({ allowedPaymentMethods: [] }), row({ id: 2, slug: 'ok' })],
      ZONA_ASUNCION,
    );

    expect(opciones.map((option) => option.id)).toEqual([2]);
  });
});

describe('cuál de las opciones se usa', () => {
  const opciones: ShippingMethodOption[] = resolveShippingMethods(
    [
      row({ id: 1, slug: 'courier', position: 0 }),
      row({
        id: 2,
        slug: 'moto',
        kind: 'local',
        position: 1,
        allowedPaymentMethods: ['contra_entrega'],
      }),
    ],
    ZONA_ASUNCION,
  );

  it('sin id elegido toma el primero por posición, no el que convenga al pago', () => {
    const elegido = selectShippingMethod(opciones, null);

    expect(elegido).toEqual({ ok: true, method: opciones[0] });
  });

  it('con id elegido devuelve ese', () => {
    const elegido = selectShippingMethod(opciones, 2);

    expect(elegido.ok && elegido.method.id).toBe(2);
  });

  it('un id que no está entre los válidos se rechaza, no se cae al primero', () => {
    expect(selectShippingMethod(opciones, 99)).toEqual({ ok: false, reason: 'no_disponible' });
  });

  it('sin ninguna opción válida el rechazo lo dice: la ciudad no tiene entrega', () => {
    expect(selectShippingMethod([], null)).toEqual({ ok: false, reason: 'sin_metodos' });
  });
});

describe('métodos activos que no le aparecen a nadie', () => {
  const metodo = (
    overrides: Partial<{ name: string; kind: 'courier' | 'local' | 'retiro'; zoneIds: number[]; isActive: boolean }>,
  ) => ({
    name: overrides.name ?? 'Moto',
    kind: overrides.kind ?? ('local' as const),
    zoneIds: overrides.zoneIds ?? [1],
    isActive: overrides.isActive ?? true,
  });

  it('nombra el método cuyas zonas están todas apagadas', () => {
    expect(shippingMethodsWithoutZones([metodo({ zoneIds: [7] })], [1, 2])).toEqual(['Moto']);
  });

  it('no nombra al que tiene al menos una zona activa', () => {
    expect(shippingMethodsWithoutZones([metodo({ zoneIds: [2, 7] })], [1, 2])).toEqual([]);
  });

  it('no nombra al que no declara zonas: aplica a todas las activas', () => {
    expect(shippingMethodsWithoutZones([metodo({ zoneIds: [] })], [1])).toEqual([]);
  });

  it('no nombra a `retiro`: no depende de zonas por diseño', () => {
    expect(shippingMethodsWithoutZones([metodo({ kind: 'retiro', zoneIds: [7] })], [1])).toEqual([]);
  });

  it('no nombra a los desactivados: ya no le aparecen a nadie a propósito', () => {
    expect(shippingMethodsWithoutZones([metodo({ zoneIds: [7], isActive: false })], [1])).toEqual(
      [],
    );
  });
});
