import { eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { categories, priceAdjustments, products, variants } from "@/db/schema";
import type { MessageKey, Params } from "@/i18n";

import { DomainError } from "./errors";
import type { Executor, Tx } from "./executor";

/**
 * Acciones masivas del panel (plan-operacion §5.3 B).
 *
 * El comercio que carga cien productos de una planilla necesita después poder
 * despublicarlos todos, moverlos de categoría, o subirles el precio un 10 %
 * porque cambió el dólar. Hoy eso son cien clicks, y cien clicks es lo mismo
 * que no poder hacerlo.
 *
 * Las cuatro reglas que valen para todo este archivo:
 *
 * 1. **Todo en una transacción.** Media acción masiva aplicada es peor que
 *    ninguna: deja el catálogo en un estado que nadie eligió y que hay que
 *    reconstruir a mano mirando qué quedó y qué no.
 * 2. **Máximo 500 ids.** Es una cota contra el request que el hosting corta a
 *    la mitad, no contra el usuario. Con más, la pantalla parte el trabajo.
 * 3. **El servidor calcula, el navegador pide.** La acción de precios recibe
 *    ids y un porcentaje entero; **cada precio nuevo lo calcula el servidor**
 *    releyendo el viejo con la fila bloqueada. Un precio que viaja desde el
 *    navegador es un precio que se puede editar en el navegador.
 * 4. **Una fila de auditoría por unidad afectada**, como `stock_adjustments`.
 *    Subir un 20 % a doscientas variantes de un click es la operación más
 *    fácil de arrepentirse del panel; sin una fila por variante no hay forma
 *    de mirar qué pasó ni de volverla atrás.
 */

export class AdminBulkError extends DomainError {
  constructor(code: MessageKey, params?: Params) {
    super(code, params);
    this.name = "AdminBulkError";
  }
}

/** Cota por llamada. Ver la regla 2. */
export const BULK_MAX_IDS = 500;

/** El motivo es obligatorio, igual que en los reembolsos y los ajustes de stock. */
export const BULK_MIN_REASON = 5;

/** Los dos redondeos que tienen sentido en guaraníes. */
export const ROUND_TO = [100, 1000] as const;
export type RoundTo = (typeof ROUND_TO)[number];

/** El rango del porcentaje. −90 % es una liquidación; +500 % ya es un error de tipeo. */
export const PERCENT_MIN = -90;
export const PERCENT_MAX = 500;

function validarIds(ids: readonly number[]): number[] {
  // Únicos: la pantalla puede mandar el mismo id dos veces si alguien tocó
  // "seleccionar todo" con un filtro raro, y procesarlo dos veces duplicaría
  // la auditoría (y aplicaría el porcentaje dos veces).
  const unicos = [...new Set(ids)].filter(
    (id) => Number.isInteger(id) && id > 0
  );
  if (unicos.length === 0)
    throw new AdminBulkError("adminError.masivo.sinSeleccion");
  if (unicos.length > BULK_MAX_IDS) {
    throw new AdminBulkError("adminError.masivo.demasiados", {
      maximo: BULK_MAX_IDS,
    });
  }
  return unicos;
}

/** Publicar o despublicar productos de una. Staff (`productos`). */
export async function bulkSetActive(
  productIds: readonly number[],
  isActive: boolean,
  executor?: Executor
): Promise<number> {
  const ids = validarIds(productIds);
  const tx = executor ?? getDb();

  const result = await tx
    .update(products)
    .set({ isActive })
    .where(inArray(products.id, ids));

  return afectadas(result);
}

/**
 * Mover productos a otra categoría. Staff (`productos`).
 *
 * La categoría destino tiene que existir **y estar activa**: mover cien
 * productos a una categoría apagada los saca a todos de la vidriera de una
 * sola vez (el filtro `PUBLISHED()` exige la categoría activa desde el PR J),
 * y nadie que aprieta "mover" está pidiendo eso.
 */
export async function bulkMoveCategory(
  productIds: readonly number[],
  categoryId: number,
  executor?: Executor
): Promise<number> {
  const ids = validarIds(productIds);

  const run = async (tx: Tx | Executor): Promise<number> => {
    const destino = await tx
      .select({ id: categories.id, isActive: categories.isActive })
      .from(categories)
      .where(eq(categories.id, categoryId))
      .limit(1);

    if (!destino[0])
      throw new AdminBulkError("adminError.masivo.categoriaNoExiste");
    if (!destino[0].isActive)
      throw new AdminBulkError("adminError.masivo.categoriaApagada");

    const result = await tx
      .update(products)
      .set({ categoryId })
      .where(inArray(products.id, ids));

    return afectadas(result);
  };

  return executor ? run(executor) : getDb().transaction(run);
}

export type BulkPriceInput = {
  /** Una de las dos, no las dos: variantes sueltas o todas las de estos productos. */
  variantIds?: readonly number[];
  productIds?: readonly number[];
  /** Entero, en `[-90, 500]`. */
  percent: number;
  roundTo: RoundTo;
  reason: string;
  actor: string;
  actorUserId?: number | null;
};

export type BulkPriceResult = {
  /** Cuántas variantes cambiaron de precio de verdad. */
  cambiadas: number;
  /** Cuántas se miraron (algunas quedan igual por el redondeo). */
  miradas: number;
  /** La suma de las diferencias, con signo. Para poder decir "+₲1.240.000". */
  diferenciaPyg: number;
};

/**
 * El precio nuevo de uno viejo, en enteros y redondeado (plan-operacion §5.3 B).
 *
 * Exportada para que el test pueda fijar los dos casos que importan sin pasar
 * por la base, y para que S10 pueda dibujar la vista previa con **exactamente**
 * la misma cuenta que va a aplicar el servidor.
 *
 * Dos decisiones adentro:
 *
 * - **Se multiplica antes de dividir.** `precio * (100 + percent) / 100` en ese
 *   orden mantiene la precisión; al revés, un `precio / 100` de un número que
 *   no es múltiplo de 100 ya perdió plata antes de aplicar el porcentaje.
 * - **Nunca ₲0.** Un −90 % sobre ₲990 redondeado a ₲100 daría ₲100 (bien),
 *   pero sobre ₲500 daría ₲50 → redondeado, ₲100 igual, y sobre ₲50 daría ₲0:
 *   un producto gratis en la vidriera. El piso es `roundTo`.
 */
export function precioAjustado(
  fromPyg: number,
  percent: number,
  roundTo: RoundTo
): number {
  const bruto = Math.round((fromPyg * (100 + percent)) / 100);
  const redondeado = Math.round(bruto / roundTo) * roundTo;
  return Math.max(roundTo, redondeado);
}

/**
 * Ajusta precios en masa. **Owner** (capability `precios.masivo`).
 *
 * Owner y no staff, por lo mismo que los reembolsos: el error no se ve y no se
 * puede deshacer con un botón. Un +10 % de más se descubre cuando ya se vendió
 * a ese precio, y sin `price_adjustments` no habría siquiera forma de saber
 * cuál era el precio de antes.
 */
export async function bulkAdjustPrices(
  input: BulkPriceInput
): Promise<BulkPriceResult> {
  const reason = input.reason.trim();
  if (reason.length < BULK_MIN_REASON) {
    throw new AdminBulkError("adminError.masivo.sinMotivo");
  }
  if (!Number.isInteger(input.percent)) {
    throw new AdminBulkError("adminError.masivo.porcentajeEntero");
  }
  if (input.percent < PERCENT_MIN || input.percent > PERCENT_MAX) {
    throw new AdminBulkError("adminError.masivo.porcentajeFuera", {
      min: PERCENT_MIN,
      max: PERCENT_MAX,
    });
  }
  if (!(ROUND_TO as readonly number[]).includes(input.roundTo)) {
    throw new AdminBulkError("adminError.masivo.redondeoInvalido");
  }
  // Un 0 % no es un error, pero tampoco es una operación: no cambia ni un
  // precio y dejaría cero filas de auditoría. Se corta antes de bloquear 500
  // filas para nada.
  if (input.percent === 0)
    return { cambiadas: 0, miradas: 0, diferenciaPyg: 0 };

  const porVariante = input.variantIds !== undefined;
  const ids = validarIds(
    porVariante ? input.variantIds! : (input.productIds ?? [])
  );

  return getDb().transaction(async (tx) => {
    // `FOR UPDATE` sobre todas las variantes afectadas, en orden de id: dos
    // ajustes masivos simultáneos que se solapan se ordenan en vez de
    // deadlockearse cruzados (misma regla que `secureStockForPayment`).
    const filas = await tx
      .select({ id: variants.id, pricePyg: variants.pricePyg })
      .from(variants)
      .where(
        porVariante
          ? inArray(variants.id, ids)
          : inArray(variants.productId, ids)
      )
      .orderBy(variants.id)
      .for("update");

    let cambiadas = 0;
    let diferenciaPyg = 0;

    for (const fila of filas) {
      const nuevo = precioAjustado(fila.pricePyg, input.percent, input.roundTo);
      // El redondeo puede dejar el precio igual (un +1 % sobre ₲10.000
      // redondeado a ₲1.000). No es un cambio y no deja fila: una auditoría
      // llena de "de ₲10.000 a ₲10.000" es una auditoría que nadie lee.
      if (nuevo === fila.pricePyg) continue;

      await tx
        .update(variants)
        .set({ pricePyg: nuevo })
        .where(eq(variants.id, fila.id));

      await tx.insert(priceAdjustments).values({
        variantId: fila.id,
        fromPyg: fila.pricePyg,
        toPyg: nuevo,
        reason: reason.slice(0, 500),
        actor: input.actor,
        actorUserId: input.actorUserId ?? null,
      });

      cambiadas += 1;
      diferenciaPyg += nuevo - fila.pricePyg;
    }

    return { cambiadas, miradas: filas.length, diferenciaPyg };
  });
}

/**
 * La vista previa de un ajuste masivo, sin escribir nada (S10 la dibuja).
 *
 * Existe porque "subir 10 % a 200 variantes" es irreversible en la práctica, y
 * el dueño tiene derecho a ver la suma antes de apretar. Usa `precioAjustado`,
 * la misma función que aplica el ajuste: si la vista previa y la escritura
 * usaran cuentas distintas, la vista previa sería peor que no tenerla.
 */
export async function previewPriceAdjustment(
  input: {
    variantIds?: readonly number[];
    productIds?: readonly number[];
    percent: number;
    roundTo: RoundTo;
  },
  executor?: Executor
): Promise<
  BulkPriceResult & {
    ejemplos: Array<{ variantId: number; from: number; to: number }>;
  }
> {
  const porVariante = input.variantIds !== undefined;
  const ids = validarIds(
    porVariante ? input.variantIds! : (input.productIds ?? [])
  );
  const tx = executor ?? getDb();

  const filas = await tx
    .select({ id: variants.id, pricePyg: variants.pricePyg })
    .from(variants)
    .where(
      porVariante ? inArray(variants.id, ids) : inArray(variants.productId, ids)
    )
    .orderBy(variants.id);

  let cambiadas = 0;
  let diferenciaPyg = 0;
  const ejemplos: Array<{ variantId: number; from: number; to: number }> = [];

  for (const fila of filas) {
    const nuevo = precioAjustado(fila.pricePyg, input.percent, input.roundTo);
    if (nuevo === fila.pricePyg) continue;
    cambiadas += 1;
    diferenciaPyg += nuevo - fila.pricePyg;
    // Cinco alcanzan para que el dueño reconozca lo que está por hacer; la
    // lista entera de 200 filas en un diálogo no la lee nadie.
    if (ejemplos.length < 5) {
      ejemplos.push({ variantId: fila.id, from: fila.pricePyg, to: nuevo });
    }
  }

  return { cambiadas, miradas: filas.length, diferenciaPyg, ejemplos };
}

/**
 * Duplicar un producto (plan-operacion §5.3 C). Staff (`productos`).
 *
 * Nace **despublicado** (`is_active = false`, `published_at = NULL`,
 * `is_featured = false`) y con `on_hand = 0` en todas sus variantes: la copia
 * es un borrador para editar, no un producto que aparece en la vidriera con el
 * stock de otro.
 *
 * **No copia las imágenes, y no es una simplificación.** `deleteProductImage`
 * borra el asset en Cloudinary, no sólo la fila: dos productos apuntando al
 * mismo `public_id` significan que borrar una foto del duplicado deja al
 * original con una imagen rota, en la vidriera, sin ningún aviso. Copiar los
 * bytes en Cloudinary sería la alternativa correcta y cuesta una llamada por
 * imagen a una API que puede fallar a mitad; hasta que alguien lo necesite de
 * verdad, la copia se sube las fotos de nuevo.
 */
export async function duplicateProduct(productId: number): Promise<number> {
  return getDb().transaction(async (tx) => {
    const originales = await tx
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    const original = originales[0];
    if (!original)
      throw new AdminBulkError("adminError.masivo.productoNoExiste");

    const slug = await slugLibre(tx, original.slug);

    await tx.insert(products).values({
      slug,
      name: `${original.name} (copia)`.slice(0, 200),
      saleMode: original.saleMode,
      showPrice: original.showPrice,
      description: original.description,
      categoryId: original.categoryId,
      brand: original.brand,
      ivaRate: original.ivaRate,
      isActive: false,
      isFeatured: false,
      publishedAt: null,
    });

    const creados = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.slug, slug))
      .limit(1);
    const nuevoId = creados[0]?.id;
    if (!nuevoId) throw new AdminBulkError("adminError.masivo.noPude");

    const variantesOriginales = await tx
      .select()
      .from(variants)
      .where(eq(variants.productId, productId))
      .orderBy(variants.position, variants.id);

    for (const variante of variantesOriginales) {
      await tx.insert(variants).values({
        productId: nuevoId,
        sku: await skuLibre(tx, variante.sku),
        label: variante.label,
        pricePyg: variante.pricePyg,
        compareAtPyg: variante.compareAtPyg,
        reorderPoint: variante.reorderPoint,
        isActive: variante.isActive,
        position: variante.position,
        // El stock **no** se copia: es la cifra física de las unidades que hay
        // en la estantería, y no hay dos.
        onHand: 0,
      });
    }

    return nuevoId;
  });
}

/** `remera` → `remera-copia`, `remera-copia-2`, … El slug es UNIQUE. */
async function slugLibre(tx: Executor, base: string): Promise<string> {
  for (let intento = 1; intento <= 50; intento += 1) {
    const candidato =
      intento === 1 ? `${base}-copia` : `${base}-copia-${intento}`;
    const recortado = candidato.slice(0, 160);
    const choque = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.slug, recortado))
      .limit(1);
    if (!choque[0]) return recortado;
  }
  throw new AdminBulkError("adminError.masivo.demasiadasCopias");
}

/** `SKU-1` → `SKU-1-COPIA`, `SKU-1-COPIA-2`, … El SKU también es UNIQUE. */
async function skuLibre(tx: Executor, base: string): Promise<string> {
  for (let intento = 1; intento <= 50; intento += 1) {
    const candidato =
      intento === 1 ? `${base}-COPIA` : `${base}-COPIA-${intento}`;
    const recortado = candidato.slice(0, 64);
    const choque = await tx
      .select({ id: variants.id })
      .from(variants)
      .where(eq(variants.sku, recortado))
      .limit(1);
    if (!choque[0]) return recortado;
  }
  throw new AdminBulkError("adminError.masivo.demasiadasCopias");
}

/** El historial de precios de una variante, para la ficha del producto. */
export async function listPriceAdjustments(
  variantId: number,
  limit = 20,
  executor?: Executor
) {
  const tx = executor ?? getDb();
  return tx
    .select()
    .from(priceAdjustments)
    .where(eq(priceAdjustments.variantId, variantId))
    .orderBy(
      sql`${priceAdjustments.createdAt} DESC, ${priceAdjustments.id} DESC`
    )
    .limit(limit);
}

/** mysql2 devuelve `[ResultSetHeader, FieldPacket[]]`: `affectedRows` va en el primero. */
function afectadas(result: unknown): number {
  const header = (result as Array<{ affectedRows?: number }>)[0];
  return Number(header?.affectedRows ?? 0);
}
