import { describe, expect, it } from 'vitest';

import { CheckoutError, CouponRejectedError, TotalChangedError } from '@/domain/create-order';
import { CustomerError } from '@/domain/customers';
import { DomainError } from '@/domain/errors';
import { ReceiptError } from '@/domain/receipts';

/**
 * Errores del dominio con código (PLAN.md FASE 2, PR S).
 *
 * Lo que cuida este test es que la conversión no haya roto lo que ya
 * funcionaba: `error.message` sigue siendo el texto que el formulario muestra
 * —lo leen `adminActionError`, las server actions y los logs sin cambiar una
 * línea— y `error.name` sigue siendo el que la matriz de guards y los
 * `instanceof` esperan. Lo que se suma es `code`, que es lo que permite
 * preguntar *qué* pasó sin comparar prosa.
 */

describe('DomainError', () => {
  it('resuelve el texto de la clave', () => {
    expect(new DomainError('error.checkout.carritoVacio').message).toBe('El carrito está vacío.');
  });

  it('interpola los parámetros', () => {
    const error = new DomainError('error.checkout.ruc', { motivo: 'falta el DV' });
    expect(error.message).toBe('RUC inválido: falta el DV');
    expect(error.params).toEqual({ motivo: 'falta el DV' });
  });

  it('guarda el código para poder preguntar sin comparar prosa', () => {
    expect(new DomainError('error.cuenta.nombre').code).toBe('error.cuenta.nombre');
  });
});

describe('las subclases conservan su nombre y su forma', () => {
  it('CheckoutError sigue llevando los issues del carrito', () => {
    const issues = [{ type: 'no_disponible' as const, variantId: 7, name: 'Remera' }];
    const error = new CheckoutError('error.checkout.noDisponible', { issues });

    expect(error.name).toBe('CheckoutError');
    expect(error.issues).toBe(issues);
    expect(error.message).toBe('Algunos productos ya no están disponibles. Revisá tu carrito.');
  });

  it('CheckoutError sin issues arranca con la lista vacía, no undefined', () => {
    expect(new CheckoutError('error.checkout.carritoVacio').issues).toEqual([]);
  });

  it('TotalChangedError conserva los dos montos y arma el texto con los dos', () => {
    const error = new TotalChangedError(500_000, 515_000);

    expect(error.name).toBe('TotalChangedError');
    expect(error).toBeInstanceOf(CheckoutError);
    expect(error.before).toBe(500_000);
    expect(error.after).toBe(515_000);
    // Los montos entran formateados: la plata no se traduce.
    expect(error.message).toContain('₲ 500.000');
    expect(error.message).toContain('₲ 515.000');
  });

  it('CouponRejectedError conserva el motivo, que no se le cuenta a nadie', () => {
    const error = new CouponRejectedError('agotado');

    expect(error.name).toBe('CouponRejectedError');
    expect(error.reason).toBe('agotado');
    // El texto es genérico a propósito: el detalle de por qué se cayó el cupón
    // lo explica el checkout al re-cotizar, no un error a mitad de confirmar.
    expect(error.message).toBe(
      'El código de descuento ya no se puede usar. Revisá el total y confirmá de nuevo.',
    );
  });

  it('ReceiptError y CustomerError siguen siendo distinguibles por nombre', () => {
    // `adminActionError` y las server actions ramifican por `name`: si la
    // conversión los hubiera unificado en "DomainError", todos los mensajes de
    // dominio pasarían a mostrarse como un error genérico.
    expect(new ReceiptError('error.comprobante.vacio').name).toBe('ReceiptError');
    expect(new CustomerError('error.cuenta.nombre').name).toBe('CustomerError');
  });

  it('todas siguen siendo Error, para el catch de siempre', () => {
    for (const error of [
      new CheckoutError('error.checkout.carritoVacio'),
      new ReceiptError('error.comprobante.vacio'),
      new CustomerError('error.cuenta.nombre'),
    ]) {
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(DomainError);
    }
  });
});
