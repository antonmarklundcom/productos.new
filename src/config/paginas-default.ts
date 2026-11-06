import { catalogOnly } from "@/config/catalog-capabilities";
import type { PaginaSlug } from "@/domain/store-settings-schema";

/** Textos generales, editables en Ajustes; no sustituyen datos que debe confirmar el comercio. */
export const PAGINAS_DEFAULT: Readonly<
  Record<PaginaSlug, { titulo: string; cuerpo: string }>
> = {
  envios: {
    titulo: "Envíos y entregas",
    cuerpo: catalogOnly
      ? `**Consultá las opciones antes de coordinar**

La cobertura, la modalidad de entrega o retiro, los costos y los plazos dependen de cada operación y deben confirmarse con el comercio antes de coordinarla.

También podés consultar los canales publicados en la página Contacto para preguntar por las opciones disponibles para tu zona y producto.`
      : `**Opciones disponibles para tu pedido**

Revisá en el proceso de compra las opciones de entrega o retiro y los costos que estén disponibles para tu pedido. Si necesitás confirmar la cobertura o el plazo antes de comprar, consultá al comercio.

Para hacer una consulta, encontrá los canales de atención en la página Contacto.`,
  },
  devoluciones: {
    titulo: "Cambios y devoluciones",
    cuerpo: `**Consultá las condiciones de tu operación**

Las condiciones aplicables pueden depender del producto y de la operación. Consultá con el comercio antes de confirmar la compra y conservá la información que recibas sobre el procedimiento y los plazos.

Si necesitás hacer una consulta, encontrá los canales de atención en la página Contacto.`,
  },
  "preguntas-frecuentes": {
    titulo: "Preguntas frecuentes",
    cuerpo: catalogOnly
      ? `**¿Cómo consulto por un producto?**
En la ficha del producto podés usar la opción de consulta si está disponible. También podés escribir por los canales publicados en la página Contacto. Confirmá allí disponibilidad, precio y detalles de la operación.

**¿Puedo hacer el pedido o pagar desde este sitio?**
Este catálogo permite consultar productos; no ofrece un proceso de compra ni de pago en línea.

**¿Qué opciones de entrega hay?**
La cobertura, modalidad, costo y plazo se confirman con el comercio para cada consulta. No se coordinan automáticamente desde el catálogo.

**¿Puedo seguir un pedido desde el sitio?**
El seguimiento en línea no está disponible en este catálogo. Para una operación coordinada con el comercio, consultá sus canales publicados.`
      : `**¿Cómo compro?**
Agregá los productos disponibles al carrito y seguí los pasos del proceso de compra. Revisá el resumen y las condiciones que aparezcan antes de confirmar.

**¿Cómo consulto por un producto?**
Podés usar la opción de consulta en la ficha si está disponible, o escribir por los canales publicados en la página Contacto.

**¿Qué medios de pago y opciones de entrega hay?**
Las opciones habilitadas y sus costos se muestran durante el proceso de compra. Si necesitás confirmarlas antes, consultá al comercio.

**¿Cómo consulto el estado de un pedido?**
Usá la opción de seguimiento disponible en el sitio o escribí por los canales publicados en la página Contacto.`,
  },
  terminos: {
    titulo: "Términos y condiciones",
    cuerpo: catalogOnly
      ? `**Catálogo para consultas**

Este sitio muestra productos y permite consultarlos a través de los canales publicados. La ficha y el envío de una consulta no confirman un pedido ni reservan stock. El sitio no cobra pagos.

Antes de coordinar una compra con el comercio, confirmá la disponibilidad, el precio final, la forma de pago, la entrega o el retiro y las condiciones de cambios y devoluciones.`
      : `**Información sobre compras**

Antes de confirmar un pedido, revisá el producto, el precio, las opciones disponibles y el resumen que presenta el proceso de compra.

Si necesitás aclarar algún dato antes de comprar, consultá por los canales publicados en la página Contacto.`,
  },
  privacidad: {
    titulo: "Privacidad",
    cuerpo: catalogOnly
      ? `**Datos del catálogo en tu navegador**

El sitio guarda en el navegador los productos que viste y las variantes que elegiste para recordarlos en próximas visitas. Para mostrar fichas actualizadas de los productos vistos, el navegador solicita al catálogo sus identificadores. Podés borrar estos datos desde los ajustes de tu navegador.

**Consultas por WhatsApp**

Si usás un enlace a WhatsApp, se abre ese servicio con un texto sugerido que puede incluir el producto y la variante. Podés revisar el texto y elegir qué datos compartir antes de enviar el mensaje.

Para consultas sobre privacidad, usá los canales publicados en Contacto.`
      : `**Datos de tu pedido**

El sitio utiliza los datos que ingresás al comprar para registrar el pedido, coordinar la entrega y permitirte consultar su estado. El navegador también puede guardar los productos que agregaste al carrito y tus preferencias del catálogo.

Para consultas sobre privacidad, usá los canales publicados en Contacto.`,
  },
};
