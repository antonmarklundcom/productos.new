import { and, asc, count, eq, isNotNull, ne, sql } from 'drizzle-orm';
import type { MessageKey, Params } from '@/i18n';

import { DomainError } from './errors';

import { getDb } from '@/db';
import { categories, products } from '@/db/schema';
import { slugify } from '@/lib/slug';

import type { Executor } from './executor';

/**
 * ABM de categorías (PLAN.md FASE 2, PR J).
 *
 * Hasta ahora esta tabla la escribía **sólo el seed**: una tienda que quería
 * una categoría nueva necesitaba un desarrollador con acceso a la base. Es
 * exactamente el tipo de llamada que el template existe para no recibir.
 *
 * Tres cosas que conviene tener claras antes de leer el código:
 *
 * 1. **Nada se borra.** `products.category_id` es una FK con `ON DELETE
 *    RESTRICT`, así que MySQL ya rechaza borrar una categoría con productos
 *    adentro; y borrar una vacía tampoco se ofrece, por la misma razón que no
 *    se borran usuarios: la URL `/categoria/<slug>` puede estar compartida por
 *    WhatsApp o indexada, y una fila desactivada explica qué pasó mientras que
 *    una fila que no existe no explica nada. Desactivar es la baja.
 *
 * 2. **`position` se reescribe entero en cada movimiento.** Mover una fila
 *    intercambiando su `position` con la del vecino parece más barato y se
 *    rompe con posiciones repetidas —dos categorías del seed en 0, dos
 *    tiendas clonadas de la misma— dejando un orden que no cambia por más que
 *    el dueño apriete el botón. Renumerar `0..n-1` adentro de la transacción
 *    cuesta un UPDATE por fila (hay diez categorías, no diez mil) y arregla
 *    el desorden que hubiera.
 *
 * 3. **`parent_id` existe en el schema y este ABM no lo toca.** La vidriera
 *    lista las categorías en plano (`getCategories`), así que una jerarquía
 *    editable acá sería una columna que el dueño llena y nadie muestra. El día
 *    que la vidriera dibuje subcategorías, este archivo es el lugar.
 */

export class AdminCategoryError extends DomainError {
  constructor(code: MessageKey, params?: Params) {
    super(code, params);
    this.name = 'AdminCategoryError';
  }
}

export type AdminCategoryRow = {
  id: number;
  slug: string;
  name: string;
  position: number;
  isActive: boolean;
  /** Productos que apuntan acá, en cualquier estado. */
  productos: number;
  /**
   * De ésos, los que la vidriera muestra hoy. Es el número que importa al
   * desactivar: es la cantidad exacta de fichas que desaparecen del sitio.
   */
  publicados: number;
  /**
   * Los tres campos de presentación (O7), para que el formulario de edición
   * prellene lo que la categoría ya tiene en vez de pedirlos a ciegas. Sin
   * ellos el panel tenía que ofrecer un "cambiar descripción o foto"
   * destildado, que es lo que esta fase viene a borrar.
   */
  description: string | null;
  imageCloudinaryId: string | null;
  imageAlt: string | null;
};

const PUBLICADO = sql<number>`SUM(CASE WHEN ${products.isActive} = 1 AND ${products.publishedAt} IS NOT NULL THEN 1 ELSE 0 END)`;

/**
 * Todas las categorías, activas e inactivas, con cuántos productos cuelgan de
 * cada una.
 *
 * `LEFT JOIN` y no `INNER`: una categoría recién creada no tiene productos y
 * es justamente la que el dueño necesita ver para empezar a llenarla.
 */
export async function listAdminCategories(executor?: Executor): Promise<AdminCategoryRow[]> {
  const tx = executor ?? getDb();

  const rows = await tx
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      position: categories.position,
      isActive: categories.isActive,
      description: categories.description,
      imageCloudinaryId: categories.imageCloudinaryId,
      imageAlt: categories.imageAlt,
      productos: count(products.id),
      publicados: PUBLICADO,
    })
    .from(categories)
    .leftJoin(products, eq(products.categoryId, categories.id))
    .groupBy(
      categories.id,
      categories.slug,
      categories.name,
      categories.position,
      categories.isActive,
      categories.description,
      categories.imageCloudinaryId,
      categories.imageAlt,
    )
    .orderBy(asc(categories.position), asc(categories.id));

  return rows.map((row) => ({
    ...row,
    productos: Number(row.productos ?? 0),
    // `SUM()` sobre cero filas devuelve NULL, y en mysql2 llega como string
    // cuando hay filas. Las dos cosas pasan por Number() y terminan en 0.
    publicados: Number(row.publicados ?? 0),
  }));
}

/** El nombre y el slug, validados igual en el alta y en la edición. */
function normalizar(input: { name: string; slug?: string | null }): { name: string; slug: string } {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2) throw new AdminCategoryError('adminError.categoria.nombreCorto');
  if (name.length > 120) throw new AdminCategoryError('adminError.categoria.nombreLargo');

  // Sin slug propio, sale del nombre. Con slug propio, igual se normaliza: lo
  // que se guarda tiene que ser lo que entra en una URL, y no la versión con
  // mayúsculas y espacios que alguien pegó de un Word.
  const slug = slugify(input.slug?.trim() || name);
  if (slug.length === 0) {
    throw new AdminCategoryError('adminError.categoria.sinUrl');
  }
  if (slug.length > 120) throw new AdminCategoryError('adminError.categoria.slugLargo');

  return { name, slug };
}

/**
 * Los tres campos de presentación que agrega O7 (plan-operacion §5.3 E).
 *
 * `undefined` = no se toca; `null` = borrar. La diferencia importa: un
 * formulario que no dibuja estos campos —el de hoy, hasta S10— no puede
 * borrarle la foto a una categoría de paso al renombrarla.
 */
export type CategoryPresentation = {
  description?: string | null;
  imageCloudinaryId?: string | null;
  imageAlt?: string | null;
};

/** Sólo las claves presentes, ya trimmeadas; `''` entra como `null`. */
function presentacion(input: CategoryPresentation): Record<string, string | null> {
  const campos: Record<string, string | null> = {};
  if (input.description !== undefined) campos.description = input.description?.trim() || null;
  if (input.imageCloudinaryId !== undefined) {
    campos.imageCloudinaryId = input.imageCloudinaryId?.trim() || null;
  }
  if (input.imageAlt !== undefined) campos.imageAlt = input.imageAlt?.trim() || null;
  return campos;
}

export async function createCategory(input: {
  name: string;
  slug?: string | null;
} & CategoryPresentation): Promise<AdminCategoryRow> {
  const { name, slug } = normalizar(input);

  return getDb().transaction(async (tx) => {
    const existing = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, slug))
      .limit(1);
    if (existing[0]) {
      throw new AdminCategoryError('adminError.categoria.urlRepetida', { slug });
    }

    // Al final de la lista: una categoría nueva no tiene por qué empujar a las
    // que el dueño ya ordenó.
    const [ultima] = await tx
      .select({ n: sql<number>`COALESCE(MAX(${categories.position}), -1)` })
      .from(categories);

    await tx.insert(categories).values({
      name,
      slug,
      position: Number(ultima?.n ?? -1) + 1,
      ...presentacion(input),
    });

    const created = await tx.select().from(categories).where(eq(categories.slug, slug)).limit(1);
    const row = created[0];
    if (!row) throw new AdminCategoryError('adminError.categoria.noPude');

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      position: row.position,
      isActive: row.isActive,
      description: row.description,
      imageCloudinaryId: row.imageCloudinaryId,
      imageAlt: row.imageAlt,
      productos: 0,
      publicados: 0,
    };
  });
}

/**
 * Renombrar, y opcionalmente cambiar la URL.
 *
 * Cambiar el slug **rompe los links viejos**: la URL anterior pasa a devolver
 * 404 y no hay redirección, porque el schema no guarda los slugs históricos.
 * El dominio no lo prohíbe —a veces es justo lo que hace falta— pero la
 * pantalla lo avisa antes de guardar.
 */
export async function updateCategory(input: {
  categoryId: number;
  name: string;
  slug?: string | null;
} & CategoryPresentation): Promise<void> {
  const { name, slug } = normalizar(input);

  return getDb().transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(categories)
      .where(eq(categories.id, input.categoryId))
      .limit(1)
      .for('update');
    const category = rows[0];
    if (!category) throw new AdminCategoryError('adminError.categoria.noExiste');

    const choque = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.slug, slug), ne(categories.id, category.id)))
      .limit(1);
    if (choque[0]) throw new AdminCategoryError('adminError.categoria.urlRepetidaOtra', { slug });

    await tx
      .update(categories)
      .set({ name, slug, ...presentacion(input) })
      .where(eq(categories.id, category.id));
  });
}

/**
 * La foto de la categoría, ya subida a Cloudinary.
 *
 * Devuelve el `public_id` que había antes (o `null`) para que la acción borre
 * ese asset del CDN. El borrado se hace **después** de que la fila apunte a la
 * foto nueva y nunca adentro de esta función: si Cloudinary está caído, la
 * categoría ya quedó bien y lo único que pasa es que sobra un archivo.
 *
 * A diferencia de `updateCategory`, no toca nombre ni slug: subir una foto no
 * es el momento de re-validar la URL de la categoría.
 */
export async function setCategoryImage(input: {
  categoryId: number;
  imageCloudinaryId: string;
  imageAlt?: string | null;
}): Promise<{ previousCloudinaryId: string | null }> {
  return getDb().transaction(async (tx) => {
    const rows = await tx
      .select({ id: categories.id, imageCloudinaryId: categories.imageCloudinaryId })
      .from(categories)
      .where(eq(categories.id, input.categoryId))
      .limit(1)
      .for('update');
    const category = rows[0];
    if (!category) throw new AdminCategoryError('adminError.categoria.noExiste');

    await tx
      .update(categories)
      .set({
        imageCloudinaryId: input.imageCloudinaryId,
        // `undefined` no toca el alt que ya había: quien sólo reemplaza la
        // foto no tiene por qué volver a escribir la descripción.
        ...(input.imageAlt === undefined ? {} : { imageAlt: input.imageAlt?.trim() || null }),
      })
      .where(eq(categories.id, category.id));

    return {
      previousCloudinaryId:
        category.imageCloudinaryId === input.imageCloudinaryId
          ? null
          : category.imageCloudinaryId,
    };
  });
}

/**
 * Activar o desactivar.
 *
 * Desactivar una categoría **le saca de la vidriera también a sus productos**:
 * desde el PR J el filtro `PUBLISHED()` de `src/db/queries.ts` exige que la
 * categoría esté activa. Antes no era así y el resultado era incoherente — la
 * categoría desaparecía del menú y devolvía 404, pero sus productos seguían en
 * la home, en el buscador y en el sitemap, con una miga de pan que llevaba a
 * esa página 404. Ahora apagar una categoría apaga la rama entera, que es lo
 * único que el botón puede significar.
 *
 * Por eso `listAdminCategories` devuelve `publicados`: la pantalla puede decir
 * "se dejan de ver 14 productos" antes de que el dueño confirme, en vez de
 * enterarse por una venta que no llegó.
 *
 * No se bloquea desactivar la última: una tienda que cierra por dos semanas es
 * un caso real, y el dueño es el dueño. Lo que sí hace la pantalla es decirlo
 * con todas las letras.
 */
export async function setCategoryActive(input: {
  categoryId: number;
  isActive: boolean;
}): Promise<void> {
  const db = getDb();

  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, input.categoryId))
    .limit(1);
  if (!rows[0]) throw new AdminCategoryError('adminError.categoria.noExiste');

  await db
    .update(categories)
    .set({ isActive: input.isActive })
    .where(eq(categories.id, input.categoryId));
}

/**
 * Subir o bajar una categoría un lugar en el menú.
 *
 * Renumera todas las filas a `0..n-1` adentro de la transacción (ver el
 * comentario 2 de la cabecera). Bloquea el conjunto con `FOR UPDATE` porque
 * dos pestañas ordenando a la vez sobre la misma foto vieja dejan el orden en
 * cualquier lado.
 */
export async function moveCategory(input: {
  categoryId: number;
  direction: 'up' | 'down';
}): Promise<void> {
  return getDb().transaction(async (tx) => {
    const rows = await tx
      .select({ id: categories.id, position: categories.position })
      .from(categories)
      .orderBy(asc(categories.position), asc(categories.id))
      .for('update');

    const index = rows.findIndex((row) => row.id === input.categoryId);
    if (index === -1) throw new AdminCategoryError('adminError.categoria.noExiste');

    const target = input.direction === 'up' ? index - 1 : index + 1;
    // Fuera de rango no es un error: es el botón de la primera fila. Renumerar
    // igual no molesta y de paso limpia posiciones repetidas.
    if (target >= 0 && target < rows.length) {
      const moved = rows[index]!;
      rows[index] = rows[target]!;
      rows[target] = moved;
    }

    for (const [position, row] of rows.entries()) {
      if (row.position === position) continue;
      await tx.update(categories).set({ position }).where(eq(categories.id, row.id));
    }
  });
}

/**
 * Las categorías que el formulario de productos puede ofrecer.
 *
 * Incluye las inactivas a propósito: un producto ya guardado en una categoría
 * apagada tiene que poder seguir editándose sin que el `<select>` le cambie la
 * categoría por debajo. La pantalla las marca.
 */
export async function categoriesForProductForm(
  executor?: Executor,
): Promise<Array<{ id: number; name: string; isActive: boolean }>> {
  const tx = executor ?? getDb();
  return tx
    .select({ id: categories.id, name: categories.name, isActive: categories.isActive })
    .from(categories)
    .orderBy(asc(categories.position), asc(categories.id));
}

/** Cuántos productos publicados dejarían de verse si se apaga esta categoría. */
export async function publishedCountForCategory(
  categoryId: number,
  executor?: Executor,
): Promise<number> {
  const tx = executor ?? getDb();
  const rows = await tx
    .select({ n: count() })
    .from(products)
    .where(
      and(
        eq(products.categoryId, categoryId),
        eq(products.isActive, true),
        isNotNull(products.publishedAt),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}
