/** Recordatorio estático para revisar las páginas públicas antes de publicarlas. */
export function CatalogPublicationChecklist() {
  const checks = [
    "El contacto público funciona y muestra únicamente canales confirmados por el comercio.",
    "Las preguntas frecuentes describen el catálogo y el proceso disponibles; no conservan textos DEMO.",
    "La información de entrega incluye solo cobertura, costos y plazos confirmados por el comercio.",
    "Precios y disponibilidad se explican con claridad y no se presentan como garantía si requieren confirmación.",
    "El responsable revisó los términos, la privacidad y las condiciones de cambios y devoluciones.",
  ];
  return (
    <aside aria-labelledby="catalog-publication-checklist-title" className="rounded-lg border p-4">
      <h3 id="catalog-publication-checklist-title" className="font-medium">
        Revisión de páginas públicas
      </h3>
      <p className="text-muted-foreground mt-1 text-sm">
        Antes de activar una página, confirmá cada dato con el comercio. No completes políticas ni condiciones por suposición.
      </p>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
        {checks.map((check) => <li key={check}>{check}</li>)}
      </ul>
    </aside>
  );
}
