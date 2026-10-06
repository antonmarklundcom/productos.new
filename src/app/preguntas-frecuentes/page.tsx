import type { Metadata } from "next";

import { PolicyPage, policyMetadata } from "@/components/policy-page";

/** `/preguntas-frecuentes` — texto editable en `/admin/ajustes` (ver `src/components/policy-page.tsx`). */
export const dynamic = "force-dynamic";

export function generateMetadata(): Promise<Metadata> {
  return policyMetadata("preguntas-frecuentes");
}

export default function Page() {
  return <PolicyPage slug="preguntas-frecuentes" />;
}
