import { describe, expect, it } from 'vitest';

import { parseCatalogo, parseGs } from '../../src/domain/catalog-import';
import { parseCsv, toCsv } from '../../src/lib/csv';

/**
 * La planilla del comercio → catálogo (`pnpm importar:productos`).
 *
 * Lo que se verifica: que el formato del export del panel entre sin tocar
 * (round-trip), que los errores digan la línea, y que las plantillas rotas de
 * la vida real —separador de Google Sheets, precios con puntos, SKU repetido—
 * fallen con un mensaje y no con data corrupta.
 */

const ENCABEZADO = 'SKU;Producto;Categoría;Variante;Precio (₲);Stock';

describe('parseCsv', () => {
  it('lee lo que escribe toCsv (round-trip con BOM, CRLF y comillas)', () => {
    const csv = toCsv(
      ['SKU', 'Producto'],
      [
        ['AUR-1', 'Auriculares; con estuche'],
        ['AUR-2', 'Modelo "Pro"'],
      ],
    );

    expect(parseCsv(csv)).toEqual([
      ['SKU', 'Producto'],
      ['AUR-1', 'Auriculares; con estuche'],
      ['AUR-2', 'Modelo "Pro"'],
    ]);
  });

  it('acepta coma como separador: Google Sheets descarga así según la cuenta', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('un salto de línea entre comillas no corta la fila', () => {
    expect(parseCsv('a;b\n"linea 1\nlinea 2";x\n')).toEqual([
      ['a', 'b'],
      ['linea 1\nlinea 2', 'x'],
    ]);
  });

  it('descarta las filas vacías que Excel deja al final', () => {
    expect(parseCsv('a;b\n1;2\n;\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('parseGs', () => {
  it('acepta enteros pelados, puntos de miles y el ₲ decorativo', () => {
    expect(parseGs('285000')).toBe(285000);
    expect(parseGs('285.000')).toBe(285000);
    expect(parseGs('1.234.567')).toBe(1234567);
    expect(parseGs('₲ 285.000')).toBe(285000);
    expect(parseGs('Gs. 285000')).toBe(285000);
  });

  it('rechaza lo que no es plata paraguaya en vez de adivinar', () => {
    // "28.50" con puntos mal agrupados NO son 2850 guaraníes: alguien pegó un
    // precio en dólares o con decimales, y eso se corrige, no se convierte.
    expect(parseGs('28.50')).toBeNull();
    expect(parseGs('285,000')).toBeNull();
    expect(parseGs('-100')).toBeNull();
    expect(parseGs('abc')).toBeNull();
    expect(parseGs('')).toBeNull();
  });
});

describe('parseCatalogo', () => {
  it('entiende el formato que baja el export del panel', () => {
    const { productos, errores } = parseCatalogo(
      `${ENCABEZADO}\n` +
        'AUR-TWS-NEG;Auriculares Bluetooth TWS;Electrónica;Negro;285000;24\n' +
        'AUR-TWS-BLA;Auriculares Bluetooth TWS;Electrónica;Blanco;285.000;18\n',
    );

    expect(errores).toEqual([]);
    expect(productos).toHaveLength(1);
    expect(productos[0]!).toMatchObject({
      slug: 'auriculares-bluetooth-tws',
      name: 'Auriculares Bluetooth TWS',
      categoryName: 'Electrónica',
      ivaRate: 10,
    });
    expect(productos[0]!.variants).toEqual([
      { sku: 'AUR-TWS-NEG', label: 'Negro', pricePyg: 285000, compareAtPyg: null, onHand: 24 },
      { sku: 'AUR-TWS-BLA', label: 'Blanco', pricePyg: 285000, compareAtPyg: null, onHand: 18 },
    ]);
  });

  it('las columnas opcionales entran: descripción, marca, IVA, precio antes y slug', () => {
    const { productos, errores } = parseCatalogo(
      'SKU;Producto;Categoría;Variante;Precio (₲);Stock;Descripción;Marca;IVA;Precio antes (₲);Slug\n' +
        'YER-1KG;Yerba compuesta;Almacén;1 kg;38000;50;Con menta y cedrón;Pajarito;5;45000;yerba-pajarito\n',
    );

    expect(errores).toEqual([]);
    expect(productos[0]!).toMatchObject({
      slug: 'yerba-pajarito',
      description: 'Con menta y cedrón',
      brand: 'Pajarito',
      ivaRate: 5,
    });
    expect(productos[0]!.variants[0]!.compareAtPyg).toBe(45000);
  });

  it('los encabezados perdonan mayúsculas y acentos, y la variante vacía es "Único"', () => {
    const { productos, errores } = parseCatalogo(
      'sku,PRODUCTO,categoria,precio\nPWB-1,Power bank,Electronica,320000\n',
    );

    expect(errores).toEqual([]);
    expect(productos[0]!.variants[0]!.label).toBe('Único');
    expect(productos[0]!.variants[0]!.onHand).toBe(0);
  });

  it('sin una columna obligatoria no procesa nada y dice cuáles son', () => {
    const { productos, errores } = parseCatalogo('SKU;Producto;Precio (₲)\nX;Y;100\n');

    expect(productos).toEqual([]);
    expect(errores).toHaveLength(1);
    expect(errores[0]!).toContain('categoria');
  });

  it('cada error dice la línea, y una fila mala no frena a las demás', () => {
    const { productos, errores } = parseCatalogo(
      `${ENCABEZADO}\n` +
        'A-1;Producto A;Hogar;Único;no-es-precio;5\n' +
        'B-1;Producto B;Hogar;Único;120000;3\n',
    );

    expect(errores).toHaveLength(1);
    expect(errores[0]!).toContain('Línea 2');
    expect(productos).toHaveLength(1);
    expect(productos[0]!.slug).toBe('producto-b');
  });

  it('un SKU repetido en la planilla es un error, no un update silencioso', () => {
    const { errores } = parseCatalogo(
      `${ENCABEZADO}\n` +
        'A-1;Producto A;Hogar;Único;100000;5\n' +
        'A-1;Producto A;Hogar;Otro;200000;5\n',
    );

    expect(errores).toHaveLength(1);
    expect(errores[0]!).toContain('línea 2');
  });

  it('dos filas del mismo producto con datos que no cuadran son un error', () => {
    const { errores } = parseCatalogo(
      `${ENCABEZADO}\n` +
        'A-1;Remera lisa;Moda;S;100000;5\n' +
        'A-2;Remera lisa;Hogar;M;100000;5\n',
    );

    expect(errores).toHaveLength(1);
    expect(errores[0]!).toContain('categoría');
  });

  it('el IVA sólo puede ser 10, 5 o 0', () => {
    const { errores } = parseCatalogo(
      'SKU;Producto;Categoría;Precio (₲);IVA\nA-1;Algo;Hogar;100000;21\n',
    );

    expect(errores).toHaveLength(1);
    expect(errores[0]!).toContain('IVA');
  });

  it('un nombre que no deja slug (emojis, cirílico) se rechaza con la línea', () => {
    const { errores } = parseCatalogo(`${ENCABEZADO}\n💥💥;💥💥;Hogar;Único;100000;1\n`);

    expect(errores.some((error) => error.includes('slug'))).toBe(true);
  });

  it('la planilla vacía o sólo-encabezado avisa en vez de "importar 0"', () => {
    expect(parseCatalogo('').errores).toHaveLength(1);
    expect(parseCatalogo(`${ENCABEZADO}\n`).errores).toHaveLength(1);
  });
});

describe('parseCatalogo — columna Fotos', () => {
  it('acepta una o varias URLs https:// separadas por | y las suma sin duplicar', () => {
    const { productos, errores } = parseCatalogo(
      `${ENCABEZADO};Fotos\n` +
        'A-1;Producto A;Hogar;Único;100000;5;https://cdn.test/a1.jpg|https://cdn.test/a2.jpg\n',
    );

    expect(errores).toEqual([]);
    expect(productos[0]!.fotos).toEqual(['https://cdn.test/a1.jpg', 'https://cdn.test/a2.jpg']);
  });

  it('acepta el alias "imagenes" y separa por espacios o saltos de línea', () => {
    const { productos, errores } = parseCatalogo(
      'SKU;Producto;Categoría;Precio (₲);Imagenes\n' +
        'A-1;Producto A;Hogar;100000;"https://cdn.test/a1.jpg\nhttps://cdn.test/a2.jpg"\n',
    );

    expect(errores).toEqual([]);
    expect(productos[0]!.fotos).toEqual(['https://cdn.test/a1.jpg', 'https://cdn.test/a2.jpg']);
  });

  it('sin la columna Fotos, o vacía, el producto queda sin fotos', () => {
    const { productos, errores } = parseCatalogo(
      `${ENCABEZADO}\nA-1;Producto A;Hogar;Único;100000;5\n`,
    );

    expect(errores).toEqual([]);
    expect(productos[0]!.fotos).toEqual([]);
  });

  it('una URL que no es https:// es un error con la línea, no un silencio', () => {
    const { errores } = parseCatalogo(
      `${ENCABEZADO};Fotos\n` + 'A-1;Producto A;Hogar;Único;100000;5;http://cdn.test/a1.jpg\n',
    );

    expect(errores).toHaveLength(1);
    expect(errores[0]!).toContain('Línea 2');
  });

  it('una URL que no parsea como URL es un error', () => {
    const { errores } = parseCatalogo(
      `${ENCABEZADO};Fotos\n` + 'A-1;Producto A;Hogar;Único;100000;5;https://\n',
    );

    expect(errores).toHaveLength(1);
  });

  it('más de 10 fotos en un producto es un error, sumadas entre varias filas', () => {
    const muchas = Array.from({ length: 11 }, (_, i) => `https://cdn.test/${i}.jpg`).join('|');
    const { errores: errPrimerFila } = parseCatalogo(
      `${ENCABEZADO};Fotos\n` + `A-1;Producto A;Hogar;Único;100000;5;${muchas}\n`,
    );
    expect(errPrimerFila).toHaveLength(1);
    expect(errPrimerFila[0]!).toContain('máximo');

    const diez = Array.from({ length: 10 }, (_, i) => `https://cdn.test/${i}.jpg`).join('|');
    const { errores: errDosFilas } = parseCatalogo(
      `${ENCABEZADO};Fotos\n` +
        `A-1;Producto A;Hogar;Único;100000;5;${diez}\n` +
        'A-2;Producto A;Hogar;Otro;100000;5;https://cdn.test/extra.jpg\n',
    );
    expect(errDosFilas).toHaveLength(1);
    expect(errDosFilas[0]!).toContain('Línea 3');
  });

  it('no duplica una URL que se repite entre filas del mismo producto', () => {
    const { productos, errores } = parseCatalogo(
      `${ENCABEZADO};Fotos\n` +
        'A-1;Producto A;Hogar;Único;100000;5;https://cdn.test/a1.jpg\n' +
        'A-2;Producto A;Hogar;Otro;100000;5;https://cdn.test/a1.jpg\n',
    );

    expect(errores).toEqual([]);
    expect(productos[0]!.fotos).toEqual(['https://cdn.test/a1.jpg']);
  });

  it('el mensaje de columna obligatoria faltante menciona Fotos entre las opcionales', () => {
    const { errores } = parseCatalogo('SKU;Producto;Precio (₲)\nX;Y;100\n');
    expect(errores[0]!).toContain('Fotos');
  });
});
