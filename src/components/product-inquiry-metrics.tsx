"use client";

import { useEffect, useRef } from "react";

type InquiryMetric =
  | { event: "product_view"; productId: number }
  | { event: "whatsapp_click"; productId: number; placement: "inline" | "sticky" };

function report(metric: InquiryMetric) {
  if ((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return;
  void fetch("/api/catalog/inquiry-metrics", {
    method: "POST",
    body: JSON.stringify(metric),
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    referrerPolicy: "origin",
    keepalive: true,
  }).catch(() => {});
}

export function reportProductInquiryClick(productId: number, placement: "inline" | "sticky") {
  report({ event: "whatsapp_click", productId, placement });
}

export function ProductInquiryView({ productId }: { productId: number }) {
  const lastReported = useRef<number | null>(null);

  useEffect(() => {
    function reportWhenVisible() {
      if (document.visibilityState !== "visible" || lastReported.current === productId) return;
      lastReported.current = productId;
      report({ event: "product_view", productId });
    }

    reportWhenVisible();
    document.addEventListener("visibilitychange", reportWhenVisible);
    return () => document.removeEventListener("visibilitychange", reportWhenVisible);
  }, [productId]);

  return null;
}
