import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { leerTiendas, parseArgs } from '../../scripts/ensayar-distribucion';

/**
 * `tiendas.json` es el registro de tiendas del template, y el template es
 * público: acá no puede entrar nada que ayude a entrar a una tienda. Sólo
 * existe en el template (`SOLO_TEMPLATE`); en una tienda este test no mira nada.
 */

describe('tiendas.json', () => {
  const ruta = join(process.cwd(), 'tiendas.json');

  it.runIf(existsSync(ruta))('el del repo es válido: repo, dominio y notas, sin credenciales', () => {
    expect(() => leerTiendas(readFileSync(ruta, 'utf8'))).not.toThrow();
  });
});

describe('leerTiendas', () => {
  const leer = (valor: unknown) => leerTiendas(JSON.stringify(valor));

  it('acepta la lista vacía y entradas con repo, dominio y notas', () => {
    expect(leer([])).toEqual([]);
    expect(leer([{ repo: 'antonmarklundcom/mascota', dominio: 'mascota.com.py', notas: 'Pagopar en sandbox' }])).toHaveLength(1);
  });

  it('exige repo "dueño/nombre" y no lo acepta dos veces', () => {
    expect(() => leer([{ dominio: 'x.com.py' }])).toThrow(/dueño\/nombre/);
    expect(() => leer([{ repo: 'mascota' }])).toThrow(/dueño\/nombre/);
    expect(() => leer([{ repo: 'a/b' }, { repo: 'A/b' }])).toThrow(/dos veces/);
  });

  it('rechaza campos de infraestructura: el archivo es público', () => {
    expect(() => leer([{ repo: 'a/b', base: 'u123_tienda' }])).toThrow(/sólo van repo, dominio y notas/);
    expect(() => leer([{ repo: 'a/b', hosting: 'cuenta 2, slot 3' }])).toThrow(/sólo van/);
  });

  it('rechaza lo que parece una credencial aunque venga en notas', () => {
    expect(() => leer([{ repo: 'a/b', notas: ['mysql://u', 'clave@host/db'].join(':') }])).toThrow(/credencial/);
    expect(() => leer([{ repo: 'a/b', notas: 'la base es u123456_mascota' }])).toThrow(/credencial/);
    expect(() => leer([{ repo: 'a/b', notas: `token ghp_${'x'.repeat(36)}` }])).toThrow(/credencial/);
  });

  it('no es JSON o no es un array: error claro', () => {
    expect(() => leerTiendas('{')).toThrow(/JSON válido/);
    expect(() => leerTiendas('{}')).toThrow(/array/);
  });
});

describe('parseArgs de template:ensayar-distribucion', () => {
  it('flags y --repo repetible', () => {
    expect(parseArgs(['--verificar', '--repo', 'a/b', '--repo', 'c/d', '--conservar'])).toEqual({
      verificar: true,
      conservar: true,
      repos: ['a/b', 'c/d'],
    });
    expect(() => parseArgs(['--repo'])).toThrow(/dueño\/nombre/);
    expect(() => parseArgs(['--nada'])).toThrow(/no conozco/);
  });
});
