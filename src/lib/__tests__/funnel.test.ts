import { describe, expect, it, vi } from "vitest";

import { funnelPayloads, sendFunnelEvent } from "@/lib/funnel";

const items = [
  { id: "CE-S", name: "Conjunto", pricePyg: 150_000, qty: 2 },
  { id: "BR-M", name: "Bralette", pricePyg: 90_000, qty: 1 },
];

describe("embudo para GA4 y Meta", () => {
  it("el valor es la suma y los ids son los SKU del feed", () => {
    const { ga4, meta } = funnelPayloads(items);

    expect(ga4.value).toBe(390_000);
    expect(ga4.currency).toBe("PYG");
    expect(ga4.items[0]).toEqual({ item_id: "CE-S", item_name: "Conjunto", price: 150_000, quantity: 2 });
    expect(meta).toMatchObject({
      value: 390_000,
      currency: "PYG",
      content_type: "product",
      content_ids: ["CE-S", "BR-M"],
      num_items: 3,
    });
  });

  it("cada evento va con su nombre en cada medidor", () => {
    const gtag = vi.fn();
    const fbq = vi.fn();

    expect(sendFunnelEvent("add_to_cart", items, { gtag, fbq })).toBe(true);
    expect(gtag).toHaveBeenCalledWith("event", "add_to_cart", expect.objectContaining({ value: 390_000 }));
    expect(fbq).toHaveBeenCalledWith("track", "AddToCart", expect.objectContaining({ value: 390_000 }));

    sendFunnelEvent("view_item", items, { fbq });
    expect(fbq).toHaveBeenLastCalledWith("track", "ViewContent", expect.anything());
    sendFunnelEvent("begin_checkout", items, { fbq });
    expect(fbq).toHaveBeenLastCalledWith("track", "InitiateCheckout", expect.anything());
  });

  it("sin medidores configurados no hace nada", () => {
    expect(sendFunnelEvent("add_to_cart", items, {})).toBe(false);
    expect(sendFunnelEvent("add_to_cart", [], { gtag: vi.fn() })).toBe(false);
  });
});
