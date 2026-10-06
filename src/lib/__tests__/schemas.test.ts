import { describe, expect, it } from "vitest";

import { CartItemSchema, CheckoutInputSchema } from "@/lib/schemas";

describe("CartItemSchema", () => {
  it("acepta un ítem válido", () => {
    const result = CartItemSchema.safeParse({ variantId: 1, qty: 2 });
    expect(result.success).toBe(true);
  });

  it("rechaza cantidades no enteras", () => {
    const result = CartItemSchema.safeParse({ variantId: 1, qty: 1.5 });
    expect(result.success).toBe(false);
  });
});

describe("CheckoutInputSchema — bordes de largo", () => {
  const base = {
    items: [{ variantId: 1, qty: 1 }],
    customerName: "Ana Benítez",
    customerPhone: "+595981234567",
    docType: "CI" as const,
    docNumber: "1234567",
    isConsumidorFinal: false,
    shipCity: "Asunción",
    shipBarrio: "Villa Morra",
    shipAddress: "Av. España 1234",
    paymentMethod: "transferencia" as const,
  };

  it("acepta el caso válido de referencia", () => {
    expect(CheckoutInputSchema.safeParse(base).success).toBe(true);
  });

  // La columna es `customer_email varchar(200)`: si Zod deja pasar un email más
  // largo, el error aparece recién en el INSERT y la compradora ve un 500.
  it("rechaza un email de 201 caracteres en Zod, no en la base", () => {
    const largo = `${"a".repeat(201 - "@ejemplo.com".length)}@ejemplo.com`;
    expect(largo).toHaveLength(201);
    const result = CheckoutInputSchema.safeParse({ ...base, customerEmail: largo });
    expect(result.success).toBe(false);
  });

  it("acepta un email de exactamente 200 caracteres", () => {
    const justo = `${"a".repeat(200 - "@ejemplo.com".length)}@ejemplo.com`;
    expect(justo).toHaveLength(200);
    expect(CheckoutInputSchema.safeParse({ ...base, customerEmail: justo }).success).toBe(true);
  });

  // `ship_maps_url varchar(500)`.
  it("rechaza un link de mapas de más de 500 caracteres", () => {
    const url = `https://maps.google.com/?q=${"x".repeat(500)}`;
    const result = CheckoutInputSchema.safeParse({ ...base, shipMapsUrl: url });
    expect(result.success).toBe(false);
  });
});
