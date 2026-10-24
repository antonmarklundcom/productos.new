"use client";
import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react";
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
  const touchStartX = useRef<number | null>(null);
  const image = images[selected] ?? images[0] ?? null;
  const move = (direction: -1 | 1) => {
    if (images.length < 2) return;
    setSelected((current) => (current + direction + images.length) % images.length);
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      move(event.key === "ArrowLeft" ? -1 : 1);
    }
  };
  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (event.pointerType !== "touch" || start === null || Math.abs(event.clientX - start) < 45) return;
    move(event.clientX < start ? 1 : -1);
  };

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
          <div className="gallery-thumbnails" aria-label="Imágenes del producto">
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
        <DialogContent
          className="max-w-3xl p-4"
          showCloseButton={false}
          onKeyDown={handleKeyDown}
          onPointerDown={(event) => {
            touchStartX.current = event.pointerType === "touch" ? event.clientX : null;
          }}
          onPointerUp={handlePointerUp}
        >
          <DialogTitle className="sr-only">{name}</DialogTitle>
          <button
            type="button"
            aria-label="Cerrar imagen"
            className="bg-background absolute top-6 right-6 z-10 rounded-full border p-2"
            onClick={() => setZoom(false)}
          >
            <X size={20} />
          </button>
          {images.length > 1 ? (
            <>
              <button
                type="button"
                aria-label="Imagen anterior"
                className="bg-background absolute top-1/2 left-6 z-10 -translate-y-1/2 rounded-full border p-2 focus-visible:ring-2"
                onClick={() => move(-1)}
              >
                <ChevronLeft size={22} aria-hidden />
              </button>
              <span className="sr-only" aria-live="polite" aria-atomic="true">
                Imagen {selected + 1} de {images.length}
              </span>
              <p className="text-muted-foreground text-center text-sm" aria-hidden="true">
                {selected + 1} / {images.length}
              </p>
              <button
                type="button"
                aria-label="Imagen siguiente"
                className="bg-background absolute top-1/2 right-6 z-10 -translate-y-1/2 rounded-full border p-2 focus-visible:ring-2"
                onClick={() => move(1)}
              >
                <ChevronRight size={22} aria-hidden />
              </button>
            </>
          ) : null}
          <ProductImage
            image={image}
            alt={image?.alt ?? name}
            categorySlug={categorySlug}
            size="detail"
            sizes="90vw"
          />
        </DialogContent>
      </div>
    </Dialog>
  );
}
