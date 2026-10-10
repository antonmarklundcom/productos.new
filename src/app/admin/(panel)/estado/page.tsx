import Link from "next/link";
import { catalogOnly } from "@/config/catalog-capabilities";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

const sections: Record<string, { name: string; detail: string }> = {
  pedidos: {
    name: "Pedidos",
    detail:
      "El flujo de pedidos, reservas y cambios de estado necesita su implementación nativa en D1. Las consultas del catálogo se reciben por WhatsApp.",
  },
  resenas: {
    name: "Reseñas",
    detail:
      "La moderación y las compras verificadas todavía necesitan pruebas en D1. No se publican reseñas inventadas.",
  },
  devoluciones: {
    name: "Devoluciones",
    detail:
      "El registro de devoluciones y reembolsos depende del flujo de pedidos y pagos.",
  },
  clientes: {
    name: "Clientes",
    detail:
      "Las cuentas, datos de clientes y acceso a sus pedidos todavía no están habilitados en esta versión.",
  },
  cupones: {
    name: "Cupones",
    detail:
      "La aplicación de descuentos requiere un checkout y cálculo de pedidos probados en D1.",
  },
  actividad: {
    name: "Actividad",
    detail:
      "La pantalla de auditoría necesita su consulta nativa y verificación de permisos en D1.",
  },
  envios: {
    name: "Envíos",
    detail:
      "La edición de zonas, métodos y tarifas necesita pruebas con el cálculo de pedidos. No se inventan costos de entrega.",
  },
  banco: {
    name: "Banco",
    detail:
      "La conciliación y comprobantes necesitan el flujo de pagos y pedidos. No están habilitados para cobrar.",
  },
  integraciones: {
    name: "Integraciones",
    detail:
      "Las claves cifradas y configuraciones requieren una implementación nativa revisada. Las imágenes R2 y el WhatsApp del catálogo ya funcionan.",
  },
  usuarios: {
    name: "Usuarios",
    detail:
      "La gestión de permisos, sesiones y otras cuentas todavía necesita pruebas nativas. El propietario existente puede iniciar sesión.",
  },
};

export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ seccion?: string }>;
}) {
  if (!catalogOnly) notFound();
  const { seccion } = await searchParams;
  const section =
    seccion && Object.hasOwn(sections, seccion) ? sections[seccion] : null;
  return (
    <section className="max-w-2xl space-y-5">
      <p className="text-muted-foreground text-sm">Estado del panel</p>
      <h1 className="text-2xl font-semibold">
        {section?.name ?? "Funciones del panel"}
      </h1>
      <div className="bg-muted/30 space-y-3 rounded-xl border p-5">
        <p className="font-medium">Pendiente de habilitar</p>
        <p>
          {section?.detail ??
            "Esta versión permite gestionar el catálogo. Las demás secciones se habilitan cuando sus lecturas, guardados y permisos están probados."}
        </p>
        <p className="text-muted-foreground text-sm">
          El menú completo está visible para mostrar qué funciones están
          disponibles. Entrar aquí no cambia pedidos, stock, pagos ni cuentas.
        </p>
      </div>
      <p>
        Disponible ahora: resumen, productos, precios, costos y proveedores,
        publicación, categorías y ajustes.
      </p>
      <div className="flex flex-wrap gap-4">
        <Link href="/admin/productos" className="underline">
          Gestionar productos
        </Link>
        <Link href="/admin/categorias" className="underline">
          Gestionar categorías
        </Link>
        <Link href="/" className="underline">
          Ver tienda
        </Link>
      </div>
    </section>
  );
}
