/**
 * Categorías en dos niveles: una categoría principal (`parentId` nulo) y sus
 * subcategorías. Las funciones aceptan también las categorías iniciales de
 * `src/config/tienda.ts`, que no traen `id` ni `parentId`: ahí todo es
 * principal y nada tiene hijos.
 *
 * Una subcategoría cuyo padre no está en la lista (porque el padre está
 * apagado) se muestra como principal: apagar el padre no esconde a los hijos
 * de la navegación, igual que hoy no los esconde de su propia página.
 */
export type TreeCategory = {
  slug: string;
  name: string;
  id?: number;
  parentId?: number | null;
};

const parentOf = (category: TreeCategory) => category.parentId ?? null;

// `A` es el arreglo entero y no su elemento: `storeCategories()` devuelve la
// unión de las filas de la base y las categorías iniciales.
export function topLevelCategories<A extends readonly TreeCategory[]>(all: A): A[number][] {
  return all.filter((category: TreeCategory) => {
    const parentId = parentOf(category);
    return parentId === null || !all.some((other) => other.id === parentId);
  });
}

export function childCategories<A extends readonly TreeCategory[]>(
  all: A,
  parent: TreeCategory
): A[number][] {
  if (parent.id === undefined) return [];
  return all.filter((category: TreeCategory) => parentOf(category) === parent.id);
}

export function parentCategory<A extends readonly TreeCategory[]>(
  all: A,
  child: TreeCategory
): A[number] | null {
  const parentId = parentOf(child);
  if (parentId === null) return null;
  return all.find((category: TreeCategory) => category.id === parentId) ?? null;
}

export type ParentProblem =
  | "adminError.categoria.padreNoExiste"
  | "adminError.categoria.padreEsSubcategoria"
  | "adminError.categoria.padreEsElla"
  | "adminError.categoria.tieneSubcategorias";

/**
 * Valida la categoría principal elegida para una categoría (nueva si no hay
 * `selfId`). Un solo nivel: la principal no puede ser subcategoría, y una
 * categoría con hijas no puede pasar a ser hija.
 */
export function parentProblem(
  input: { selfId?: number; parentId: number | null },
  rows: readonly { id: number; parentId: number | null }[]
): ParentProblem | null {
  if (input.parentId === null) return null;
  if (input.parentId === input.selfId) return "adminError.categoria.padreEsElla";
  const parent = rows.find((row) => row.id === input.parentId);
  if (!parent) return "adminError.categoria.padreNoExiste";
  if (parent.parentId !== null) return "adminError.categoria.padreEsSubcategoria";
  if (input.selfId !== undefined && rows.some((row) => row.parentId === input.selfId))
    return "adminError.categoria.tieneSubcategorias";
  return null;
}
