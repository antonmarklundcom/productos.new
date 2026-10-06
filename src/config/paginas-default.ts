import type { PaginaSlug } from "@/domain/store-settings-schema";

/** Textos de preparación. Editables en Ajustes; no son políticas comerciales confirmadas. */
export const PAGINAS_DEFAULT: Readonly<
  Record<PaginaSlug, { titulo: string; cuerpo: string }>
> = {
  envios: {
    titulo: "Envíos y entregas",
    cuerpo: `**Información en preparación**
Estamos definiendo las zonas de entrega, las opciones de retiro y los costos de envío. Todavía no publicamos cobertura, tarifas ni plazos y no recibimos pedidos.

Cuando el catálogo comercial esté disponible, vas a poder revisar las opciones habilitadas y su costo antes de confirmar una compra.

Podés consultar nuestros canales de atención en la página de contacto cuando estén publicados.`,
  },
  devoluciones: {
    titulo: "Cambios y devoluciones",
    cuerpo: `**Política comercial en preparación**
Antes de habilitar compras vamos a publicar las condiciones, los plazos, los costos y el procedimiento para solicitar un cambio o una devolución.

Todavía no recibimos pedidos. No hay una garantía comercial ni un plazo de devolución publicado en este catálogo de preparación.

Si ya tenés un pedido de una operación anterior, conservá su número y consultá los canales de atención publicados por el comercio.`,
  },
  "preguntas-frecuentes": {
    titulo: "Preguntas frecuentes",
    cuerpo: `**¿Ya puedo comprar?**
El catálogo comercial está en preparación. Todavía no recibimos pedidos ni pagos.

**¿Qué veo en la vista previa local?**
Son artículos ficticios marcados como DEMO, con ilustraciones de ejemplo. No representan productos, precios ni stock reales y no se pueden comprar.

**¿Cómo voy a encontrar lo que necesito?**
Podés explorar las categorías o usar el buscador. Cada ficha va a mostrar la información cargada por el comercio.

**¿Necesito una cuenta para comprar?**
Cuando se habiliten las compras, vas a poder comprar como invitado. Las cuentas de cliente son opcionales.

**¿En qué moneda se muestran los precios?**
En guaraníes paraguayos (PYG), sin decimales, cuando el comercio publique precios confirmados.

**¿Cuáles son los medios de pago y las opciones de entrega?**
Todavía no están publicados. Antes de habilitar compras se van a confirmar los medios disponibles, la cobertura y los costos.

**¿Cómo consulto un pedido?**
Usá el enlace privado que recibiste al comprar o la opción Seguí tu pedido. La recuperación del enlace depende de los canales de atención configurados por el comercio.`,
  },
  terminos: {
    titulo: "Términos y condiciones",
    cuerpo: `**Catálogo en preparación**
Esta versión de {{tienda}} permite conocer la estructura del catálogo. Todavía no recibimos pedidos ni pagos.

Los artículos DEMO de la vista previa local y sus ilustraciones son ficticios. No constituyen ofertas ni representan disponibilidad o precios comerciales.

Antes de habilitar ventas se van a publicar los datos del comercio, las condiciones de compra, los medios de pago y las políticas de envío y devolución.

Los textos de esta versión se van a completar y revisar con la información real del comercio.`,
  },
  privacidad: {
    titulo: "Privacidad",
    cuerpo: `**Información en preparación**
Estamos completando los datos del responsable del comercio y el canal para consultas sobre privacidad. Todavía no recibimos pedidos ni pagos.

El sitio guarda preferencias del carrito y favoritos en tu navegador. El acceso al panel y, si se habilitan, las cuentas de cliente usan cookies de sesión.

Al habilitar compras se va a publicar qué información se solicita, para qué se utiliza, los servicios que intervienen y cómo consultar o corregir tus datos.

La analítica y los servicios externos opcionales se habilitan solamente cuando el comercio los configura.`,
  },
};
