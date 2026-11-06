import { getD1Bindings } from "./database";

export function productInquiryMetricsEnabled(): boolean {
  return getD1Bindings().WORKERS_INQUIRY_METRICS_ENABLED === "true";
}
