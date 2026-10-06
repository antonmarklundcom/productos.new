import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readCode } from '../helpers/source';

/**
 * Los mensajes de WhatsApp al comprador.
 *
 * Dos reglas duras, y las dos tienen su test porque las dos se rompen sin que
 * nada falle:
 *
 * 1. **Nunca listan lo comprado.** Un WhatsApp aterriza en una pantalla de
 *    bloqueo, que puede estar sobre una mesa con más gente. Quien compró no
 *    eligió publicar qué compró.
 * 2. **El mensaje de recuperación lleva la fricción resuelta**: a dónde
 *    transferir, cuánto exacto y el link tokenizado. Es lo que sacó al pedido
 *    del camino; repetirlo es todo el trabajo del mensaje.
 */

const BANCO = {
  banco: 'Banco Continental',
  titular: 'Comercial San Roque S.A.',
  ruc: '80012345-6',
  cuenta: '1234567890',
  tipoCuenta: 'Cuenta corriente',
  qrUrl: null,
};

const PEDIDO = {
  orderNumber: 'PY-000123',
  customerName: 'Rosa Giménez',
  customerPhone: '+595981123456',
  accessToken: 'a'.repeat(64),
  totalPyg: 245_000,
  status: 'pendiente_pago' as const,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load() {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://tienda.com.py');
  return import('../../src/domain/order-messages');
}

describe('mensaje de recuperación', () => {
  it('lleva el total exacto, los datos del banco y el link tokenizado', async () => {
    const { recoveryMessage } = await load();
    const message = recoveryMessage(PEDIDO, BANCO);

    expect(message).toContain('PY-000123');
    expect(message).toContain('₲ 245.000');
    expect(message).toContain('Banco Continental');
    expect(message).toContain('1234567890');
    expect(message).toContain(`https://tienda.com.py/pedido/PY-000123?t=${PEDIDO.accessToken}`);
  });

  it('sin datos bancarios cargados se manda igual, sin inventar un banco', async () => {
    const { recoveryMessage } = await load();
    const message = recoveryMessage(PEDIDO, null);

    expect(message).toContain('₲ 245.000');
    expect(message).not.toMatch(/Banco|Titular|Cuenta:/);
  });

  it('a un pedido vencido no le promete la mercadería', async () => {
    const { recoveryMessage } = await load();
    const message = recoveryMessage({ ...PEDIDO, status: 'vencido' }, BANCO);

    // La reserva ya venció y la disponibilidad se calcula en vivo: prometer
    // el producto sería prometer stock que quizás vendió otro.
    expect(message).toMatch(/venci/i);
    expect(message).toMatch(/disponibilidad/i);
  });

  it('a un comprobante rechazado lo manda a leer el motivo, sin repetirlo', async () => {
    const { recoveryMessage } = await load();
    const message = recoveryMessage({ ...PEDIDO, status: 'rechazado' }, BANCO);

    expect(message).toMatch(/no pudimos validar el comprobante/i);
    // El motivo lo escribió el dueño y ella lo lee en la página del pedido.
    // Repetirlo por WhatsApp es contar en una pantalla de bloqueo por qué no
    // le aceptaron un pago.
    expect(message).toContain(`https://tienda.com.py/pedido/PY-000123?t=${PEDIDO.accessToken}`);
  });

  it('entra cómodo en un deeplink de wa.me', async () => {
    const { buyerWaLink, recoveryMessage } = await load();
    const href = buyerWaLink(PEDIDO, recoveryMessage(PEDIDO, BANCO));

    expect(href).toMatch(/^https:\/\/wa\.me\/595981123456\?text=/);
    // `waLink` recorta a ~1500 caracteres; si el mensaje llegara ahí, se
    // perdería el link, que es lo último que va.
    expect(recoveryMessage(PEDIDO, BANCO).length).toBeLessThan(1000);
  });

  it('un teléfono que no normaliza no rompe el listado, sólo se queda sin botón', async () => {
    const { buyerWaLink } = await load();
    expect(buyerWaLink({ ...PEDIDO, customerPhone: 'no-es-un-teléfono' }, 'hola')).toBeNull();
  });
});

describe('lo que los mensajes no dicen', () => {
  it('el tipo de entrada no tiene ítems: no es una regla, es la firma', async () => {
    const code = await readCode(path.join('src', 'domain', 'order-messages.ts'));

    // Si alguien quisiera itemizar tendría que cambiar el tipo primero, y ahí
    // se topa con el comentario que explica por qué no.
    expect(code).not.toMatch(/orderItems|nameSnapshot|items\s*:/);
  });
});

describe('la pantalla de "por cobrar" no toca el stock', () => {
  it('ni la consulta ni la página importan nada que reserve o transicione', async () => {
    // ARCH.md §2: la disponibilidad se calcula en vivo. Extender la reserva de
    // un pedido que se va a "empujar" le bloquea la unidad a todos los demás
    // compradores, en silencio. Se deja vencer, y si el pago llega
    // `transitionOrder` re-asegura el stock o se niega (§4.1).
    const page = await readCode(
      path.join('src', 'app', 'admin', '(panel)', 'pedidos', 'por-cobrar', 'page.tsx'),
    );

    expect(page).not.toMatch(/reserveStock|transitionOrder|stockReservations|reservedUntil:/);
  });
});
