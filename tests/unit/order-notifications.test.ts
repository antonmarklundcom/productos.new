import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { newOrderNoticeBody, resolveOwnerNotifier } from '@/domain/order-notifications';

/**
 * El texto del aviso que recibe el comercio.
 *
 * Lo lee el dueño, no la compradora: por eso lleva el total y el método de
 * pago. Lo que no lleva —y este test lo fija— es el detalle de lo comprado ni
 * el teléfono de nadie: el mensaje llega a la pantalla de bloqueo del celular y
 * el detalle está en el panel, a un toque.
 */

const notice = {
  orderId: 12,
  orderNumber: 'PY-000042',
  customerName: 'Rosa Giménez',
  totalPyg: 1_250_000,
  paymentMethod: 'transferencia' as const,
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://tienda.com.py');
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (SITE_URL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
});

describe('newOrderNoticeBody', () => {
  it('lleva número, total en guaraníes, método y quién compró', () => {
    const body = newOrderNoticeBody(notice);

    expect(body).toContain('PY-000042');
    expect(body).toContain('₲ 1.250.000');
    expect(body).toContain('Transferencia / QR');
    expect(body).toContain('Rosa Giménez');
  });

  it('el link al panel es absoluto: un /admin/... suelto no es clickeable en WhatsApp', () => {
    expect(newOrderNoticeBody(notice)).toContain('https://tienda.com.py/admin/pedidos/12');
  });

  it('sin NEXT_PUBLIC_SITE_URL manda el aviso sin línea de link, no con una a medias', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');

    const body = newOrderNoticeBody(notice);

    expect(body).toContain('PY-000042');
    expect(body).not.toContain('/admin/pedidos');
    expect(body.split('\n')).toHaveLength(1);
  });

  it('nombra el método de pago de cada camino', () => {
    expect(newOrderNoticeBody({ ...notice, paymentMethod: 'tarjeta' })).toContain('Tarjeta');
    expect(newOrderNoticeBody({ ...notice, paymentMethod: 'contra_entrega' })).toContain(
      'Contra entrega',
    );
  });

  it('no filtra datos que el dueño ya tiene en el panel', () => {
    const body = newOrderNoticeBody(notice);

    // Ni ítems ni teléfono: el mensaje es un aviso, no un resumen del pedido.
    expect(body).not.toMatch(/\+595/);
    expect(body.length).toBeLessThan(200);
  });
});

describe('resolveOwnerNotifier — sin variables, apagado', () => {
  beforeEach(() => {
    // El sender de consola sólo existe fuera de producción; el resto de los
    // casos se apagan por su cuenta.
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('WHATSAPP_CLOUD_PHONE_NUMBER_ID', '');
    vi.stubEnv('WHATSAPP_CLOUD_ACCESS_TOKEN', '');
    vi.stubEnv('WHATSAPP_CLOUD_TEMPLATE_NAME', '');
    vi.stubEnv('WHATSAPP_CLOUD_TEMPLATE_PEDIDO_NUEVO', '');
  });

  it('sin WHATSAPP_NUMBER no hay a quién avisarle', () => {
    vi.stubEnv('WHATSAPP_NUMBER', '');

    expect(resolveOwnerNotifier()).toBeNull();
  });

  it('en dev, con número y sin credenciales, avisa por la consola', () => {
    vi.stubEnv('WHATSAPP_NUMBER', '+595981123456');

    expect(resolveOwnerNotifier()?.sender.channel).toBe('consola');
  });

  it('en producción, sin credenciales de Cloud, queda apagado', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WHATSAPP_NUMBER', '+595981123456');

    expect(resolveOwnerNotifier()).toBeNull();
  });

  // El caso que más importa de esta variable: con WhatsApp Cloud andando para
  // el login pero sin la plantilla del aviso, el mensaje saldría con la
  // plantilla del código de login. Mejor apagado.
  it('con Cloud configurado pero sin la plantilla del aviso, queda apagado', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WHATSAPP_NUMBER', '+595981123456');
    vi.stubEnv('WHATSAPP_CLOUD_PHONE_NUMBER_ID', '123');
    vi.stubEnv('WHATSAPP_CLOUD_ACCESS_TOKEN', 'token');
    vi.stubEnv('WHATSAPP_CLOUD_TEMPLATE_NAME', 'login_otp');

    expect(resolveOwnerNotifier()).toBeNull();
  });

  it('con la plantilla del aviso, manda por WhatsApp y con esa plantilla', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WHATSAPP_NUMBER', '+595981123456');
    vi.stubEnv('WHATSAPP_CLOUD_PHONE_NUMBER_ID', '123');
    vi.stubEnv('WHATSAPP_CLOUD_ACCESS_TOKEN', 'token');
    vi.stubEnv('WHATSAPP_CLOUD_TEMPLATE_NAME', 'login_otp');
    vi.stubEnv('WHATSAPP_CLOUD_TEMPLATE_PEDIDO_NUEVO', 'pedido_nuevo');

    const notifier = resolveOwnerNotifier();

    expect(notifier?.sender.channel).toBe('whatsapp');
    expect(notifier?.templateName).toBe('pedido_nuevo');
    expect(notifier?.to).toBe('+595981123456');
  });
});
