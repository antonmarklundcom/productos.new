import type { Metadata } from "next";

import { PolicyPage, policyMetadata } from "@/components/policy-page";

/** `/devoluciones` — texto editable en `/admin/ajustes` (ver `src/components/policy-page.tsx`). */
export const dynamic = "force-dynamic";

export function generateMetadata(): Promise<Metadata> {
  return policyMetadata("devoluciones");
}

export default function Page() {
  return <PolicyPage slug="devoluciones" />;
}
