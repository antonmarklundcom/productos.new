import { catalogOnly } from "@/config/catalog-capabilities";

/** Capabilities are replaced by the isolated Workers build, never by product data. */
export const catalogCapabilities = {
  checkout: !catalogOnly,
  adjustStock: !catalogOnly,
  bulkProducts: !catalogOnly,
};

export function effectiveSaleMode(mode?: "stock" | "enquiry" | "showcase") {
  return catalogOnly && (mode ?? "stock") === "stock" ? "enquiry" : (mode ?? "stock");
}
