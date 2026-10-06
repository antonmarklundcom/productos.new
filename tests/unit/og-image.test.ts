import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readCode } from '../helpers/source';

/**
 * Tarjetas de Open Graph.
 *
 * Los links de esta tienda se reparten por WhatsApp e Instagram, que es de
 * donde viene casi todo el tráfico. Un producto que se comparte sin foto es
 * un producto que no se abre, así que las tres piezas que hacen falta —el
 * tamaño 1200×630, el `metadataBase` que vuelve absoluta la URL, y el
 * respaldo del sitio para el producto sin fotos— tienen su control acá.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('URL de la imagen para compartir', () => {
  it('pide a Cloudinary la caja 1200×630', async () => {
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'demo');
    const { OG_IMAGE_SIZE, productImageUrl } = await import('../../src/lib/images');

    const url = productImageUrl('productos/remera-azul', 'og');

    expect(OG_IMAGE_SIZE).toEqual({ width: 1200, height: 630 });
    expect(url).toContain(`w_${OG_IMAGE_SIZE.width},h_${OG_IMAGE_SIZE.height}`);
    // `c_fill`, no `c_fit`: una foto cuadrada en un lienzo 1.91:1 sale con
    // franjas vacías y eso se lee como un error del comercio.
    expect(url).toContain('c_fill');
    expect(url).toMatch(/^https:\/\/res\.cloudinary\.com\//);
  });

  it('sin cloud configurado no inventa una URL', async () => {
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', '');
    const { productImageUrl } = await import('../../src/lib/images');

    expect(productImageUrl('productos/remera-azul', 'og')).toBeNull();
  });
});

describe('metadataBase', () => {
  it('sale de NEXT_PUBLIC_SITE_URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://tienda.com.py');
    const { siteOrigin } = await import('../../src/lib/site-url');

    expect(siteOrigin()?.origin).toBe('https://tienda.com.py');
  });

  it('sin variable o con una URL rota devuelve null en vez de un dominio inventado', async () => {
    for (const value of ['', '   ', 'no-es-una-url']) {
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', value);
      const { siteOrigin } = await import('../../src/lib/site-url');
      expect(siteOrigin()).toBeNull();
    }
  });

  it('el layout lo declara: sin esto la URL de la imagen sale relativa', async () => {
    const layout = await readCode(path.join('src', 'app', 'layout.tsx'));
    expect(layout).toMatch(/metadataBase:\s*siteOrigin\(\)/);
  });
});

describe('la ficha de producto comparte con foto', () => {
  it('pone la imagen principal en openGraph, con su tamaño', async () => {
    const page = await readCode(path.join('src', 'app', 'producto', '[slug]', 'page.tsx'));

    expect(page).toMatch(/productImageUrl\(\s*product\.images\[0\]\?\.cloudinaryId,\s*"og"\s*\)/);
    expect(page).toContain('OG_IMAGE_SIZE.width');
    expect(page).toContain('OG_IMAGE_SIZE.height');
  });

  it('el respaldo del sitio existe y sale del nombre efectivo, no de un nombre escrito a mano', async () => {
    // Un `og-image.png` commiteado es el archivo que cada tienda nueva se
    // olvida de reemplazar, y publicar el nombre de otro comercio es peor que
    // no tener imagen. El nombre sale de `nombreTienda()`: el de
    // /admin/ajustes → Identidad, o `TIENDA.nombre` si no hay.
    const fallback = await readCode(path.join('src', 'app', 'opengraph-image.tsx'));
    const marca = await readCode(path.join('src', 'lib', 'marca.ts'));

    expect(fallback).toContain('nombreTienda()');
    expect(marca).toContain('TIENDA.nombre');
    expect(fallback).toContain('OG_IMAGE_SIZE');
  });
});
