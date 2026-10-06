import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { categories, priceAdjustments, productImages, products, variants } from '@/db/schema';
import {
  AdminBulkError,
  bulkAdjustPrices,
  bulkMoveCategory,
  bulkSetActive,
  duplicateProduct,
  precioAjustado,
  previewPriceAdjustment,
} from '@/domain/admin-bulk';

import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createAdminUser, createCategory, createProduct, createVariant } from '../helpers/factories';

/**
 * Acciones masivas del panel (O7, plan-operacion §5.3 B y C).
 *
 * La de precios es la que importa: subir un 20 % a doscientas variantes de un
 * click es la operación más fácil de arrepentirse del panel, y lo único que la
 * hace reversible es la fila de auditoría por variante.
 */

const ACTOR = 'admin:due@tienda.py';
const MOTIVO = 'cambió el dólar';

describe('precioAjustado — la cuenta, sin base', () => {
  it('los dos casos del plan', () => {
    // 12.345 + 10 % = 13.579,5 → 13.580 → redondeado a ₲100 = 13.600.
    expect(precioAjustado(12_345, 10, 100)).toBe(13_600);
    // 990 − 90 % = 99 → redondeado a ₲100 = 100. **Nunca 0.**
    expect(precioAjustado(990, -90, 100)).toBe(100);
  });

  it('nunca devuelve ₲0: el piso es el redondeo', () => {
    // Un producto gratis en la vidriera es lo peor que puede salir de acá.
    expect(precioAjustado(50, -90, 100)).toBe(100);
    expect(precioAjustado(1, -90, 1000)).toBe(1000);
    expect(precioAjustado(100, -90, 1000)).toBe(1000);
  });

  it('redondea a ₲1.000 cuando se pide', () => {
    expect(precioAjustado(12_345, 10, 1000)).toBe(14_000);
    expect(precioAjustado(150_000, 20, 1000)).toBe(180_000);
  });

  it('devuelve enteros siempre', () => {
    for (const precio of [1, 999, 12_345, 987_654_321]) {
      for (const percent of [-90, -33, -1, 1, 7, 500]) {
        const resultado = precioAjustado(precio, percent, 100);
        expect(Number.isInteger(resultado)).toBe(true);
        expect(resultado).toBeGreaterThan(0);
      }
    }
  });
});

describe.skipIf(!hasTestDb)('bulkAdjustPrices', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('cambia los precios y deja una fila de auditoría por variante', async () => {
    const productId = await createProduct();
    const a = await createVariant({ onHand: 1, pricePyg: 12_345, productId });
    const b = await createVariant({ onHand: 1, pricePyg: 100_000, productId });
    const userId = await createAdminUser({ email: 'due@tienda.py' });

    const resultado = await bulkAdjustPrices({
      productIds: [productId],
      percent: 10,
      roundTo: 100,
      reason: MOTIVO,
      actor: ACTOR,
      actorUserId: userId,
    });

    expect(resultado.cambiadas).toBe(2);
    expect(resultado.miradas).toBe(2);
    expect(resultado.diferenciaPyg).toBe(13_600 - 12_345 + (110_000 - 100_000));

    const db = getTestDb();
    const precios = await db
      .select({ id: variants.id, pricePyg: variants.pricePyg })
      .from(variants)
      .where(inArray(variants.id, [a, b]));
    expect(precios.find((v) => v.id === a)?.pricePyg).toBe(13_600);
    expect(precios.find((v) => v.id === b)?.pricePyg).toBe(110_000);

    const auditoria = await db.select().from(priceAdjustments);
    expect(auditoria).toHaveLength(2);
    const deA = auditoria.find((fila) => fila.variantId === a);
    expect(deA?.fromPyg).toBe(12_345);
    expect(deA?.toPyg).toBe(13_600);
    expect(deA?.actor).toBe(ACTOR);
    expect(deA?.actorUserId).toBe(userId);
    expect(deA?.reason).toBe(MOTIVO);
  });

  it('no toca `compare_at_pyg`', async () => {
    // Es el precio tachado: si subiera con el resto, el descuento que la
    // vidriera muestra sería siempre el mismo y no significaría nada.
    const productId = await createProduct();
    const variantId = await createVariant({ onHand: 1, pricePyg: 100_000, productId });
    await getTestDb()
      .update(variants)
      .set({ compareAtPyg: 150_000 })
      .where(eq(variants.id, variantId));

    await bulkAdjustPrices({
      variantIds: [variantId],
      percent: 10,
      roundTo: 100,
      reason: MOTIVO,
      actor: ACTOR,
    });

    const [fila] = await getTestDb()
      .select({ compareAtPyg: variants.compareAtPyg })
      .from(variants)
      .where(eq(variants.id, variantId));
    expect(fila?.compareAtPyg).toBe(150_000);
  });

  it('una variante que queda igual por el redondeo no deja fila', async () => {
    // Una auditoría llena de "de ₲10.000 a ₲10.000" es una auditoría que nadie
    // lee.
    const productId = await createProduct();
    await createVariant({ onHand: 1, pricePyg: 10_000, productId });

    const resultado = await bulkAdjustPrices({
      productIds: [productId],
      percent: 1,
      roundTo: 1000,
      reason: MOTIVO,
      actor: ACTOR,
    });

    expect(resultado.miradas).toBe(1);
    expect(resultado.cambiadas).toBe(0);
    expect(await getTestDb().select().from(priceAdjustments)).toHaveLength(0);
  });

  it('acepta ids de variante sueltos', async () => {
    const productId = await createProduct();
    const elegida = await createVariant({ onHand: 1, pricePyg: 100_000, productId });
    const otra = await createVariant({ onHand: 1, pricePyg: 100_000, productId });

    await bulkAdjustPrices({
      variantIds: [elegida],
      percent: 50,
      roundTo: 100,
      reason: MOTIVO,
      actor: ACTOR,
    });

    const db = getTestDb();
    const precios = await db
      .select({ id: variants.id, pricePyg: variants.pricePyg })
      .from(variants)
      .where(inArray(variants.id, [elegida, otra]));
    expect(precios.find((v) => v.id === elegida)?.pricePyg).toBe(150_000);
    expect(precios.find((v) => v.id === otra)?.pricePyg).toBe(100_000);
  });

  it('exige motivo, porcentaje entero y en rango', async () => {
    const productId = await createProduct();
    await createVariant({ onHand: 1, pricePyg: 100_000, productId });

    const base = { productIds: [productId], roundTo: 100 as const, actor: ACTOR };

    await expect(
      bulkAdjustPrices({ ...base, percent: 10, reason: 'x' }),
    ).rejects.toBeInstanceOf(AdminBulkError);
    await expect(
      bulkAdjustPrices({ ...base, percent: 10.5, reason: MOTIVO }),
    ).rejects.toBeInstanceOf(AdminBulkError);
    await expect(
      bulkAdjustPrices({ ...base, percent: -91, reason: MOTIVO }),
    ).rejects.toBeInstanceOf(AdminBulkError);
    await expect(
      bulkAdjustPrices({ ...base, percent: 501, reason: MOTIVO }),
    ).rejects.toBeInstanceOf(AdminBulkError);

    expect(await getTestDb().select().from(priceAdjustments)).toHaveLength(0);
  });

  it('un 0 % no escribe nada', async () => {
    const productId = await createProduct();
    await createVariant({ onHand: 1, pricePyg: 100_000, productId });

    const resultado = await bulkAdjustPrices({
      productIds: [productId],
      percent: 0,
      roundTo: 100,
      reason: MOTIVO,
      actor: ACTOR,
    });

    expect(resultado).toEqual({ cambiadas: 0, miradas: 0, diferenciaPyg: 0 });
    expect(await getTestDb().select().from(priceAdjustments)).toHaveLength(0);
  });

  it('la vista previa dice lo mismo que la escritura, sin escribir', async () => {
    // Si la vista previa y el ajuste usaran cuentas distintas, la vista previa
    // sería peor que no tenerla.
    const productId = await createProduct();
    await createVariant({ onHand: 1, pricePyg: 12_345, productId });
    await createVariant({ onHand: 1, pricePyg: 100_000, productId });

    const previa = await previewPriceAdjustment({
      productIds: [productId],
      percent: 10,
      roundTo: 100,
    });
    expect(await getTestDb().select().from(priceAdjustments)).toHaveLength(0);

    const aplicado = await bulkAdjustPrices({
      productIds: [productId],
      percent: 10,
      roundTo: 100,
      reason: MOTIVO,
      actor: ACTOR,
    });

    expect(previa.cambiadas).toBe(aplicado.cambiadas);
    expect(previa.diferenciaPyg).toBe(aplicado.diferenciaPyg);
    expect(previa.ejemplos[0]).toEqual({ variantId: expect.any(Number), from: 12_345, to: 13_600 });
  });
});

describe.skipIf(!hasTestDb)('bulkSetActive y bulkMoveCategory', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('despublica varios de una', async () => {
    const uno = await createProduct();
    const dos = await createProduct();

    expect(await bulkSetActive([uno, dos], false)).toBe(2);

    const filas = await getTestDb()
      .select({ isActive: products.isActive })
      .from(products)
      .where(inArray(products.id, [uno, dos]));
    expect(filas.every((fila) => !fila.isActive)).toBe(true);
  });

  it('mueve de categoría', async () => {
    const destino = await createCategory();
    const uno = await createProduct();
    const dos = await createProduct();

    expect(await bulkMoveCategory([uno, dos], destino)).toBe(2);

    const filas = await getTestDb()
      .select({ categoryId: products.categoryId })
      .from(products)
      .where(inArray(products.id, [uno, dos]));
    expect(filas.every((fila) => fila.categoryId === destino)).toBe(true);
  });

  it('se niega a mover a una categoría apagada', async () => {
    // Mover cien productos a una categoría apagada los saca a todos de la
    // vidriera de una sola vez, y nadie que aprieta "mover" está pidiendo eso.
    const destino = await createCategory();
    await getTestDb().update(categories).set({ isActive: false }).where(eq(categories.id, destino));
    const productId = await createProduct();
    const categoriaOriginal = (
      await getTestDb()
        .select({ categoryId: products.categoryId })
        .from(products)
        .where(eq(products.id, productId))
    )[0]?.categoryId;

    await expect(bulkMoveCategory([productId], destino)).rejects.toBeInstanceOf(AdminBulkError);

    const [fila] = await getTestDb()
      .select({ categoryId: products.categoryId })
      .from(products)
      .where(eq(products.id, productId));
    expect(fila?.categoryId).toBe(categoriaOriginal);
  });

  it('se niega a mover a una categoría que no existe', async () => {
    const productId = await createProduct();
    await expect(bulkMoveCategory([productId], 999_999)).rejects.toBeInstanceOf(AdminBulkError);
  });

  it('rechaza una selección vacía o demasiado grande', async () => {
    await expect(bulkSetActive([], false)).rejects.toBeInstanceOf(AdminBulkError);
    const demasiados = Array.from({ length: 501 }, (_, i) => i + 1);
    await expect(bulkSetActive(demasiados, false)).rejects.toBeInstanceOf(AdminBulkError);
  });

  it('un id repetido no se procesa dos veces', async () => {
    const productId = await createProduct();
    // Con precios, procesar dos veces aplicaría el porcentaje dos veces.
    await createVariant({ onHand: 1, pricePyg: 100_000, productId });

    const resultado = await bulkAdjustPrices({
      productIds: [productId, productId, productId],
      percent: 10,
      roundTo: 100,
      reason: MOTIVO,
      actor: ACTOR,
    });

    expect(resultado.cambiadas).toBe(1);
    const [fila] = await getTestDb()
      .select({ pricePyg: variants.pricePyg })
      .from(variants)
      .where(eq(variants.productId, productId));
    expect(fila?.pricePyg).toBe(110_000);
  });
});

describe.skipIf(!hasTestDb)('duplicateProduct', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('la copia nace despublicada, sin stock y sin destacar', async () => {
    const productId = await createProduct();
    await createVariant({ onHand: 42, pricePyg: 100_000, productId });
    await getTestDb().update(products).set({ isFeatured: true }).where(eq(products.id, productId));

    const copiaId = await duplicateProduct(productId);

    const [copia] = await getTestDb().select().from(products).where(eq(products.id, copiaId));
    expect(copia?.isActive).toBe(false);
    expect(copia?.publishedAt).toBeNull();
    expect(copia?.isFeatured).toBe(false);
    expect(copia?.name).toContain('(copia)');
    expect(copia?.slug).toContain('-copia');

    const variantesCopia = await getTestDb()
      .select()
      .from(variants)
      .where(eq(variants.productId, copiaId));
    expect(variantesCopia).toHaveLength(1);
    // El stock es la cifra física de las unidades que hay en la estantería, y
    // no hay dos.
    expect(variantesCopia[0]?.onHand).toBe(0);
    expect(variantesCopia[0]?.pricePyg).toBe(100_000);
    expect(variantesCopia[0]?.sku).toContain('-COPIA');
  });

  it('duplicar dos veces no choca contra el UNIQUE de slug ni de SKU', async () => {
    const productId = await createProduct();
    await createVariant({ onHand: 1, pricePyg: 100_000, productId });

    const primera = await duplicateProduct(productId);
    const segunda = await duplicateProduct(productId);

    expect(primera).not.toBe(segunda);

    const slugs = await getTestDb()
      .select({ slug: products.slug })
      .from(products)
      .where(inArray(products.id, [primera, segunda]));
    expect(new Set(slugs.map((fila) => fila.slug)).size).toBe(2);

    const skus = await getTestDb()
      .select({ sku: variants.sku })
      .from(variants)
      .where(inArray(variants.productId, [primera, segunda]));
    expect(new Set(skus.map((fila) => fila.sku)).size).toBe(2);
  });

  it('no copia las imágenes', async () => {
    // No es una simplificación: `deleteProductImage` borra el asset en
    // Cloudinary, así que dos productos con el mismo `public_id` significan
    // que borrar la foto del duplicado deja al original roto en la vidriera.
    const productId = await createProduct();
    await createVariant({ onHand: 1, pricePyg: 100_000, productId });
    await getTestDb()
      .insert(productImages)
      .values({ productId, cloudinaryId: 'productos/foto' });

    const copiaId = await duplicateProduct(productId);

    const fotos = await getTestDb()
      .select()
      .from(productImages)
      .where(eq(productImages.productId, copiaId));
    expect(fotos).toEqual([]);
  });

  it('rechaza un producto que no existe', async () => {
    await expect(duplicateProduct(999_999)).rejects.toBeInstanceOf(AdminBulkError);
  });
});
