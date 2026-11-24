import { describe, expect, it } from "vitest";

import {
  childCategories,
  parentCategory,
  parentProblem,
  topLevelCategories,
} from "@/lib/category-tree";

const rows = [
  { id: 1, slug: "hogar", name: "Hogar", parentId: null },
  { id: 2, slug: "bano", name: "Baño", parentId: 1 },
  { id: 3, slug: "ninos", name: "Niños y bebés", parentId: null },
  { id: 4, slug: "juguetes", name: "Juguetes", parentId: 3 },
  // Its parent (id 9) is switched off, so it is not in the public list.
  { id: 5, slug: "huerfana", name: "Huérfana", parentId: 9 },
];

describe("category tree", () => {
  it("lists main categories, including children of a hidden parent", () => {
    expect(topLevelCategories(rows).map((row) => row.slug)).toEqual(["hogar", "ninos", "huerfana"]);
  });

  it("finds children and parent", () => {
    expect(childCategories(rows, rows[0]!).map((row) => row.slug)).toEqual(["bano"]);
    expect(parentCategory(rows, rows[3]!)?.slug).toBe("ninos");
    expect(parentCategory(rows, rows[0]!)).toBeNull();
  });

  it("treats initial categories without ids as main categories", () => {
    const initial = [{ slug: "mascotas", name: "Mascotas" }];
    expect(topLevelCategories(initial)).toEqual(initial);
    expect(childCategories(initial, initial[0]!)).toEqual([]);
  });

  it("allows exactly one level", () => {
    expect(parentProblem({ parentId: null }, rows)).toBeNull();
    expect(parentProblem({ parentId: 1 }, rows)).toBeNull();
    expect(parentProblem({ selfId: 2, parentId: 3 }, rows)).toBeNull();
    expect(parentProblem({ parentId: 2 }, rows)).toBe("adminError.categoria.padreEsSubcategoria");
    expect(parentProblem({ parentId: 99 }, rows)).toBe("adminError.categoria.padreNoExiste");
    expect(parentProblem({ selfId: 1, parentId: 1 }, rows)).toBe("adminError.categoria.padreEsElla");
    expect(parentProblem({ selfId: 1, parentId: 3 }, rows)).toBe("adminError.categoria.tieneSubcategorias");
  });
});
