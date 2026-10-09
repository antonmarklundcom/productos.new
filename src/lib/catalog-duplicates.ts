import { parseRef } from "./imagenes-r2";

type Identity = {
  slug: string;
  name: string;
  categoryName: string;
  fotos: string[];
  dropiUrl?: string | null;
};
function tokens(name: string) {
  const stop = new Set([
    "de",
    "del",
    "la",
    "el",
    "para",
    "con",
    "y",
    "en",
    "un",
    "una",
  ]);
  return new Set(
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word && !stop.has(word))
      .map((word) =>
        word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word
      )
  );
}
function photoKey(ref: string) {
  const parsed = parseRef(ref);
  if (parsed) return parsed.base.slice(-10); // Hash survives differently named R2 copies.
  try {
    const url = new URL(ref);
    return `${url.host}${url.pathname}`;
  } catch {
    return ref;
  }
}

/** Review signals, not proof: different kits/models can share photos and names. */
export function catalogDuplicateWarnings(
  incoming: Identity[],
  existing: Identity[]
): string[] {
  const warnings = new Set<string>();
  for (const product of incoming) {
    const a = tokens(product.name);
    const photos = new Set(product.fotos.map(photoKey));
    for (const other of [...existing, ...incoming]) {
      if (other.slug === product.slug) continue;
      const b = tokens(other.name);
      const overlap = [...a].filter((word) => b.has(word)).length;
      const similarName =
        product.categoryName.trim().toLocaleLowerCase() ===
          other.categoryName.trim().toLocaleLowerCase() &&
        overlap >= 2 &&
        overlap / Math.min(a.size, b.size) >= 0.8;
      const sharedPhoto = other.fotos.some((photo) =>
        photos.has(photoKey(photo))
      );
      const dropiId = product.dropiUrl?.match(
        /\/product-details\/(\d+)(?:\/|$)/
      )?.[1];
      const sameDropi = Boolean(
        dropiId &&
        dropiId ===
          other.dropiUrl?.match(/\/product-details\/(\d+)(?:\/|$)/)?.[1]
      );
      if (similarName || sharedPhoto || sameDropi) {
        const names = [product.name, other.name].sort().join(" / ");
        warnings.add(
          `Posible producto repetido: ${names}. ${sameDropi ? "Comparten el mismo ID de Dropi." : sharedPhoto ? "Comparten una foto." : "Los nombres describen productos similares."} Compará modelo, medidas, contenido del kit y proveedor antes de importar.`
        );
      }
    }
  }
  const result = [...warnings].sort();
  return result.length > 20
    ? [
        ...result.slice(0, 20),
        `${result.length - 20} coincidencias adicionales: revisá el catálogo completo antes de confirmar.`,
      ]
    : result;
}
