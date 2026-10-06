import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readCode } from '../helpers/source';

/**
 * `/setup`: la configuración inicial desde el navegador en vez del curl.
 * Tiene que ser la **misma** puerta que `/api/setup/init` (no una segunda con
 * su propio candado) y no existir sin `SETUP_SECRET`.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('/setup', () => {
  it('sin SETUP_SECRET la página no existe (404)', async () => {
    vi.stubEnv('SETUP_SECRET', '');
    const notFound = vi.fn(() => {
      throw new Error('NEXT_NOT_FOUND');
    });
    vi.doMock('next/navigation', () => ({ notFound }));
    const { default: SetupPage } = await import('../../src/app/setup/page');
    expect(() => SetupPage()).toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
    vi.doUnmock('next/navigation');
  });

  it('el formulario llama a /api/setup/init con el secreto en el header, no en la URL', async () => {
    const form = await readCode(path.join('src', 'components', 'setup-form.tsx'));
    expect(form).toContain('"/api/setup/init"');
    expect(form).toMatch(/authorization:\s*`Bearer \$\{secreto\}`/);
    expect(form).not.toMatch(/\?secret=/);
  });

  it('no se indexa', async () => {
    const { RUTAS_PRIVADAS } = await import('../../src/lib/seo');
    expect(RUTAS_PRIVADAS).toContain('/setup');
    const page = await readCode(path.join('src', 'app', 'setup', 'page.tsx'));
    expect(page).toMatch(/index:\s*false/);
  });
});
