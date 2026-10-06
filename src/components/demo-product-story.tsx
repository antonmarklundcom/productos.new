import Link from "next/link";
import { Headphones, Feather, Bluetooth, ArrowRight } from "lucide-react";
import { ProductImage } from "@/components/product-image";
import type { CatalogImage } from "@/db/queries";
import { formatGs } from "@/lib/money";

/** Rendered by the server only inside the isolated local preview. No purchase action. */
export function DemoProductIntro({ price }: { price: number }) {
  return (
    <>
      <p className="product-lead">
        Desconectá del ruido de tu día. Conectá con lo que te gusta.
      </p>
      <ul className="product-benefits">
        <li>
          <Bluetooth size={18} aria-hidden /> Una experiencia sin cables
        </li>
        <li>
          <Feather size={18} aria-hidden /> Un diseño pensado para la comodidad
        </li>
        <li>
          <Headphones size={18} aria-hidden /> Tu música, donde estés
        </li>
      </ul>
      <div className="demo-price">
        <span>Precio ilustrativo</span>
        <strong>{formatGs(price)}</strong>
        <small>Ejemplo de presentación · No es una oferta comercial</small>
      </div>
      <div className="demo-purchase">
        <span className="demo-swatch">
          <i aria-hidden /> Negro · ejemplo visual
        </span>
        <button type="button" disabled>
          Comprar ahora · Demo
        </button>
        <p>
          Esta demostración no está a la venta. Las compras se habilitan al
          cargar el catálogo real, el stock y las condiciones de entrega.
        </p>
      </div>
    </>
  );
}
export function DemoProductStory({ image }: { image: CatalogImage | null }) {
  return (
    <>
      <section className="product-story" aria-labelledby="story-title">
        <div>
          <p className="eyebrow">Un momento para vos</p>
          <h2 id="story-title">Dale play a tu día.</h2>
          <p>
            Tu playlist favorita mientras caminás. Un podcast en una pausa. Ese
            tema que te pone de buen humor. Disfrutá de un momento a tu ritmo,
            con un diseño que acompaña tus planes.
          </p>
          <p className="story-disclaimer">
            Concepto de demostración. Imágenes y beneficios ilustrativos; las
            características de cada producto real se verifican con el proveedor.
          </p>
        </div>
        <ProductImage
          image={image}
          alt="Concepto visual de auriculares — demostración"
          categorySlug="tecnologia-y-accesorios"
          size="detail"
          sizes="(max-width: 768px) 90vw, 520px"
        />
      </section>
      <section className="product-faq" aria-labelledby="product-faq-title">
        <div>
          <p className="eyebrow">Elegí con información</p>
          <h2 id="product-faq-title">Resolvemos tus dudas.</h2>
          <p>La información clave, cerca de la decisión de compra.</p>
        </div>
        <div>
          {[
            [
              "¿Son compatibles con mi celular?",
              "Este es un producto ficticio. Para una ficha real, se informa la versión de conexión y los dispositivos compatibles según la documentación del proveedor.",
            ],
            [
              "¿Qué viene en la caja?",
              "El ejemplo muestra auriculares, cable de carga y guía. El contenido real del empaque se confirma antes de publicar cada producto.",
            ],
            [
              "¿Cuánto tarda el envío?",
              "Todavía no hay zonas, costos ni plazos comerciales configurados. En el catálogo real, la información de entrega debe estar disponible antes de confirmar el pedido.",
            ],
            [
              "¿Puedo comprar este producto?",
              "No. El precio, el producto y las imágenes son de demostración local. No se cobra, no se reserva stock y no se crea ningún pedido.",
            ],
          ].map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>
      <div className="product-explore">
        <div>
          <strong>¿Buscás algo más?</strong>
          <p>Encontrá ideas para tu casa, tus proyectos y tu día.</p>
        </div>
        <Link href="/#categorias">
          Explorá las categorías <ArrowRight size={18} aria-hidden />
        </Link>
      </div>
    </>
  );
}
