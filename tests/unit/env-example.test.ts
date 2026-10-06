import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { listSourceFiles, readCode } from '../helpers/source';

/**
 * `.env.example` mínimo, y nada de documentación perdida.
 *
 * Hostinger (Node.js Web Apps + GitHub) lee `.env.example` y precarga un campo
 * de "Environment variables" por variable. Por eso ahí van **sólo** las cinco
 * imprescindibles, y el resto vive en `docs/ENV-OPCIONAL.md` con sus
 * comentarios. Estos tests fijan las dos mitades del trato: el ejemplo no
 * vuelve a crecer, y ninguna variable que el código lee se queda sin
 * documentar en alguno de los dos archivos.
 */

const IMPRESCINDIBLES = [
  'DATABASE_URL',
  'SESSION_SECRET',
  'NEXT_PUBLIC_SITE_URL',
  'CRON_SECRET',
  'SETUP_SECRET',
];

/** Las pone el hosting, el build o la terminal: no son configuración de la tienda. */
const NO_DOCUMENTADAS = new Set([
  'NODE_ENV',
  'NEXT_RUNTIME',
  'BUILD_SHA',
  'BUILD_AT',
  'MYSQL_PWD',
  'CI',
  'CODESPACES',
  'GITPOD_WORKSPACE_ID',
  'REMOTE_CONTAINERS',
  'DEVCONTAINER',
  'CLAUDE_CODE_REMOTE',
  'PLAYWRIGHT_BASE_URL',
  'PORT',
]);

/** Prefijos de configuración de la tienda: un literal con esta forma es una variable. */
const PREFIJOS = /^(WHATSAPP|PAGOPAR|CLOUDINARY|BANCO|FACTURAPY|OWNER|CUSTOMER|ERROR_REPORT|NEXT_PUBLIC)_[A-Z0-9_]+$/;

function clavesDotenv(texto: string): string[] {
  return [...texto.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(([, clave]) => clave ?? '');
}

async function leer(ruta: string): Promise<string> {
  return readFile(path.join(process.cwd(), ruta), 'utf8');
}

describe('.env.example', () => {
  it('trae sólo las cinco variables imprescindibles', async () => {
    expect(clavesDotenv(await leer('.env.example')).sort()).toEqual([...IMPRESCINDIBLES].sort());
  });

  it('no trae TEST_DATABASE_URL: el runner de tests borra esa base', async () => {
    expect(await leer('.env.example')).not.toMatch(/^TEST_DATABASE_URL=/m);
  });

  it('apunta a docs/ENV-OPCIONAL.md para todo lo demás', async () => {
    expect(await leer('.env.example')).toContain('docs/ENV-OPCIONAL.md');
  });
});

describe('docs/ENV-OPCIONAL.md', () => {
  it('no repite ninguna imprescindible (una sola verdad por variable)', async () => {
    const opcionales = clavesDotenv(await leer('docs/ENV-OPCIONAL.md'));
    expect(opcionales.filter((clave) => IMPRESCINDIBLES.includes(clave))).toEqual([]);
  });

  it('ningún secreto trae un valor de ejemplo que cuente como configurado', async () => {
    // `CLOUDINARY_*="changeme"` en un bloque copiado a `.env.local` hacía que
    // `cloudinaryConfigured()` diera true con credenciales falsas.
    const docs = await leer('docs/ENV-OPCIONAL.md');
    const conValor = [...docs.matchAll(/^([A-Z][A-Z0-9_]*)="([^"\n]+)"$/gm)]
      .map(([, clave]) => clave)
      .filter((clave) => clave !== 'TEST_DATABASE_URL');
    expect(conValor).toEqual([]);
  });

  it('documenta toda variable que el código lee y no está en .env.example', async () => {
    const documentadas = new Set([
      ...clavesDotenv(await leer('.env.example')),
      ...clavesDotenv(await leer('docs/ENV-OPCIONAL.md')),
    ]);

    const leidas = new Set<string>();
    for (const file of await listSourceFiles(['src', 'scripts', 'tests'])) {
      if (file.endsWith('env-example.test.ts')) continue;
      const code = await readCode(file);
      // En `tests/` hay variables inventadas para probar el propio mecanismo
      // (`OTRO_SECRETO`): de ahí sólo cuentan las que tienen forma de config.
      const esTest = file.startsWith('tests');
      for (const [, name] of code.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
        if (!name) continue;
        if (!esTest || PREFIJOS.test(name) || name === 'TEST_DATABASE_URL') leidas.add(name);
      }
      // Las que se leen por nombre armado (`process.env[name]`) aparecen como
      // literales: `"PAGOPAR_PUBLIC_KEY"`, `'WHATSAPP_CLOUD_TEMPLATE_…'`.
      for (const [, name] of code.matchAll(/["'`]([A-Z][A-Z0-9_]+)["'`]/g)) {
        if (name && PREFIJOS.test(name)) leidas.add(name);
      }
    }

    const sinDocumentar = [...leidas]
      .filter((name) => !NO_DOCUMENTADAS.has(name) && !documentadas.has(name))
      .sort();
    expect(sinDocumentar).toEqual([]);
  });
});
