import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { getRelatedProducts, suggestProducts } from '@/db/queries';
import { categories, orderItems, products, variants, type OrderStatus } from '@/db/schema';
import { reserveStock } from '@/domain/stock';

import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createOrder } from '../helpers/factories';

/**
 * Relacionados de la ficha (PR M) y sugerencias del buscador (PR N).
 *
 * El catálogo se arma a mano en vez de usar el seed porque las dos cosas que
 * hay que probar son de orden y de borde —cuál sale primero, qué queda
 * afuera— y con el catálogo de ejemplo eso se vuelve un test que dice más
 * sobre el seed que sobre el código.
 */

type Ficha = {
  slug: string;
  name: string;
  brand?: string | null;
  pricePyg: number;
  onHand?: number;
  publicado?: boolean;
};

async function catalogo(categorySlug: string, fichas: Ficha[]): Promise<Map<string, number>> {
  const db = getTestDb();
  await db.insert(categories).values({ slug: categorySlug, name: categorySlug });
  const [category] = await db
    .select()
    .from(categories)
    .where(eq(categories.slug, categorySlug))
    .limit(1);

  const ids = new Map<string, number>();
  for (const ficha of fichas) {
    await db.insert(products).values({
      slug: ficha.slug,
      name: ficha.name,
      description: `descripción de ${ficha.name}`,
      categoryId: category!.id,
      brand: ficha.brand ?? null,
      ivaRate: 10,
      publishedAt: ficha.publicado === false ? null : new Date(),
    });
    const [row] = await db.select().from(products).where(eq(products.slug, ficha.slug)).limit(1);
    ids.set(ficha.slug, row!.id);

    await db.insert(variants).values({
      productId: row!.id,
      sku: `SKU-${ficha.slug.toUpperCase()}`,
      label: 'Único',
      pricePyg: ficha.pricePyg,
      onHand: ficha.onHand ?? 5,
    });
  }
  return ids;
}

const BASE: Ficha[] = [
  { slug: 'el-que-miro', name: 'El que miro', brand: 'Marca A', pricePyg: 100_000 },
  { slug: 'misma-marca-lejos', name: 'Misma marca lejos', brand: 'Marca A', pricePyg: 900_000 },
  { slug: 'otra-marca-cerca', name: 'Otra marca cerca', brand: 'Marca B', pricePyg: 105_000 },
  { slug: 'otra-marca-lejos', name: 'Otra marca lejos', brand: 'Marca B', pricePyg: 800_000 },
];

describe.skipIf(!hasTestDb)('también te puede interesar', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  async function relacionadosDe(ids: Map<string, number>, limit = 4) {
    return getRelatedProducts(
      {
        productId: ids.get('el-que-miro')!,
        categorySlug: 'ropa',
        brand: 'Marca A',
        pricePyg: 100_000,
      },
      limit,
    );
  }

  it('la misma marca va primero, y después el precio más parecido', async () => {
    const ids = await catalogo('ropa', BASE);
    const rows = await relacionadosDe(ids);

    expect(rows.map((row) => row.slug)).toEqual([
      // Misma marca gana aunque el precio esté lejísimos: quien mira una
      // Marca A suele estar decidiendo entre Marca A.
      'misma-marca-lejos',
      'otra-marca-cerca',
      'otra-marca-lejos',
    ]);
  });

  it('un relacionado más barato no rompe la consulta', async () => {
    /*
      La regresión: `price_pyg` es BIGINT UNSIGNED y el orden por cercanía de
      precio hacía `MIN(price_pyg) - <precio>`. Cuando el relacionado es más
      barato eso da negativo, y un unsigned no puede: MySQL corta la consulta
      con ER_DATA_OUT_OF_RANGE y la ficha entera se cae con un 500.

      Todas las fichas de BASE son más caras que `el-que-miro`, así que el bug
      pasaba por al lado de esta suite. En un catálogo real, en cambio, casi
      todo producto tiene algo más barato en su categoría.
    */
    const ids = await catalogo('ropa', [
      ...BASE,
      { slug: 'mas-barato', name: 'Más barato', brand: 'Marca B', pricePyg: 20_000 },
    ]);

    const rows = await getRelatedProducts(
      {
        productId: ids.get('el-que-miro')!,
        categorySlug: 'ropa',
        brand: 'Marca A',
        pricePyg: 100_000,
      },
      10,
    );

    expect(rows.map((row) => row.slug)).toContain('mas-barato');
  });

  it('nunca se recomienda a sí mismo', async () => {
    const ids = await catalogo('ropa', BASE);
    const rows = await relacionadosDe(ids);
    expect(rows.map((row) => row.slug)).not.toContain('el-que-miro');
  });

  it('deja afuera lo de otra categoría', async () => {
    const ids = await catalogo('ropa', BASE);
    await catalogo('calzado', [
      { slug: 'zapato', name: 'Zapato', brand: 'Marca A', pricePyg: 100_000 },
    ]);

    const rows = await relacionadosDe(ids);
    expect(rows.map((row) => row.slug)).not.toContain('zapato');
  });

  it('deja afuera lo despublicado y lo sin stock', async () => {
    const ids = await catalogo('ropa', [
      ...BASE,
      { slug: 'borrador', name: 'Borrador', brand: 'Marca A', pricePyg: 101_000, publicado: false },
      { slug: 'agotado', name: 'Agotado', brand: 'Marca A', pricePyg: 102_000, onHand: 0 },
    ]);

    const slugs = (await relacionadosDe(ids)).map((row) => row.slug);
    expect(slugs).not.toContain('borrador');
    expect(slugs).not.toContain('agotado');
  });

  it('lo que quedó en cero por una reserva ajena tampoco aparece', async () => {
    // El segundo filtro, el que no se puede hacer en SQL barato: `on_hand` es
    // 2 y los dos están tomados por un carrito de otra persona.
    const ids = await catalogo('ropa', [
      ...BASE,
      { slug: 'reservado', name: 'Reservado', brand: 'Marca A', pricePyg: 101_000, onHand: 2 },
    ]);

    const db = getTestDb();
    const [variant] = await db
      .select()
      .from(variants)
      .where(eq(variants.productId, ids.get('reservado')!))
      .limit(1);

    const orderId = await createOrder();
    await reserveStock(orderId, [{ variantId: variant!.id, qty: 2 }], {
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const slugs = (await relacionadosDe(ids)).map((row) => row.slug);
    expect(slugs).not.toContain('reservado');
  });

  it('respeta el límite', async () => {
    const ids = await catalogo('ropa', BASE);
    expect(await relacionadosDe(ids, 2)).toHaveLength(2);
  });

  it('sin nada que mostrar devuelve una lista vacía, no un error', async () => {
    const ids = await catalogo('ropa', [BASE[0]!]);
    expect(await relacionadosDe(ids)).toEqual([]);
  });

  it('con todos sin marca, el precio decide', async () => {
    // `<=>` y no `=`: con `=`, comparar NULL contra NULL da NULL y el CASE se
    // cae siempre a "otra marca", así que el desempate por precio seguiría
    // funcionando pero por accidente. Acá se fija que "los dos sin marca"
    // cuente como misma marca.
    const ids = await catalogo('ropa', [
      { slug: 'el-que-miro', name: 'El que miro', brand: null, pricePyg: 100_000 },
      { slug: 'cerca', name: 'Cerca', brand: null, pricePyg: 110_000 },
      { slug: 'lejos', name: 'Lejos', brand: null, pricePyg: 900_000 },
      { slug: 'con-marca-cerquísima', name: 'Con marca', brand: 'Marca A', pricePyg: 100_500 },
    ]);

    const rows = await getRelatedProducts({
      productId: ids.get('el-que-miro')!,
      categorySlug: 'ropa',
      brand: null,
      pricePyg: 100_000,
    });

    expect(rows[0]?.slug).toBe('cerca');
    expect(rows[1]?.slug).toBe('lejos');
    expect(rows[2]?.slug).toBe('con-marca-cerquísima');
  });
});

/**
 * Simula un pedido que llegó a `status`, con una línea por cada slug de
 * `ids`. Una sola variante por producto (así arma `catalogo()`), así que
 * alcanza con buscarla por `productId`.
 */
async function pedidoCon(status: OrderStatus, slugs: string[], ids: Map<string, number>): Promise<number> {
  const db = getTestDb();
  const orderId = await createOrder({ status });

  for (const slug of slugs) {
    const productId = ids.get(slug);
    if (!productId) throw new Error(`sin id para "${slug}"`);
    const [variant] = await db.select().from(variants).where(eq(variants.productId, productId)).limit(1);
    if (!variant) throw new Error(`sin variante para "${slug}"`);
    await db.insert(orderItems).values({
      orderId,
      variantId: variant.id,
      nameSnapshot: slug,
      skuSnapshot: variant.sku,
      unitPricePyg: variant.pricePyg,
      qty: 1,
      ivaRate: 10,
      lineTotalPyg: variant.pricePyg,
    });
  }

  return orderId;
}

describe.skipIf(!hasTestDb)('también te puede interesar: comprado junto', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('lo que se compró junto gana, aunque sea de otra categoría', async () => {
    const ids = await catalogo('ropa', BASE);
    const accesorios = await catalogo('accesorios', [
      { slug: 'funda', name: 'Funda', brand: 'Otra', pricePyg: 50_000 },
    ]);
    for (const [slug, id] of accesorios) ids.set(slug, id);

    await pedidoCon('pagado', ['el-que-miro', 'funda'], ids);

    const rows = await getRelatedProducts(
      { productId: ids.get('el-que-miro')!, categorySlug: 'ropa', brand: 'Marca A', pricePyg: 100_000 },
      4
    );

    // "funda" no tiene ni la marca ni la categoría de "el-que-miro" — sólo se
    // compró junto — y aun así sale primero, antes que "misma-marca-lejos".
    expect(rows[0]?.slug).toBe('funda');
  });

  it('un pedido sin pagar (o cancelado) no cuenta como comprado junto', async () => {
    const ids = await catalogo('ropa', BASE);
    const accesorios = await catalogo('accesorios', [
      { slug: 'funda', name: 'Funda', brand: 'Otra', pricePyg: 50_000 },
    ]);
    for (const [slug, id] of accesorios) ids.set(slug, id);

    await pedidoCon('pendiente_pago', ['el-que-miro', 'funda'], ids);
    await pedidoCon('cancelado', ['el-que-miro', 'funda'], ids);

    const rows = await getRelatedProducts(
      { productId: ids.get('el-que-miro')!, categorySlug: 'ropa', brand: 'Marca A', pricePyg: 100_000 },
      4
    );

    // Sin ningún pedido que cuente, la sección vuelve a ser exactamente la de
    // "misma categoría" de siempre — "funda" ni aparece.
    expect(rows.map((row) => row.slug)).not.toContain('funda');
    expect(rows[0]?.slug).toBe('misma-marca-lejos');
  });

  it('con menos comprados-juntos que el límite, el resto lo llena la misma categoría', async () => {
    const ids = await catalogo('ropa', BASE);
    const accesorios = await catalogo('accesorios', [
      { slug: 'funda', name: 'Funda', brand: 'Otra', pricePyg: 50_000 },
    ]);
    for (const [slug, id] of accesorios) ids.set(slug, id);

    await pedidoCon('pagado', ['el-que-miro', 'funda'], ids);

    const rows = await getRelatedProducts(
      { productId: ids.get('el-que-miro')!, categorySlug: 'ropa', brand: 'Marca A', pricePyg: 100_000 },
      4
    );

    // "funda" (comprado junto) primero, y atrás los tres de BASE, en el mismo
    // orden de siempre (misma marca, después precio parecido).
    expect(rows.map((row) => row.slug)).toEqual([
      'funda',
      'misma-marca-lejos',
      'otra-marca-cerca',
      'otra-marca-lejos',
    ]);
  });

  it('lo comprado junto no se repite si además es de la misma categoría', async () => {
    const ids = await catalogo('ropa', BASE);

    // "misma-marca-lejos" es de la misma categoría (candidato del paso 2) y
    // además se compró junto con "el-que-miro" (candidato del paso 1).
    await pedidoCon('pagado', ['el-que-miro', 'misma-marca-lejos'], ids);

    const rows = await getRelatedProducts(
      { productId: ids.get('el-que-miro')!, categorySlug: 'ropa', brand: 'Marca A', pricePyg: 100_000 },
      4
    );

    const slugs = rows.map((row) => row.slug);
    expect(slugs.filter((slug) => slug === 'misma-marca-lejos')).toHaveLength(1);
    expect(slugs).toEqual(['misma-marca-lejos', 'otra-marca-cerca', 'otra-marca-lejos']);
  });
});

describe.skipIf(!hasTestDb)('sugerencias del buscador', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  const CATALOGO: Ficha[] = [
    { slug: 'remera-lisa', name: 'Remera lisa', brand: 'Basics PY', pricePyg: 80_000 },
    { slug: 'remera-rayada', name: 'Remera rayada', brand: 'Basics PY', pricePyg: 90_000 },
    { slug: 'campera-liviana', name: 'Campera liviana', brand: 'Otra', pricePyg: 300_000 },
    {
      slug: 'oculto',
      name: 'Remera oculta',
      brand: 'Basics PY',
      pricePyg: 70_000,
      publicado: false,
    },
  ];

  it('encuentra por prefijo', async () => {
    await catalogo('ropa', CATALOGO);
    const rows = await suggestProducts('reme');
    expect(rows.map((row) => row.slug).sort()).toEqual(['remera-lisa', 'remera-rayada']);
  });

  it('no sugiere lo que la vidriera no muestra', async () => {
    await catalogo('ropa', CATALOGO);
    const rows = await suggestProducts('remera');
    expect(rows.map((row) => row.slug)).not.toContain('oculto');
  });

  it('trae el nombre y la marca, y nada más', async () => {
    await catalogo('ropa', CATALOGO);
    const [row] = await suggestProducts('campera');

    // La forma importa: si algún día vuelve con variantes o fotos, es que
    // alguien le puso el `hydrate` de vuelta y esto pasó a costar lo mismo que
    // la búsqueda completa, con cada tecla.
    expect(Object.keys(row ?? {}).sort()).toEqual(['brand', 'name', 'slug']);
  });

  it('respeta el límite', async () => {
    await catalogo('ropa', CATALOGO);
    expect(await suggestProducts('remera', 1)).toHaveLength(1);
  });

  it('no contesta con menos de dos caracteres', async () => {
    await catalogo('ropa', CATALOGO);
    expect(await suggestProducts('')).toEqual([]);
    expect(await suggestProducts('r')).toEqual([]);
    expect(await suggestProducts('   ')).toEqual([]);
  });

  it('no rompe con los caracteres del modo booleano', async () => {
    await catalogo('ropa', CATALOGO);
    await expect(suggestProducts('remera +-><()~*"@')).resolves.toBeInstanceOf(Array);
  });

  it('cae al LIKE cuando FULLTEXT no encuentra nada', async () => {
    await catalogo('ropa', CATALOGO);
    // "ayad" está en el medio de "rayada": FULLTEXT indexa palabras enteras y
    // el prefijo `ayad*` no matchea, así que sólo lo encuentra el LIKE.
    const rows = await suggestProducts('ayad');
    expect(rows.map((row) => row.slug)).toEqual(['remera-rayada']);
  });
});
