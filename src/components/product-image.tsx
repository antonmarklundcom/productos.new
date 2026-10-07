import Image from "next/image";

import { t } from "@/i18n/client";
import {
  categoryPlaceholderSrc,
  productImageUrl,
  productImageSources,
  type ImageSize,
} from "@/lib/images";
import { cn } from "@/lib/utils";
import type { CatalogImage } from "@/db/queries";
import { publicBase } from "@/lib/imagenes-r2";

/**
 * == S18 ==
 * Las cuatro categorías del seed, tal como las conoce
 * `CATEGORY_PLACEHOLDERS` de `src/lib/images.ts` — duplicado acá a
 * propósito y no importado: ese archivo es `src/lib/**`, fuera de los
 * límites duros de esta fase (plan-crecimiento §4.7), así que no se puede
 * exportar la lista desde ahí sin tocarlo. Si una tienda le agrega una
 * quinta categoría "conocida" en `images.ts`, este set no se entera —está
 * documentado acá para que quien la agregue sepa dónde mirar.
 */
const CATEGORIAS_CONOCIDAS = new Set([
  "electronica",
  "hogar-y-cocina",
  "moda",
  "deportes",
]);

/** `"hogar-y-cocina"` → `"Hogar y cocina"`. Sólo para el texto del placeholder. */
function nombreLegible(categorySlug: string): string {
  const palabras = categorySlug.split("-").filter(Boolean);
  if (palabras.length === 0) return categorySlug;
  return palabras
    .map((palabra, index) =>
      index === 0 ? palabra.charAt(0).toUpperCase() + palabra.slice(1) : palabra
    )
    .join(" ");
}

/**
 * Imagen de producto con placeholder.
 *
 * `unoptimized`: Cloudinary ya entrega `f_auto,q_auto` en el tamaño pedido,
 * así que pasarlo otra vez por el optimizador de Next sólo gasta CPU del slot
 * de Hostinger (ARCH.md §6).
 */
export function ProductImage({
  image,
  alt,
  categorySlug,
  size = "card",
  className,
  priority = false,
  sizes,
}: {
  image: CatalogImage | null;
  alt: string;
  categorySlug: string;
  size?: ImageSize;
  className?: string;
  priority?: boolean;
  sizes?: string;
}) {
  const preview = image?.cloudinaryId.match(/^local-preview:([a-z-]+)$/)?.[1];
  const url = preview
    ? `/api/preview-image/${preview}`
    : productImageUrl(image?.cloudinaryId, size);
  const wrapper = cn(
    "bg-muted relative aspect-square overflow-hidden rounded-lg",
    className
  );

  const sources = productImageSources(image?.cloudinaryId);
  if (sources) {
    return (
      <div className={wrapper}>
        {/* eslint-disable-next-line @next/next/no-img-element -- next/image unoptimized cannot emit srcset. */}
        <img
          src={sources.src}
          srcSet={sources.srcSet}
          sizes={sizes ?? "(max-width: 640px) 50vw, 300px"}
          alt={image?.alt ?? alt}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          decoding="async"
          className="absolute inset-0 h-full w-full object-contain"
        />
      </div>
    );
  }

  if (!url) {
    // == S18 == Una categoría fuera de las cuatro del seed (una tienda que
    // agregó las suyas) no cae en `categoryPlaceholderSrc`, que sin
    // conocerla mostraría el mismo dibujo genérico de "producto" sin decir
    // de qué categoría es: acá se muestra un placeholder propio, con el
    // nombre de la categoría en texto, para que la vidriera nunca se vea
    // como un error mientras el comercio no subió fotos.
    if (!CATEGORIAS_CONOCIDAS.has(categorySlug)) {
      return (
        <div className={wrapper}>
          <Image
            src="/placeholders/categoria.svg"
            alt=""
            fill
            aria-hidden
            priority={priority}
            sizes={sizes ?? "(max-width: 640px) 50vw, 300px"}
            className="object-cover"
          />
          <span className="text-muted-foreground bg-background/80 absolute inset-x-3 bottom-3 truncate rounded px-2 py-1 text-center text-xs font-medium">
            {t("catalogo.sinFoto", { nombre: nombreLegible(categorySlug) })}
          </span>
        </div>
      );
    }

    return (
      <div className={wrapper}>
        <Image
          src={categoryPlaceholderSrc(categorySlug)}
          alt={t("catalogo.sinFoto", { nombre: alt })}
          fill
          priority={priority}
          sizes={sizes ?? "(max-width: 640px) 50vw, 300px"}
          className="object-cover"
        />
      </div>
    );
  }

  return (
    <div className={wrapper}>
      <Image
        src={url}
        alt={image?.alt ?? alt}
        fill
        unoptimized
        priority={priority}
        sizes={sizes ?? "(max-width: 640px) 50vw, 300px"}
        className={publicBase() ? "object-contain" : "object-cover"}
        placeholder={image?.blurDataUrl ? "blur" : "empty"}
        blurDataURL={image?.blurDataUrl ?? undefined}
      />
    </div>
  );
}
