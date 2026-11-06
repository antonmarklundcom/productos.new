import { render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProductInquiryView, reportProductInquiryClick } from "./product-inquiry-metrics";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("counts each visible product once, and counts a click as its own event", () => {
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", send);

  const { rerender } = render(<ProductInquiryView productId={42} />);
  expect(send).not.toHaveBeenCalled();
  visibility.mockReturnValue("visible");
  document.dispatchEvent(new Event("visibilitychange"));
  document.dispatchEvent(new Event("visibilitychange"));
  rerender(<ProductInquiryView productId={73} />);
  reportProductInquiryClick(73, "sticky");

  expect(send.mock.calls.map(([path, request]) => [path, JSON.parse(request.body)])).toEqual([
    ["/api/catalog/inquiry-metrics", { event: "product_view", productId: 42 }],
    ["/api/catalog/inquiry-metrics", { event: "product_view", productId: 73 }],
    ["/api/catalog/inquiry-metrics", { event: "whatsapp_click", productId: 73, placement: "sticky" }],
  ]);
  expect(send.mock.calls[0]?.[1]).toMatchObject({
    credentials: "omit", referrerPolicy: "origin", keepalive: true,
  });
});

it("respects Global Privacy Control", () => {
  vi.stubGlobal("navigator", { globalPrivacyControl: true });
  const send = vi.fn();
  vi.stubGlobal("fetch", send);
  reportProductInquiryClick(73, "inline");
  expect(send).not.toHaveBeenCalled();
});
