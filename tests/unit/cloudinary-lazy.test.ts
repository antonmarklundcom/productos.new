import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Regresión: importar el dominio sin credenciales de Cloudinary no puede
 * explotar.
 *
 * `lib/cloudinary.ts` validaba las variables **al importarse**. Como
 * `domain/receipt-review.ts` importa `signedReceiptUrl` para la preview del
 * comprobante, aprobar un pedido —que es puro MySQL— quedaba atado a tener
 * credenciales cargadas, y en CI, sin las variables, el módulo de tests ni
 * siquiera levantaba. En producción el mismo acoplamiento significa que rotar
 * mal una credencial de Cloudinary tiraría abajo la aprobación de pagos.
 *
 * Local pasaba sólo porque `.env.local` tenía placeholders — y ese archivo
 * está en `.gitignore`. Este test corre con las variables vacías a propósito,
 * así el entorno de desarrollo no puede volver a tapar el problema.
 */

const CLOUDINARY_VARS = [
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
] as const;

function withoutCloudinaryEnv(): void {
  vi.resetModules();
  // Vacío, no `delete`: `import "dotenv/config"` repuebla desde .env.local, y
  // dotenv no pisa una variable que ya existe.
  for (const name of CLOUDINARY_VARS) vi.stubEnv(name, '');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('lib/cloudinary se configura perezosamente', () => {
  it('importar lib/cloudinary sin credenciales no tira', async () => {
    withoutCloudinaryEnv();
    await expect(import('../../src/lib/cloudinary')).resolves.toBeDefined();
  });

  it('importar el dominio de revisión de comprobantes sin credenciales no tira', async () => {
    withoutCloudinaryEnv();
    // Éste es exactamente el import que rompía la suite en CI.
    const receiptReview = await import('../../src/domain/receipt-review');
    expect(typeof receiptReview.reviewReceipt).toBe('function');
  });

  it('importar las server actions de admin sin credenciales no tira', async () => {
    withoutCloudinaryEnv();
    await expect(import('../../src/app/actions/admin-orders')).resolves.toBeDefined();
    await expect(import('../../src/app/actions/admin-products')).resolves.toBeDefined();
  });

  it('recién al firmar una URL avisa qué variable falta', async () => {
    withoutCloudinaryEnv();
    const { signedReceiptUrl } = await import('../../src/lib/cloudinary');

    // El error tiene que seguir existiendo: la idea es moverlo al momento del
    // uso, no hacerlo desaparecer.
    expect(() => signedReceiptUrl('comprobantes/PY-000001')).toThrow(/CLOUDINARY_CLOUD_NAME/);
  });

  it('el mensaje nombra sólo las variables que faltan', async () => {
    vi.resetModules();
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'un-cloud');
    vi.stubEnv('CLOUDINARY_API_KEY', '123456789');
    vi.stubEnv('CLOUDINARY_API_SECRET', '');

    const { signedReceiptUrl } = await import('../../src/lib/cloudinary');

    expect(() => signedReceiptUrl('comprobantes/PY-000001')).toThrow(/CLOUDINARY_API_SECRET/);
    expect(() => signedReceiptUrl('comprobantes/PY-000001')).not.toThrow(/CLOUDINARY_CLOUD_NAME/);
  });

  it('con credenciales completas firma una URL de la carpeta privada', async () => {
    vi.resetModules();
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'un-cloud');
    vi.stubEnv('CLOUDINARY_API_KEY', '123456789');
    vi.stubEnv('CLOUDINARY_API_SECRET', 'un-secreto-de-prueba');

    const { signedReceiptUrl } = await import('../../src/lib/cloudinary');
    const url = signedReceiptUrl('comprobantes/PY-000001', { expiresInSeconds: 60 });

    expect(url).toContain('un-cloud');
    // `authenticated` + firma: sin esto el comprobante bancario tendría una
    // URL pública adivinable.
    expect(url).toContain('authenticated');
    expect(url).toMatch(/signature=|__cld_token__/);
    expect(url).not.toContain('un-secreto-de-prueba');
  });
});
