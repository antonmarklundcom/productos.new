import { describe, expect, it } from 'vitest';

import { analyticsActivo, analyticsConfig } from '../../src/lib/analytics';

/**
 * Los ids de medición terminan interpolados en un <script> del layout: el
 * regex de formato es lo único que separa "un env var del hPanel" de "JS
 * inyectado en cada página de la tienda". Por eso acá se prueba sobre todo lo
 * que se RECHAZA.
 */
describe('analyticsConfig', () => {
  it('sin variables, no hay medición: el default del template', () => {
    expect(analyticsConfig({})).toEqual({ ga4Id: null, metaPixelId: null });
    expect(analyticsActivo({})).toBe(false);
  });

  it('acepta los formatos reales, con espacios alrededor perdonados', () => {
    const config = analyticsConfig({
      NEXT_PUBLIC_GA4_ID: ' G-ABC123XYZ0 ',
      NEXT_PUBLIC_META_PIXEL_ID: '123456789012345',
    });

    expect(config.ga4Id).toBe('G-ABC123XYZ0');
    expect(config.metaPixelId).toBe('123456789012345');
    expect(analyticsActivo({ NEXT_PUBLIC_GA4_ID: 'G-ABC123XYZ0' })).toBe(true);
  });

  it('un id con formato raro se descarta entero, no se carga "más o menos"', () => {
    // El clásico: pegar el ID de la propiedad (numérico) o la URL en vez del
    // id de medición.
    for (const malo of ['123456789', 'https://analytics.google.com/...', 'UA-1234-5', 'G-']) {
      expect(analyticsConfig({ NEXT_PUBLIC_GA4_ID: malo }).ga4Id).toBeNull();
    }
    for (const malo of ['abc', 'pixel-123', '123', 'https://facebook.com/tr?id=1']) {
      expect(analyticsConfig({ NEXT_PUBLIC_META_PIXEL_ID: malo }).metaPixelId).toBeNull();
    }
  });

  it('nada que pueda cerrar un <script> o una comilla pasa el regex', () => {
    for (const inyeccion of [
      'G-ABC123\'};alert(1);//',
      'G-ABC123"</script>',
      'G-ABC123 onload=x',
      '12345</script><script>alert(1)</script>',
    ]) {
      const config = analyticsConfig({
        NEXT_PUBLIC_GA4_ID: inyeccion,
        NEXT_PUBLIC_META_PIXEL_ID: inyeccion,
      });
      expect(config.ga4Id).toBeNull();
      expect(config.metaPixelId).toBeNull();
    }
  });
});
