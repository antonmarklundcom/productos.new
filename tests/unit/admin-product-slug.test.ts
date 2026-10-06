import { describe, expect, it, vi } from 'vitest';

/**
 * El techo del slug de producto (O14, G4).
 *
 * `products.slug` es VARCHAR(160). Sin `.max(160)` en el schema de la acción,
 * un slug más largo llegaba entero a MySQL, se truncaba ahí, y dos productos
 * distintos terminaban apuntando a la misma URL — el segundo guardado
 * fallando por el índice único con un error que no explica nada. El rechazo
 * tiene que pasar **antes** de tocar la base, y decirlo en castellano.
 *
 * Se mockean el guard y el dominio porque acá no se prueban ninguno de los
 * dos (eso son `admin-guards.test.ts` y los tests de integración): se prueba
 * la validación de entrada, y de paso que un slug válido llegue a escribir.
 */
vi.mock('@/lib/admin-guard', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/admin-guard')>();
  return {
    ...original,
    requireStaffSession: vi.fn(async () => ({ userId: 1, role: 'staff' as const })),
  };
});

const createProduct = vi.fn(async () => 7);
vi.mock('@/domain/admin-products', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/domain/admin-products')>()),
  createProduct: (...args: unknown[]) => createProduct(...(args as [])),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const ENTRADA = {
  name: 'Remera',
  categoryId: 1,
  ivaRate: 10 as const,
  isActive: true,
  published: true,
};

describe('el slug de un producto', () => {
  it('rechaza 161 caracteres con un mensaje, sin tocar la base', async () => {
    const { saveProduct } = await import('@/app/actions/admin-products');

    const resultado = await saveProduct({ ...ENTRADA, slug: 'a'.repeat(161) });

    expect(resultado).toEqual({ ok: false, error: 'El slug no puede pasar los 160 caracteres.' });
    expect(createProduct).not.toHaveBeenCalled();
  });

  it('acepta 160 justos (el largo exacto de la columna)', async () => {
    const { saveProduct } = await import('@/app/actions/admin-products');

    const resultado = await saveProduct({ ...ENTRADA, slug: 'a'.repeat(160) });

    expect(resultado).toEqual({ ok: true, productId: 7 });
    expect(createProduct).toHaveBeenCalledOnce();
  });

  it('pasa isFeatured al dominio tal como viene (undefined = no tocar)', async () => {
    const { saveProduct } = await import('@/app/actions/admin-products');
    createProduct.mockClear();

    await saveProduct({ ...ENTRADA, slug: 'remera-destacada', isFeatured: true });

    expect(createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'remera-destacada', isFeatured: true }),
    );
  });
});
