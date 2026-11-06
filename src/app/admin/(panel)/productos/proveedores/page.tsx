import Link from "next/link";
import { notFound } from "next/navigation";
import { catalogOnly } from "@/config/catalog-capabilities";
import { requireCapabilityPage } from "@/lib/admin-guard";
import { formatGs } from "@/lib/money";
import { getNativeDb } from "../../../../../../workers/d1/database";
import { dropiReviewDays, readDropiFreshness } from "../../../../../../workers/d1/supplier-costs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Revisión de proveedores Dropi" };

const freshnessLabel = {
  unknown: "Fecha sin confirmar",
  stale: "Revisión vencida",
  fresh: "Al día",
} as const;

const queuePath = "/admin/productos/proveedores";
const queueHref = (page: number) => page === 1 ? queuePath : `${queuePath}?pagina=${page}`;

export default async function DropiFreshnessPage({
  searchParams,
}: {
  searchParams: Promise<{ pagina?: string | string[] }>;
}) {
  if (!catalogOnly) notFound();
  await requireCapabilityPage("productos");
  const params = await searchParams;
  const requested = typeof params.pagina === "string" ? Number(params.pagina) : 1;
  const page = Number.isSafeInteger(requested) && requested > 0 && requested <= 10000 ? requested : 1;
  const { rows, hasNext } = await readDropiFreshness(getNativeDb(), page);

  return (
    <div className="space-y-5">
      <Link href="/admin/productos" className="text-muted-foreground text-sm underline">
        Volver a productos
      </Link>
      <header className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">Revisión de proveedores Dropi</h1>
        <p className="text-muted-foreground max-w-3xl text-sm">
          Las ofertas activas sin fecha confirmada o con {dropiReviewDays} días sin revisión aparecen primero.
          Compará la variante exacta y actualizá en su ficha el costo, el stock capturado y la fecha comprobada.
          El stock del proveedor es una captura y se mantiene separado del inventario de la tienda.
        </p>
      </header>
      {rows.length ? (
        <ul className="grid gap-3 lg:grid-cols-2">
          {rows.map(offer => (
            <li key={offer.offerId} className="min-w-0 space-y-3 rounded-xl border p-4">
              <div>
                <h2 className="font-semibold break-words">{offer.productName}</h2>
                <p className="text-sm break-words">
                  {offer.variantLabel} · SKU {offer.sku} · Oferta #{offer.offerId}
                  {offer.variantActive ? "" : " · Variante inactiva"}
                </p>
                <p className="text-muted-foreground text-sm">
                  {offer.supplierName || "Proveedor sin nombre"} · {offer.dropiId ? `Dropi #${offer.dropiId}` : "Enlace de producto sin verificar"}
                  {" · "}{offer.confirmed ? "Equivalencia registrada" : "Equivalencia por confirmar"}
                </p>
              </div>
              <p className="text-sm font-medium">
                {freshnessLabel[offer.freshness]}
                {offer.freshness !== "unknown" && offer.checkedAt ? ` · ${offer.checkedAt.slice(0, 19).replace("T", " ")} UTC` : ""}
              </p>
              <dl className="grid gap-2 text-sm sm:grid-cols-3">
                <div><dt>Precio de tienda</dt><dd>{formatGs(offer.retailPyg)}</dd></div>
                <div><dt>Costo capturado</dt><dd>{offer.costPyg === null ? "Sin dato" : formatGs(offer.costPyg)}</dd></div>
                <div><dt>Stock capturado</dt><dd>{offer.supplierStock ?? "Sin dato"}</dd></div>
              </dl>
              <div className="flex flex-wrap gap-4 text-sm">
                <Link className="underline" href={`/admin/productos/${offer.productId}#supplier-offer-${offer.offerId}`}>
                  Revisar esta oferta
                </Link>
                {offer.productUrl && (
                  <a className="underline" href={offer.productUrl} target="_blank" rel="noopener noreferrer">
                    Ver producto en Dropi
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">
          {page === 1 ? "No hay ofertas activas de Dropi para revisar." : "No hay ofertas en esta página."}
        </p>
      )}
      {(page > 1 || hasNext) && (
        <nav aria-label="Paginación de ofertas" className="flex items-center gap-4 text-sm">
          {page > 1 && <Link className="underline" href={queueHref(page - 1)}>Anterior</Link>}
          <span>Página {page}</span>
          {hasNext && page < 10000 && <Link className="underline" href={queueHref(page + 1)}>Siguiente</Link>}
        </nav>
      )}
    </div>
  );
}
