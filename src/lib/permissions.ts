import type { UserRole } from "@/db/schema";

/**
 * La matriz de permisos del panel, en un solo lugar (ARCH.md §1).
 *
 * **Esto no es la defensa.** La defensa son los guards (`requireStaffSession`,
 * `requireOwnerSession`) adentro de cada server action: una acción es un
 * endpoint HTTP con su propio id y se la puede llamar sin abrir jamás una
 * página. Esta tabla existe para que el panel no le dibuje a nadie un botón
 * que le va a contestar 403, y para que la matriz esté escrita una vez en vez
 * de repartida entre diez `role === "owner"` sueltos.
 *
 * Regla al agregar una capacidad: primero el guard en la acción, después la
 * fila acá. Al revés se llega a un botón oculto que igual funciona.
 */
export const CAPABILITIES = [
  /** El resumen de `/admin`: ventas del día y del mes. Es plata. */
  "dashboard",
  /** Ver el listado y la ficha de un pedido. */
  "pedidos.ver",
  /** Preparar, despachar y dar por entregado. El trabajo del mostrador. */
  "pedidos.despachar",
  /** Dar por cobrado, cancelar, vencer, rechazar. Mueve plata o suelta stock. */
  "pedidos.cobrar",
  /**
   * Editar un pedido que todavía no se pagó (O16): bajar cantidades, quitar
   * una línea, corregir la dirección. No es `pedidos.despachar` sino plata: la
   * pantalla muestra totales, descuento y envío —que el vendedor no ve— y
   * además los cambia.
   */
  "pedidos.editar",
  /**
   * Escribir notas internas en un pedido (O5). Los tres roles: es mostrador
   * puro —"llamó, pasa el jueves"— y quien atiende el teléfono es
   * justamente el vendedor. No mueve plata, no mueve stock, no cambia el
   * estado, y la compradora no la ve nunca.
   */
  "pedidos.notas",
  /** Ver y decidir comprobantes de transferencia. */
  "comprobantes",
  /** Ver montos: totales, desglose de IVA, precios del catálogo. */
  "precios",
  /** ABM de productos y variantes. */
  "productos",
  /**
   * Cambiar precios **en masa** por porcentaje (O7). Owner, y no `productos`,
   * por lo mismo que los reembolsos: el error no se ve y no se puede deshacer
   * con un botón. Un +10 % de más se descubre cuando ya se vendió a ese
   * precio. Las acciones masivas que no tocan plata —activar, mover de
   * categoría, duplicar— siguen bajo `productos`.
   */
  "precios.masivo",
  /** Ajustar `on_hand` a mano. */
  "stock",
  /** El listado de compradores con lo que gastó cada uno. */
  "clientes",
  /** Bajar CSV: la base del comercio en un archivo que sale del edificio. */
  "exports",
  /** Registrar una devolución. Plata que sale. */
  "reembolsos",
  /** Alta, baja y cambio de rol de los usuarios del panel (PR C). */
  "usuarios",
  /** ABM de cupones (PR G): plata que la tienda resigna en cada venta. */
  "cupones",
  /**
   * ABM de categorías (PR J). Apagar una categoría le saca de la vidriera
   * también a sus productos: es la forma más rápida de vaciar una tienda sin
   * tocar un solo producto.
   */
  "categorias",
  /**
   * ABM de zonas de envío (PR K). El flete es plata que entra, y una zona mal
   * puesta se cobra de menos en cada pedido hasta que alguien la mira.
   */
  "envios",
  /**
   * Los datos bancarios de la tienda (PR T): a qué cuenta transfieren las
   * compradoras. Quien los puede cambiar puede desviar la facturación entera
   * sin dejar un solo pedido raro, así que no se delega — owner, como los
   * reembolsos.
   */
  "banco",
  /**
   * El feed de actividad (PR L): quién hizo qué, en una pantalla. Es de
   * lectura y no toca nada, pero muestra el trabajo de cada persona con nombre
   * y apellido — es supervisión, no mostrador.
   */
  "actividad",
  /**
   * Moderar y responder reseñas de producto. Mismos roles que `productos`:
   * es la vidriera. Lo que ninguno puede —ni el dueño— es escribir una reseña
   * o cambiar la de una compradora: esa función no existe
   * (`src/domain/reviews.ts`).
   */
  "resenas",
  /**
   * Registrar una devolución de mercadería: qué volvió de un pedido y si va
   * al stock. Mismos roles que `stock`, porque eso es lo que mueve. **No es
   * `reembolsos`**: la plata que sale se registra aparte, owner-only.
   */
  "devoluciones",
  /**
   * Los ajustes de la tienda (`/admin/ajustes`): la portada, el anuncio, el
   * contacto público, las páginas de políticas, lo que se le dice a Google
   * sobre envíos y devoluciones. Es la cara de la tienda entera y el número
   * al que escriben las compradoras — quien lo cambia puede mandarlas a otro
   * WhatsApp. Owner, como el banco.
   */
  "ajustes",
  /**
   * Las integraciones (`/admin/integraciones`): las credenciales de
   * Cloudinary, WhatsApp Cloud y Pagopar, la medición y el reporte de
   * errores. Quien las cambia puede redirigir los comprobantes a otra cuenta
   * de Cloudinary, mandar los avisos desde otro número o cambiar la clave con
   * la que se firman los pagos con tarjeta. Owner, sin discusión.
   */
  "integraciones",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * Qué puede cada rol.
 *
 * `owner` está escrito como "todas" y no como una lista: la lista se
 * desactualiza, y el dueño por definición puede todo lo que exista.
 */
export const ROLE_CAPABILITIES: Readonly<Record<UserRole, readonly Capability[]>> = {
  owner: CAPABILITIES,

  // La operación diaria completa, sin lo que no se delega: nada de plata que
  // sale (`reembolsos`), nada de la base en un archivo (`exports`), nada de
  // repartir accesos (`usuarios`).
  staff: [
    "dashboard",
    "pedidos.ver",
    "pedidos.despachar",
    "pedidos.cobrar",
    "pedidos.editar",
    "pedidos.notas",
    "comprobantes",
    "precios",
    "productos",
    "resenas",
    "stock",
    "devoluciones",
    "clientes",
    // El encargado supervisa el turno: es el que necesita saber quién marcó
    // ese pedido como entregado un domingo. Lo que no puede es repartir
    // accesos ni sacar la base del edificio.
    "actividad",
  ],

  // El mostrador y nada más: ve los pedidos y los despacha. Sin montos, sin
  // comprobantes, sin stock, sin el resumen de ventas.
  vendedor: ["pedidos.ver", "pedidos.despachar", "pedidos.notas"],
};

export function can(role: UserRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}
