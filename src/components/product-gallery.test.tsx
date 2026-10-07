import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductGallery } from "./product-gallery";
import { ProductImage } from "./product-image";
import type { CatalogImage } from "@/db/queries";

const photos: CatalogImage[] = [
  {
    cloudinaryId: "r2:p1/cepillo-3f9a2c71d0@1000x1000",
    alt: "Primera foto",
    blurDataUrl: null,
  },
  {
    cloudinaryId: "r2:p1/cepillo-abcdef0123@3024x4032",
    alt: "Segunda foto",
    blurDataUrl: null,
  },
];
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("ProductGallery with R2", () => {
  it("changes the selected photo and shows it in zoom without client configuration loss", () => {
    vi.stubEnv("NEXT_PUBLIC_IMAGENES_URL", "https://img.test");
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "");
    render(
      <ProductGallery
        images={photos}
        name="Cepillo"
        categorySlug="hogar-y-cocina"
      />
    );
    const main = screen.getByRole("button", {
      name: "Ampliar imagen de Cepillo",
    });
    expect(within(main).getByRole("img")).toHaveAttribute(
      "src",
      "https://img.test/p1/cepillo-3f9a2c71d0-480.webp"
    );
    expect(within(main).getByRole("img")).toHaveAttribute(
      "fetchpriority",
      "high"
    );
    expect(within(main).getByRole("img")).toHaveAttribute("loading", "eager");
    fireEvent.click(screen.getByRole("button", { name: "Ver imagen 2" }));
    expect(within(main).getByRole("img")).toHaveAttribute(
      "src",
      "https://img.test/p1/cepillo-abcdef0123-480.webp"
    );
    expect(within(main).getByRole("img").getAttribute("srcset")).toContain(
      "-1200.webp 900w"
    );
    fireEvent.click(main);
    const zoom = within(screen.getByRole("dialog")).getByRole("img");
    expect(zoom).toHaveAttribute(
      "src",
      "https://img.test/p1/cepillo-abcdef0123-480.webp"
    );
    expect(zoom).toHaveClass("object-contain");
    expect(zoom).toHaveAttribute("sizes", "90vw");
  });
  it("falls back to the existing placeholder when R2 is disabled", () => {
    vi.stubEnv("NEXT_PUBLIC_IMAGENES_URL", "");
    render(
      <ProductGallery
        images={photos.slice(0, 1)}
        name="Cepillo"
        categorySlug="hogar-y-cocina"
      />
    );
    expect(screen.getByRole("img").getAttribute("src")).toContain(
      "/placeholders/hogar-y-cocina.svg"
    );
  });
  it("preserves the legacy Cloudinary card and crop when R2 is disabled", () => {
    vi.stubEnv("NEXT_PUBLIC_IMAGENES_URL", "");
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "demo");
    render(
      <ProductImage
        image={{
          cloudinaryId: "productos/cepillo",
          alt: "Cepillo",
          blurDataUrl: null,
        }}
        alt="Cepillo"
        categorySlug="hogar-y-cocina"
      />
    );
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_fill,w_600,h_600/productos/cepillo"
    );
    expect(screen.getByRole("img")).toHaveClass("object-cover");
  });
});
