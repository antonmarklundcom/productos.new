"use client";
import { useState } from "react";
import { Maximize2, X } from "lucide-react";
import { ProductImage } from "@/components/product-image";
import type { CatalogImage } from "@/db/queries";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function ProductGallery({
  images,
  name,
  categorySlug,
}: {
  images: CatalogImage[];
  name: string;
  categorySlug: string;
}) {
  const [selected, setSelected] = useState(0);
  const [zoom, setZoom] = useState(false);
  const image = images[selected] ?? images[0] ?? null;
  return (
    <Dialog open={zoom} onOpenChange={setZoom}>
      <div className="product-gallery">
        <DialogTrigger asChild>
          <button
            type="button"
            className="gallery-main"
            aria-label={`Ampliar imagen de ${name}`}
          >
            <ProductImage
              image={image}
              alt={name}
              categorySlug={categorySlug}
              size="detail"
              priority
              sizes="(max-width: 1024px) 100vw, 600px"
            />
            <span className="gallery-zoom">
              <Maximize2 size={16} aria-hidden /> Ampliar
            </span>
          </button>
        </DialogTrigger>
        {images.length > 1 ? (
          <div
            className="gallery-thumbnails"
            aria-label="Imágenes del producto"
          >
            {images.map((item, index) => (
              <button
                key={`${item.cloudinaryId}-${index}`}
                type="button"
                aria-label={`Ver imagen ${index + 1}`}
                aria-pressed={selected === index}
                onClick={() => setSelected(index)}
              >
                <ProductImage
                  image={item}
                  alt={item.alt ?? name}
                  categorySlug={categorySlug}
                  size="thumb"
                  sizes="80px"
                />
              </button>
            ))}
          </div>
        ) : null}
        <DialogContent className="max-w-3xl p-4" showCloseButton={false}>
          <DialogTitle className="sr-only">{name}</DialogTitle>
          <button
            type="button"
            aria-label="Cerrar imagen"
            className="bg-background absolute top-6 right-6 z-10 rounded-full border p-2"
            onClick={() => setZoom(false)}
          >
            <X size={20} />
          </button>
          <ProductImage
            image={image}
            alt={name}
            categorySlug={categorySlug}
            size="detail"
            sizes="90vw"
          />
        </DialogContent>
      </div>
    </Dialog>
  );
}
