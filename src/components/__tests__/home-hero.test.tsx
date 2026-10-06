import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { HomeHero } from "@/components/home-hero";
import { TIENDA } from "@/config/tienda";

/**
 * La portada de la home (PLAN.md FASE 2, PR O).
 *
 * Lo que se cuida acá es el guardarraíl 1 del plan —"todo lo nuevo es opcional
 * con default seguro"— aplicado a la única pieza de **piel** de la FASE 2: una
 * tienda que se actualiza y no configura nada no puede ver ningún cambio, y
 * una que sí lo configura no puede terminar con un botón que lleva a ningún
 * lado ni con un `<img>` roto porque le falta Cloudinary.
 */
describe("hero de la home", () => {
  // `globals` está apagado en vitest.config.mts, así que el auto-cleanup de
  // testing-library no se registra solo: sin esto, cada render se apila sobre
  // el anterior y `getByRole` encuentra dos títulos.
  afterEach(cleanup);

  it("la tienda tiene una portada centralizada y un destino de categoría válido", () => {
    expect(TIENDA.hero?.titulo).toBeTruthy();
    expect(TIENDA.hero?.cta?.href).toBe("/#categorias");
  });

  it("dibuja título, texto y botón", () => {
    render(
      <HomeHero
        hero={{
          titulo: "Verano 2026",
          texto: "Hasta 40% en toda la línea",
          cta: { label: "Ver ofertas", href: "/categoria/ofertas" },
        }}
      />
    );

    expect(
      screen.getByRole("heading", { name: "Verano 2026" })
    ).toBeInTheDocument();
    expect(screen.getByText("Hasta 40% en toda la línea")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver ofertas" })).toHaveAttribute(
      "href",
      "/categoria/ofertas"
    );
  });

  it("sin CTA no hay botón, y eso es una portada válida", () => {
    render(<HomeHero hero={{ titulo: "Cerrado por vacaciones" }} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("sin Cloudinary configurado no dibuja ninguna imagen", () => {
    // El estado de toda tienda recién clonada: hay un id de foto en el config
    // pero el entorno todavía no tiene `CLOUDINARY_CLOUD_NAME`. Tiene que
    // salir el hero de texto, nunca un rectángulo roto.
    render(
      <HomeHero
        hero={{
          titulo: "Verano 2026",
          imagen: {
            cloudinaryId: "portadas/verano",
            alt: "Modelo en la playa",
          },
        }}
      />
    );

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Verano 2026" })
    ).toBeInTheDocument();
  });
});
