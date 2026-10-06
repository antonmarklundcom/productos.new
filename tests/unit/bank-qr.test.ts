import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * La URL pública del QR SPI (`bankQrUrl`, PLAN.md FASE 2, PR T).
 *
 * Vive acá y no en el test de integración porque no necesita base: es armar
 * una URL de entrega de Cloudinary. Y necesita su propio archivo porque
 * `src/lib/images.ts` lee `CLOUDINARY_CLOUD_NAME` **al importarse** —a
 * propósito: la vidriera no puede caerse porque el comercio todavía no cargó
 * credenciales— así que la única forma de probar las dos puntas es reimportar
 * el módulo con el entorno ya puesto.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('bankQrUrl', () => {
  it('arma la URL con la transformación qr, que es c_fit', async () => {
    vi.resetModules();
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'tienda-py');

    const { bankQrUrl } = await import('../../src/lib/images');
    const url = bankQrUrl('banco/qr-spi');

    expect(url).toContain('res.cloudinary.com/tienda-py');
    expect(url).toContain('banco/qr-spi');
    // Recortar un QR lo rompe: deja de escanear, y del otro lado hay alguien
    // parado frente a la app del banco que no puede pagar.
    expect(url).toContain('c_fit');
    expect(url).not.toContain('c_fill');
  });

  it('sin cloud configurado devuelve null en vez de un <img> roto', async () => {
    vi.resetModules();
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', '');

    const { bankQrUrl } = await import('../../src/lib/images');
    expect(bankQrUrl('banco/qr-spi')).toBeNull();
  });

  it('sin id guardado devuelve null: ahí manda BANCO_QR_URL del entorno', async () => {
    vi.resetModules();
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'tienda-py');

    const { bankQrUrl } = await import('../../src/lib/images');
    expect(bankQrUrl(null)).toBeNull();
  });
});
