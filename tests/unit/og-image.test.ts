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
  it("metadata R2 usa JPEG con las dimensiones reales del retrato", async () => {
    vi.stubEnv("NEXT_PUBLIC_IMAGENES_URL", "https://img.test");
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "");
    vi.doMock("@/db/queries", () => ({
      getProductBySlug: vi.fn(async () => ({
        name: "Cepillo",
        slug: "cepillo",
        description: "Foto de producto",
        variants: [],
        images: [
          { cloudinaryId: "r2:p1/cepillo-3f9a2c71d0@3024x4032", alt: "Cepillo" },
        ],
      })),
      getRelatedProducts: vi.fn(),
    }));
    try {
      const { generateMetadata } =
        await import("../../src/app/producto/[slug]/page");
      const result = await generateMetadata({
        params: Promise.resolve({ slug: "cepillo" }),
      });
      expect(result.openGraph?.images).toEqual([
        {
          url: "https://img.test/p1/cepillo-3f9a2c71d0.jpg",
          width: 900,
          height: 1200,
          alt: "Cepillo",
        },
      ]);
    } finally {
      vi.doUnmock("@/db/queries");
    }
  });
  it('pone la imagen principal en openGraph, con su tamaño', async () => {
    const page = await readCode(path.join('src', 'app', 'producto', '[slug]', 'page.tsx'));

    expect(page).toMatch(/productImageUrl\(\s*product\.images\[0\]\?\.cloudinaryId,\s*"og"\s*\)/);
    expect(page).toContain('OG_IMAGE_SIZE.width');
    expect(page).toContain('OG_IMAGE_SIZE.height');
  });

  it('la ruta Next renderiza el respaldo de la tienda como PNG', async () => {
    const nombreTienda = vi.fn(async () => 'Marca de prueba');
    vi.doMock('@/lib/marca', () => ({ nombreTienda }));
    vi.doMock('@/domain/store-settings', () => ({
      getStoreSettings: vi.fn(async () => ({ marca: { tagline: 'Catálogo de prueba' } })),
    }));

    try {
      const { GET } = await import('../../src/app/opengraph-image/route');
      const response = await GET();
      const png = Buffer.from(await response.arrayBuffer());

      expect(nombreTienda).toHaveBeenCalledOnce();
      expect(response.headers.get('content-type')).toMatch(/^image\/png/);
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    } finally {
      vi.doUnmock('@/lib/marca');
      vi.doUnmock('@/domain/store-settings');
    }
  });
});
