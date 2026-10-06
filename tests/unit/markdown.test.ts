import { describe, expect, it } from 'vitest';

import { markdownToText, renderMarkdown } from '@/lib/markdown';

/**
 * El parser de markdown de la descripción de producto (O7, plan-operacion §5.3 D).
 *
 * Este archivo produce **HTML que se inyecta con `dangerouslySetInnerHTML`** en
 * la página pública de un producto. Es, por lejos, el lugar del repo donde un
 * error se paga más caro: una descripción la escribe el staff del comercio,
 * pero también la escribe cualquier planilla importada, y de ahí a un
 * `<script>` en la vidriera hay un solo `<`.
 *
 * Por eso la mitad de este archivo son payloads de XSS. La regla que los
 * detiene a todos es una sola —**se escapa todo antes de agregar nada**— y
 * estos tests son lo que hace que siga siendo cierta cuando alguien agregue la
 * séptima marca de formato.
 */

describe('renderMarkdown — el formato que sí se acepta', () => {
  it('un párrafo por bloque', () => {
    expect(renderMarkdown('Hola\n\nChau')).toBe('<p>Hola</p><p>Chau</p>');
  });

  it('negrita y cursiva', () => {
    expect(renderMarkdown('**fuerte** y *suave*')).toBe(
      '<p><strong>fuerte</strong> y <em>suave</em></p>',
    );
  });

  it('`**` le gana a `*`', () => {
    // Al revés, `**x**` saldría como `<em>*x</em>*`.
    expect(renderMarkdown('**x**')).toBe('<p><strong>x</strong></p>');
  });

  it('listas con guion', () => {
    expect(renderMarkdown('- uno\n- dos')).toBe('<ul><li>uno</li><li>dos</li></ul>');
  });

  it('una línea normal cierra la lista que venía', () => {
    expect(renderMarkdown('- uno\ntexto')).toBe('<ul><li>uno</li></ul><p>texto</p>');
  });

  it('los saltos de Windows no dejan basura invisible', () => {
    // Una descripción pegada desde Word trae `\r\n`. Sin normalizar, cada
    // línea termina con un `\r` que se cuela en la salida.
    expect(renderMarkdown('uno\r\n\r\ndos')).toBe('<p>uno</p><p>dos</p>');
  });

  it('vacío, null y undefined dan cadena vacía', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown(undefined)).toBe('');
  });

  it('la salida no lleva class ni style: la piel estila desde afuera', () => {
    const html = renderMarkdown('**a**\n\n- b');
    expect(html).not.toContain('class=');
    expect(html).not.toContain('style=');
  });
});

describe('renderMarkdown — links', () => {
  it('acepta https y agrega rel', () => {
    expect(renderMarkdown('[guía](https://tienda.com.py/guia)')).toBe(
      '<p><a href="https://tienda.com.py/guia" rel="nofollow noopener" target="_blank">guía</a></p>',
    );
  });

  it('un javascript: no produce un link', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');

    // No hay link, y el texto queda tal cual — que es lo correcto: la
    // descripción decía eso y el parser no la reescribe, sólo se niega a
    // convertirla en algo clickeable. Lo que importa es que `javascript:` no
    // esté adentro de ningún `href`.
    expect(html).not.toContain('<a');
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).toBe('<p>[click](javascript:alert(1))</p>');
  });

  it('un http:// tampoco', () => {
    // Ese link se le muestra a una compradora en una página https: mandarla a
    // http es degradarla sin avisarle.
    const html = renderMarkdown('[click](http://tienda.com.py)');
    expect(html).not.toContain('<a');
  });

  it('un data: tampoco', () => {
    expect(renderMarkdown('[x](data:text/html,<script>alert(1)</script>)')).not.toContain('<a');
  });

  it('una comilla en la URL no puede cerrar el atributo', () => {
    const html = renderMarkdown('[x](https://a.com/"onmouseover="alert(1))');
    expect(html).not.toContain('onmouseover="alert');
    // Si llegó a ser un link, la comilla viaja escapada adentro del href.
    expect(html).not.toMatch(/href="[^"]*"[^>]*onmouseover/);
  });
});

describe('renderMarkdown — XSS', () => {
  // La lista de siempre. Ninguno tiene que producir markup ejecutable.
  const PAYLOADS = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg onload=alert(1)>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '<a href="javascript:alert(1)">x</a>',
    '&lt;script&gt;alert(1)&lt;/script&gt;',
    '&amp;lt;script&amp;gt;',
    '<body onload=alert(1)>',
    '"><script>alert(1)</script>',
    "'><script>alert(1)</script>",
    '<style>*{background:url(javascript:alert(1))}</style>',
  ];

  /** Lo único que `renderMarkdown` puede emitir. */
  const ETIQUETAS_PERMITIDAS = ['p', 'strong', 'em', 'ul', 'li', 'a'];

  for (const payload of PAYLOADS) {
    it(`no deja pasar: ${payload.slice(0, 40)}`, () => {
      const html = renderMarkdown(payload);

      // Se miran las **etiquetas reales** de la salida, no el texto: un
      // `&lt;body onload=…&gt;` contiene la cadena "onload=" y es inofensivo,
      // porque su `<` ya no abre nada. Buscar la cadena suelta daría rojo con
      // una salida correcta, y un test que grita en falso termina borrado.
      for (const coincidencia of html.matchAll(/<([^>]*)>/g)) {
        const contenido = coincidencia[1] ?? '';
        const etiqueta = contenido.replace(/^\//, '').split(/[\s>]/)[0]!.toLowerCase();
        // Lo único que este parser genera.
        expect(ETIQUETAS_PERMITIDAS).toContain(etiqueta);
        // Y ninguna de ellas lleva jamás un manejador de eventos.
        expect(contenido).not.toMatch(/\son\w+\s*=/i);
      }
    });
  }

  it('el `&` se escapa una sola vez, no en cascada', () => {
    // Si el `&` no fuera lo primero que se reemplaza, el `&lt;` que genera el
    // paso siguiente se re-escaparía a `&amp;lt;` y el texto saldría roto.
    expect(renderMarkdown('a & b')).toBe('<p>a &amp; b</p>');
    expect(renderMarkdown('<')).toBe('<p>&lt;</p>');
  });

  it('las entidades ya escapadas del input quedan visibles, no se decodifican', () => {
    // `&lt;script&gt;` escrito por el staff tiene que leerse como texto, no
    // convertirse en una etiqueta.
    const html = renderMarkdown('&lt;script&gt;');
    expect(html).toBe('<p>&amp;lt;script&amp;gt;</p>');
  });

  it('no hay ningún camino sin escapar: el HTML crudo sale como texto', () => {
    expect(renderMarkdown('<b>hola</b>')).toBe('<p>&lt;b&gt;hola&lt;/b&gt;</p>');
  });

  it('tampoco adentro de una lista o de una negrita', () => {
    expect(renderMarkdown('- <script>x</script>')).not.toMatch(/<script/i);
    expect(renderMarkdown('**<script>x</script>**')).not.toMatch(/<script/i);
  });
});

describe('markdownToText', () => {
  it('saca las marcas y deja el texto', () => {
    expect(markdownToText('**Importado** de *Brasil*')).toBe('Importado de Brasil');
  });

  it('del link deja el texto, no la URL', () => {
    // La URL en un snippet de Google es ruido que le come lugar a la
    // descripción real.
    expect(markdownToText('Mirá la [guía de talles](https://a.com/t)')).toBe(
      'Mirá la guía de talles',
    );
  });

  it('aplasta las listas y los saltos en una línea', () => {
    expect(markdownToText('- uno\n- dos\n\ntres')).toBe('uno dos tres');
  });

  it('vacío, null y undefined dan cadena vacía', () => {
    expect(markdownToText('')).toBe('');
    expect(markdownToText(null)).toBe('');
    expect(markdownToText(undefined)).toBe('');
  });

  it('es texto plano: no escapa ni agrega nada', () => {
    // A diferencia de `renderMarkdown`, la salida acá no va a un `innerHTML`:
    // va a un `<meta>` que Next escapa solo, y a un JSON-LD que se serializa.
    expect(markdownToText('a & b')).toBe('a & b');
  });
});
