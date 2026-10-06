import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { esRutaCacheada } from '@/proxy';
import { jsonLdScript } from '@/lib/seo';

/**
 * El CSP contra las páginas cacheadas.
 *
 * El bug que este archivo evita que vuelva: un nonce vale para un render, pero
 * el HTML de una página con `revalidate` se sirve desde la caché durante
 * minutos con el nonce del primer render escrito adentro, mientras el proxy le
 * pone a cada respuesta uno nuevo. El navegador ve que no coinciden y bloquea
 * **todos** los scripts de esa pantalla: en producción, la home y las
 * categorías se quedaban sin carrito, sin buscador y sin la parte que llega
 * por streaming — visibles, pero muertas.
 *
 * Se arregló mandando esas rutas sin nonce (`esRutaCacheada`). La trampa que
 * queda es humana: cachear una pantalla nueva y no agregarla a la lista. Eso
 * no rompe ningún test de la pantalla —el HTML sale bien— y no se nota hasta
 * que alguien no puede comprar. Por eso la lista se verifica contra el
 * filesystem y no a mano.
 */

const APP = path.join('src', 'app');

/** Todos los `page.tsx` de `src/app` con su ruta y su fuente. */
function paginas(dir = APP, ruta = ''): { ruta: string; source: string }[] {
  const salida: { ruta: string; source: string }[] = [];

  for (const entrada of readdirSync(dir)) {
    const completo = path.join(dir, entrada);

    if (statSync(completo).isDirectory()) {
      // Los grupos —`(panel)`— no aparecen en la URL.
      const segmento = entrada.startsWith('(') ? '' : `/${entrada}`;
      salida.push(...paginas(completo, ruta + segmento));
      continue;
    }

    if (entrada === 'page.tsx') {
      salida.push({ ruta: ruta === '' ? '/' : ruta, source: readFileSync(completo, 'utf8') });
    }
  }

  return salida;
}

/** `/categoria/[slug]` → `/categoria/x`: un path como el que llega. */
function rutaConcreta(ruta: string): string {
  return ruta.replace(/\[(?:\.\.\.)?([^\]]+)\]/g, 'x');
}

describe('CSP y las páginas cacheadas', () => {
  const todas = paginas();

  it('encuentra las páginas de la app', () => {
    // Si el crawler se rompe, el resto de los tests pasarían vacíos.
    expect(todas.length).toBeGreaterThan(10);
    expect(todas.map((pagina) => pagina.ruta)).toContain('/');
  });

  it('toda página con revalidate está declarada como cacheada en el proxy', () => {
    const cacheadas = todas
      .filter((pagina) => /export const revalidate\s*=/.test(pagina.source))
      .map((pagina) => rutaConcreta(pagina.ruta));

    // Hoy son la home y las categorías. Si aparece otra, o va en
    // RUTAS_CACHEADAS o se le saca el revalidate.
    expect(cacheadas.length).toBeGreaterThan(0);
    for (const ruta of cacheadas) {
      expect(esRutaCacheada(ruta), `${ruta} se cachea pero el proxy le manda nonce`).toBe(true);
    }
  });

  it('ninguna página que se renderiza por request se trata como cacheada', () => {
    const porRequest = todas
      .filter((pagina) => !/export const revalidate\s*=/.test(pagina.source))
      .map((pagina) => rutaConcreta(pagina.ruta));

    for (const ruta of porRequest) {
      expect(esRutaCacheada(ruta), `${ruta} no se cachea: tiene que ir con nonce`).toBe(false);
    }
  });

  it('las rutas con plata o sesión nunca pierden el nonce', () => {
    // El contrato explícito, por si algún día la lista se edita a mano.
    for (const ruta of ['/checkout', '/admin', '/admin/pedidos', '/cuenta', '/pedido/PY-000123']) {
      expect(esRutaCacheada(ruta)).toBe(false);
    }
  });

  it('la home y las categorías sí', () => {
    expect(esRutaCacheada('/')).toBe(true);
    expect(esRutaCacheada('/categoria/electronica')).toBe(true);
  });

  it('no confunde una ruta que sólo empieza igual', () => {
    expect(esRutaCacheada('/categorias-falsas')).toBe(false);
  });
});

describe('jsonLdScript', () => {
  it('no deja cerrar la etiqueta desde adentro', () => {
    const salida = jsonLdScript({ name: 'Camiseta</script><script>alert(1)</script>' });
    expect(salida).not.toContain('</script>');
    expect(salida).not.toContain('<');
  });

  it('sigue siendo el mismo dato después de parsearlo', () => {
    const valor = { name: 'Silla & Mesa <chica>', price: 185000 };
    expect(JSON.parse(jsonLdScript(valor))).toEqual(valor);
  });
});
