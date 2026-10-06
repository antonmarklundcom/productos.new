import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  tinyint,
  unique,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Data model (ARCH.md §2).
 *
 * Money rule, no exceptions: every `*_pyg` column is BIGINT UNSIGNED holding
 * whole guaraníes. No DECIMAL, no FLOAT, no cents. Prices are IVA incluido.
 */

// ---------------------------------------------------------------------------
// ENUMs (TASKS.md §3)
// ---------------------------------------------------------------------------

/**
 * Los valores de enum que el navegador también necesita viven en
 * `src/db/enums.ts`, sin `drizzle-orm` adentro (el motivo está escrito ahí).
 * Se re-exportan para que el lado del servidor los siga leyendo del schema.
 */
export {
  COUPON_TYPES,
  DOC_TYPES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  type CouponType,
  type DocType,
  type OrderStatus,
  type PaymentMethod,
} from "./enums";
// El `export ... from` re-exporta pero no trae los bindings a este módulo, y
// las columnas `mysqlEnum(...)` de abajo los necesitan como valores.
import {
  COUPON_TYPES,
  DOC_TYPES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  type PaymentMethod,
} from "./enums";

/**
 * Cómo llega el pedido a destino (PLAN.md FASE 3, métodos de envío).
 *
 * No es cosmética: cada valor tiene una regla distinta en el dominio. Un
 * `courier` nacional cobra por zona y no está en la puerta para cobrar en
 * efectivo; una moto `local` sí lo está, y es la única forma honesta de
 * ofrecer contra entrega en las ciudades donde el comercio realmente reparte;
 * `retiro` no viaja a ningún lado, así que ignora las zonas y cuesta ₲0
 * siempre.
 */
export const SHIPPING_METHOD_KINDS = ["courier", "local", "retiro"] as const;
export type ShippingMethodKind = (typeof SHIPPING_METHOD_KINDS)[number];

/**
 * De dónde sale el precio del envío de un método.
 *
 * `zona` reusa `shipping_zones` tal cual —incluido su umbral de envío
 * gratis—, que es lo que ya venía funcionando. `fijo` cobra
 * `fixed_price_pyg` cualquiera sea la ciudad: es la tarifa plana que cobra
 * una moto del barrio, y no tiene umbral porque no depende de la distancia.
 */
export const SHIPPING_METHOD_PRICINGS = ["zona", "fijo"] as const;
export type ShippingMethodPricing = (typeof SHIPPING_METHOD_PRICINGS)[number];

export const PAYMENT_PROVIDERS = ["spi", "cod", "pagopar"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_STATUSES = [
  "pending",
  "paid",
  "failed",
  "refunded",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const RECEIPT_REVIEWS = ["pending", "approved", "rejected"] as const;
export type ReceiptReview = (typeof RECEIPT_REVIEWS)[number];

/**
 * La moderación de una reseña de producto. Mismos tres valores que el
 * comprobante y por lo mismo: entra `pending`, y sólo una persona del panel la
 * aprueba o la rechaza. Lo único que se publica es `approved`.
 */
export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/**
 * Los roles viven en `src/lib/roles.ts`, sin dependencias, y se re-exportan
 * acá para que el resto del código los siga leyendo del schema. El motivo del
 * rodeo está escrito en ese archivo: `src/proxy.ts` corre en el edge y no
 * puede arrastrar `drizzle-orm` sólo para conocer tres strings.
 */
export { USER_ROLES, type UserRole } from "../lib/roles";
// El `export ... from` de arriba re-exporta pero no trae el binding a este
// módulo, y `users.role` lo necesita como valor.
import { USER_ROLES } from "../lib/roles";

export const INVOICE_STATUSES = [
  "none",
  "queued",
  "approved",
  "rejected",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const RESERVATION_STATES = ["held", "consumed", "released"] as const;
export type ReservationState = (typeof RESERVATION_STATES)[number];

export { IVA_RATES, type IvaRate } from "./enums";

/** Whole guaraníes. Never a float, never a decimal. */
const pyg = (name: string) => bigint(name, { mode: "number", unsigned: true });

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export const categories = mysqlTable(
  "categories",
  {
    id: int("id").autoincrement().primaryKey(),
    slug: varchar("slug", { length: 120 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    // Self-reference: declared as a plain column + FK added in post-push SQL so
    // drizzle-kit does not need a forward reference to its own table.
    parentId: int("parent_id"),
    position: int("position").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    /**
     * El texto que explica la categoría arriba de su grilla (plan-operacion §2).
     *
     * Nullable y sin default: una categoría sin descripción tiene que seguir
     * dibujándose exactamente como antes de esta columna. `text` y no
     * `varchar` porque es copy SEO —dos o tres párrafos— y recortarlo a 255
     * obligaría a reescribirlo cada vez que alguien lo mejora.
     */
    description: text("description"),
    /**
     * `public_id` de la foto de portada en Cloudinary, carpeta `categorias/`.
     * NULL = sin foto, y la página cae al encabezado de texto de siempre.
     */
    imageCloudinaryId: varchar("image_cloudinary_id", { length: 255 }),
    /**
     * El alt de esa foto. Va aparte y no derivado del nombre: "Zapatillas" no
     * describe la imagen, y una portada sin alt es una página menos accesible
     * y peor indexada. NULL sólo mientras no haya foto.
     */
    imageAlt: varchar("image_alt", { length: 200 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("categories_slug_uq").on(t.slug),
    index("categories_parent_idx").on(t.parentId),
  ]
);

export const products = mysqlTable(
  "products",
  {
    id: int("id").autoincrement().primaryKey(),
    slug: varchar("slug", { length: 160 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    saleMode: mysqlEnum("sale_mode", ["stock", "enquiry", "showcase"])
      .notNull()
      .default("stock"),
    showPrice: boolean("show_price").notNull().default(true),
    description: text("description"),
    categoryId: int("category_id")
      .notNull()
      .references(() => categories.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    brand: varchar("brand", { length: 120 }),
    /** 10 | 5 | 0 — IVA incluido en el precio. */
    ivaRate: tinyint("iva_rate").notNull().default(10),
    isActive: boolean("is_active").notNull().default(true),
    /**
     * Destacado de la home, elegido a mano por el comercio (plan-operacion §2).
     *
     * NOT NULL con default `false`, al revés que el consentimiento de
     * marketing: acá "nadie lo marcó" y "no es destacado" son lo mismo, así
     * que un tercer estado no significaría nada. El default es lo que hace
     * que una tienda que sincroniza esta migración no despliegue de golpe una
     * home llena de destacados que nadie eligió.
     */
    isFeatured: boolean("is_featured").notNull().default(false),
    publishedAt: datetime("published_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    unique("products_slug_uq").on(t.slug),
    index("products_category_idx").on(t.categoryId),
    index("products_active_published_idx").on(t.isActive, t.publishedAt),
    // La home pide "destacados publicados, los más nuevos primero" en cada
    // render: sin este índice es un full scan de `products` en la portada.
    index("products_featured_idx").on(t.isFeatured, t.publishedAt),
    // FULLTEXT(name, description) is created by scripts/post-push.ts — the
    // drizzle-kit MySQL dialect has no fulltext index builder.
  ]
);

export const productImages = mysqlTable(
  "product_images",
  {
    id: int("id").autoincrement().primaryKey(),
    productId: int("product_id")
      .notNull()
      .references(() => products.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    cloudinaryId: varchar("cloudinary_id", { length: 255 }).notNull(),
    blurDataUrl: text("blur_data_url"),
    alt: varchar("alt", { length: 255 }),
    position: int("position").notNull().default(0),
  },
  (t) => [index("product_images_product_idx").on(t.productId, t.position)]
);

export const variants = mysqlTable(
  "variants",
  {
    id: int("id").autoincrement().primaryKey(),
    productId: int("product_id")
      .notNull()
      .references(() => products.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    sku: varchar("sku", { length: 64 }).notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    pricePyg: pyg("price_pyg").notNull(),
    compareAtPyg: pyg("compare_at_pyg"),
    /** Physical count. Only changes when money confirms (see transitionOrder). */
    onHand: int("on_hand", { unsigned: true }).notNull().default(0),
    /**
     * A partir de cuántas unidades esta variante entra en "stock bajo"
     * (plan-operacion §2, lo usa el resumen diario de O6).
     *
     * NULL y no un default numérico en la columna: NULL es "usá el umbral
     * global de la tienda", y es lo que tiene que valer para toda variante
     * que existía antes de esta columna. Un `DEFAULT 3` escrito en la base
     * congelaría el umbral de hoy en cada fila y haría imposible cambiarlo
     * después para todas juntas.
     */
    reorderPoint: int("reorder_point", { unsigned: true }),
    isActive: boolean("is_active").notNull().default(true),
    position: int("position").notNull().default(0),
  },
  (t) => [
    unique("variants_sku_uq").on(t.sku),
    index("variants_product_idx").on(t.productId),
  ]
);

/**
 * "Avisame cuando haya stock" (plan-operacion §2, la manda O6).
 *
 * Una suscripción es un teléfono esperando una variante concreta, y nada
 * más: no hay cuenta, no hay carrito reservado y no promete ninguna unidad.
 * Cuando la disponibilidad de esa variante pasa de 0 a algo, sale un
 * WhatsApp y la fila queda marcada.
 *
 * `UNIQUE(variant_id, phone)` es lo que hace que tocar el botón cinco veces
 * —o dos personas desde el mismo teléfono— no se convierta en cinco
 * mensajes: el alta es un `INSERT IGNORE` contra este índice.
 *
 * `notified_at` NULL es "todavía esperando" y es el filtro de la consulta que
 * corre en cada reposición, de ahí el índice `(variant_id, notified_at)`.
 * Marcado ≠ entregado a propósito: la fila se marca **antes** de mandar, así
 * que un Meta caído cuesta un aviso perdido y nunca un bucle de reintentos
 * mandándole diez mensajes a la misma persona.
 */
export const stockAlerts = mysqlTable(
  "stock_alerts",
  {
    id: int("id").autoincrement().primaryKey(),
    variantId: int("variant_id")
      .notNull()
      .references(() => variants.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    /** `+5959XXXXXXXX`, normalizado por el mismo validador del checkout. */
    phone: varchar("phone", { length: 20 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    /** Cuándo se le avisó. NULL = sigue esperando. */
    notifiedAt: datetime("notified_at"),
  },
  (t) => [
    unique("stock_alerts_variant_phone_uq").on(t.variantId, t.phone),
    index("stock_alerts_pending_idx").on(t.variantId, t.notifiedAt),
  ]
);

// ---------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------

export const orders = mysqlTable(
  "orders",
  {
    id: int("id").autoincrement().primaryKey(),
    orderNumber: varchar("order_number", { length: 16 }).notNull(),
    accessToken: varchar("access_token", { length: 64 }).notNull(),
    status: mysqlEnum("status", ORDER_STATUSES)
      .notNull()
      .default("pendiente_pago"),

    customerName: varchar("customer_name", { length: 160 }).notNull(),
    customerPhone: varchar("customer_phone", { length: 20 }).notNull(),
    customerEmail: varchar("customer_email", { length: 200 }),
    docType: mysqlEnum("doc_type", DOC_TYPES).notNull().default("NINGUNO"),
    docNumber: varchar("doc_number", { length: 32 }),
    isConsumidorFinal: boolean("is_consumidor_final").notNull().default(true),

    shipCity: varchar("ship_city", { length: 120 }).notNull(),
    shipBarrio: varchar("ship_barrio", { length: 120 }),
    shipAddress: varchar("ship_address", { length: 255 }).notNull(),
    shipReference: varchar("ship_reference", { length: 255 }),
    shipMapsUrl: varchar("ship_maps_url", { length: 500 }),
    shippingZoneId: int("shipping_zone_id"),
    /**
     * El método de envío elegido (FASE 3). **Nullable para siempre**, y por
     * dos motivos distintos: los pedidos anteriores a la tabla no tienen
     * ninguno, y una tienda que nunca configuró métodos sigue comprando por
     * el camino implícito de siempre (ver `quoteShippingMethods`).
     *
     * Columna suelta con la FK en los extras, igual que `coupon_id`:
     * `shipping_methods` se declara después en este archivo.
     */
    shippingMethodId: int("shipping_method_id"),
    /**
     * El nombre del método tal como estaba al comprar. Snapshot, igual que
     * `coupon_code`: el dueño puede renombrar "Moto Asunción" o borrarlo, y
     * este pedido tiene que seguir diciendo cómo se entregó.
     */
    shippingMethodName: varchar("shipping_method_name", { length: 160 }),

    subtotalPyg: pyg("subtotal_pyg").notNull().default(0),
    shippingPyg: pyg("shipping_pyg").notNull().default(0),
    totalPyg: pyg("total_pyg").notNull().default(0),
    iva10Pyg: pyg("iva_10_pyg").notNull().default(0),
    iva5Pyg: pyg("iva_5_pyg").notNull().default(0),

    paymentMethod: mysqlEnum("payment_method", PAYMENT_METHODS).notNull(),
    cardCheckoutState: mysqlEnum("card_checkout_state", [
      "idle",
      "starting",
      "ready",
      "unknown",
    ])
      .notNull()
      .default("idle"),
    reservedUntil: datetime("reserved_until"),

    /**
     * Cuándo se le mandó a la compradora el recordatorio de "te queda poco
     * para pagar" (fable/plan-crecimiento.md §2). NULL = todavía no se mandó.
     *
     * Es la marca de idempotencia del cron, no una fecha informativa: el
     * recordatorio se marca **antes** de mandarse, con un
     * `UPDATE ... WHERE payment_reminder_sent_at IS NULL`, y sólo si esa
     * escritura afectó una fila sale el mensaje. El modo de falla que evita es
     * el spam: dos corridas del cron solapadas —o una que reintenta— le
     * mandarían dos veces el mismo aviso a la misma persona. Un envío que
     * falla queda marcado igual: un recordatorio de menos es tolerable, dos
     * no.
     *
     * Nullable para siempre: todo pedido anterior a esta columna, y todo
     * pedido que se paga a tiempo, muere con NULL acá.
     */
    paymentReminderSentAt: datetime("payment_reminder_sent_at"),

    /**
     * Consentimiento para novedades y promociones.
     *
     * Nullable a propósito, y son tres estados distintos: NULL es "no se le
     * preguntó" (todo pedido anterior a esta columna), `false` es "dijo que
     * no" y `true` es "aceptó". Un `NOT NULL DEFAULT false` los mezclaría, y
     * el consentimiento es justamente lo que no se puede completar después:
     * nadie puede decidir hoy qué habría contestado una compradora en marzo.
     *
     * El MVP no manda nada —no hay proveedor de mensajería en el stack— pero
     * el permiso sólo se puede pedir en el momento de la compra.
     */
    marketingOptIn: boolean("marketing_opt_in"),
    /** Cuándo contestó. Sin fecha, un "sí" no prueba nada dentro de un año. */
    marketingOptInAt: datetime("marketing_opt_in_at"),

    /**
     * Pedido para regalar. A diferencia del consentimiento, acá `false` y "no
     * contestó" son lo mismo —un pedido que nadie marcó como regalo no lo
     * es—, así que la columna es NOT NULL.
     */
    isGift: boolean("is_gift").notNull().default(false),
    /** Mensajito para la tarjeta. Sólo se guarda si `is_gift` está en true. */
    giftNote: varchar("gift_note", { length: 300 }),

    // FASE 2 — FacturaPY. Nullable, unused in the MVP (ARCH.md §7).
    invoiceStatus: mysqlEnum("invoice_status", INVOICE_STATUSES)
      .notNull()
      .default("none"),
    invoiceCdc: varchar("invoice_cdc", { length: 64 }),
    invoicePdfUrl: varchar("invoice_pdf_url", { length: 500 }),

    /**
     * El cupón aplicado, si hubo uno (PR G). Columna suelta con la FK en los
     * extras: `coupons` se declara después en este archivo.
     */
    couponId: int("coupon_id"),
    /**
     * El código tal como estaba al comprar. Snapshot, igual que
     * `order_items.name_snapshot`: si mañana el dueño renombra o borra el
     * cupón, este pedido tiene que seguir explicando de dónde salió su
     * descuento.
     */
    couponCode: varchar("coupon_code", { length: 40 }),
    /**
     * Lo que se descontó, en guaraníes enteros. **Siempre** se resta del
     * subtotal, nunca del envío:
     *
     *   total = subtotal − descuento + envío
     *
     * `pnpm reconcile` verifica esa identidad en cada pedido.
     */
    discountPyg: pyg("discount_pyg").notNull().default(0),

    /**
     * La cuenta que hizo el pedido, si había una (PR E). **Nullable para
     * siempre**: el checkout de invitado es el camino principal y no se toca,
     * así que la enorme mayoría de los pedidos van a tener NULL acá.
     *
     * Declarada como columna suelta y con la FK agregada en los extras, igual
     * que `categories.parent_id`: la tabla `customers` se declara después en
     * este archivo y drizzle-kit no maneja la referencia hacia adelante.
     */
    customerId: int("customer_id"),

    /**
     * Seguimiento del envío (plan-operacion §2). Los tres se escriben
     * **adentro de la transacción** que mueve el pedido a `enviado`
     * (`transitionOrder`), nunca en un UPDATE aparte: si fueran dos
     * escrituras, un pedido podría quedar despachado sin guía o con la guía
     * del envío anterior, y la compradora recibiría un aviso que no sirve
     * para rastrear nada.
     *
     * Los tres nullable para siempre: el pedido de una tienda que reparte en
     * moto propia no tiene número de guía y no por eso está incompleto.
     */
    trackingCarrier: varchar("tracking_carrier", { length: 80 }),
    trackingCode: varchar("tracking_code", { length: 120 }),
    /** Sólo `https://`, validado en `src/lib/schemas.ts` antes de llegar acá. */
    trackingUrl: varchar("tracking_url", { length: 500 }),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
    paidAt: datetime("paid_at"),
  },
  (t) => [
    unique("orders_number_uq").on(t.orderNumber),
    index("orders_customer_idx").on(t.customerId),
    index("orders_coupon_idx").on(t.couponId),
    index("orders_shipping_method_idx").on(t.shippingMethodId),
    unique("orders_access_token_uq").on(t.accessToken),
    index("orders_status_created_idx").on(t.status, t.createdAt),
    index("orders_phone_idx").on(t.customerPhone),
    index("orders_doc_number_idx").on(t.docNumber),
    index("orders_reserved_until_idx").on(t.reservedUntil),
  ]
);

export const orderItems = mysqlTable(
  "order_items",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("order_id")
      .notNull()
      .references(() => orders.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    // RESTRICT: a variant that was ever sold cannot be deleted out from under
    // an order. The snapshots below are what the buyer actually agreed to.
    variantId: int("variant_id")
      .notNull()
      .references(() => variants.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    nameSnapshot: varchar("name_snapshot", { length: 255 }).notNull(),
    skuSnapshot: varchar("sku_snapshot", { length: 64 }).notNull(),
    unitPricePyg: pyg("unit_price_pyg").notNull(),
    qty: int("qty", { unsigned: true }).notNull(),
    ivaRate: tinyint("iva_rate").notNull(),
    lineTotalPyg: pyg("line_total_pyg").notNull(),
  },
  (t) => [
    index("order_items_order_idx").on(t.orderId),
    index("order_items_variant_idx").on(t.variantId),
  ]
);

export const payments = mysqlTable(
  "payments",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("order_id")
      .notNull()
      .references(() => orders.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    provider: mysqlEnum("provider", PAYMENT_PROVIDERS).notNull(),
    providerRef: varchar("provider_ref", { length: 191 }).notNull(),
    amountPyg: pyg("amount_pyg").notNull(),
    status: mysqlEnum("status", PAYMENT_STATUSES).notNull().default("pending"),
    /**
     * Cuánto de este pago ya se devolvió, en guaraníes enteros
     * (plan-operacion §2, lo mueve O7).
     *
     * Es un acumulado derivado: **siempre** igual a la suma de `refunds` de
     * este pago y nunca mayor que `amount_pyg`. Existe igual porque la
     * decisión "¿puedo devolver ₲50.000 más?" se toma con la fila bloqueada
     * en una sola transacción, y un `SUM()` sobre el ledger adentro de ese
     * lock es exactamente la carrera que el lock existe para evitar.
     * `pnpm reconcile` verifica las dos igualdades en cada corrida: si esta
     * columna y el ledger se separan, la contabilidad avisa.
     *
     * NOT NULL con default 0: un pago sin devoluciones tiene 0, no NULL. La
     * migración backfillea los `refunded` viejos (devolución total anterior
     * al ledger) para que esa invariante nazca verde.
     */
    refundedPyg: pyg("refunded_pyg").notNull().default(0),
    rawPayload: json("raw_payload"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    unique("payments_provider_ref_uq").on(t.provider, t.providerRef),
    index("payments_order_idx").on(t.orderId),
  ]
);

/**
 * El ledger de devoluciones, totales y parciales (plan-operacion §2 y §5.3).
 *
 * Append-only, como `order_events` y `stock_adjustments`: una devolución no
 * se edita ni se borra, se compensa con otra fila. Cada fila es plata que
 * salió, con su monto entero, su motivo y quién la autorizó.
 *
 * Por qué una tabla y no sólo `payments.status = 'refunded'`: ese estado sólo
 * podía contar la historia de la devolución total. Un comercio que devuelve
 * una remera de un pedido de tres no tiene dónde escribirlo, y termina
 * anotándolo en el motivo de un evento de pedido —texto libre, no sumable— o
 * en ningún lado.
 */
export const refunds = mysqlTable(
  "refunds",
  {
    id: int("id").autoincrement().primaryKey(),
    paymentId: int("payment_id")
      .notNull()
      .references(() => payments.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    /** Entero > 0. La suma de este pago nunca puede pasar `payments.amount_pyg`. */
    amountPyg: pyg("amount_pyg").notNull(),
    /** Obligatorio por diseño, igual que en `stock_adjustments`. */
    reason: varchar("reason", { length: 500 }).notNull(),
    actor: varchar("actor", { length: 120 }).notNull(),
    /** La FK consultable; ver el comentario largo en `stock_adjustments`. */
    actorUserId: int("actor_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("refunds_payment_idx").on(t.paymentId)]
);

/** Webhook idempotency ledger — UNIQUE(provider, event_key) is the whole point. */
export const paymentEvents = mysqlTable(
  "payment_events",
  {
    id: int("id").autoincrement().primaryKey(),
    provider: mysqlEnum("provider", PAYMENT_PROVIDERS).notNull(),
    eventKey: varchar("event_key", { length: 191 }).notNull(),
    payload: json("payload"),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
  },
  (t) => [unique("payment_events_key_uq").on(t.provider, t.eventKey)]
);

export const receipts = mysqlTable(
  "receipts",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("order_id")
      .notNull()
      .references(() => orders.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    /** Private Cloudinary folder — served to the admin via signed URLs only. */
    cloudinaryId: varchar("cloudinary_id", { length: 255 }).notNull(),
    mime: varchar("mime", { length: 100 }).notNull(),
    bytes: int("bytes", { unsigned: true }).notNull(),
    uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
    review: mysqlEnum("review", RECEIPT_REVIEWS).notNull().default("pending"),
    reviewedBy: int("reviewed_by"),
    reviewedAt: datetime("reviewed_at"),
    note: varchar("note", { length: 500 }),
  },
  (t) => [
    index("receipts_order_idx").on(t.orderId),
    index("receipts_review_idx").on(t.review),
  ]
);

export const stockReservations = mysqlTable(
  "stock_reservations",
  {
    id: int("id").autoincrement().primaryKey(),
    variantId: int("variant_id")
      .notNull()
      .references(() => variants.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    orderId: int("order_id")
      .notNull()
      .references(() => orders.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    qty: int("qty", { unsigned: true }).notNull(),
    expiresAt: datetime("expires_at").notNull(),
    state: mysqlEnum("state", RESERVATION_STATES).notNull().default("held"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("stock_reservations_availability_idx").on(
      t.variantId,
      t.state,
      t.expiresAt
    ),
    index("stock_reservations_order_idx").on(t.orderId),
  ]
);

/**
 * Ajustes manuales de stock hechos desde el panel (PLAN.md 4.6).
 *
 * `variants.on_hand` es la única cifra física, y fuera de una venta confirmada
 * sólo la mueve el dueño. Cada movimiento deja fila acá con el motivo, el
 * actor y el antes/después: sin esto, un faltante de inventario es una
 * discusión sin registro. Append-only, igual que `order_events`.
 */
export const stockAdjustments = mysqlTable(
  "stock_adjustments",
  {
    id: int("id").autoincrement().primaryKey(),
    variantId: int("variant_id")
      .notNull()
      .references(() => variants.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    /** Con signo: negativo es merma, positivo es reposición. */
    delta: int("delta").notNull(),
    previousOnHand: int("previous_on_hand", { unsigned: true }).notNull(),
    newOnHand: int("new_on_hand", { unsigned: true }).notNull(),
    /** Obligatorio por diseño: un ajuste sin motivo no se puede auditar. */
    reason: varchar("reason", { length: 300 }).notNull(),
    actor: varchar("actor", { length: 120 }).notNull(),
    /**
     * Quién, como FK consultable (PR D).
     *
     * `actor` sigue existiendo y sigue siendo la verdad histórica: es el texto
     * que había en el momento (`admin:due@tienda.py`), y no cambia si después
     * esa persona cambia de email o se borra su usuario. Esta columna es para
     * **preguntar**: "todo lo que hizo el usuario 4 en agosto" no se puede
     * consultar contra un string sin adivinar.
     *
     * Nullable, y las dos razones importan: lo escrito antes de esta columna
     * no se backfillea —inventar la atribución del histórico es peor que no
     * tenerla— y hay escrituras legítimas sin usuario detrás (el cron, un
     * webhook de Pagopar, la compradora subiendo su comprobante).
     */
    actorUserId: int("actor_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("stock_adjustments_variant_idx").on(t.variantId, t.createdAt),
    index("stock_adjustments_actor_idx").on(t.actorUserId, t.createdAt),
  ]
);

/**
 * Auditoría de cambios de precio (plan-operacion §2, la escribe O7).
 *
 * El hermano de `stock_adjustments`, y por el mismo motivo: `variants.
 * price_pyg` es una sola cifra que se pisa, así que sin esta tabla la
 * pregunta "¿por qué esta variante vale ₲180.000 si la semana pasada valía
 * ₲150.000?" no tiene respuesta.
 *
 * Importa sobre todo por la acción masiva: subir un 20% a doscientas
 * variantes de un click es la operación más fácil de arrepentirse del panel,
 * y una fila por variante afectada es lo que permite mirar qué pasó y
 * volverla atrás.
 */
export const priceAdjustments = mysqlTable(
  "price_adjustments",
  {
    id: int("id").autoincrement().primaryKey(),
    variantId: int("variant_id")
      .notNull()
      .references(() => variants.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    /** El precio que había, en guaraníes enteros. */
    fromPyg: pyg("from_pyg").notNull(),
    /** El precio que quedó. Nunca ₲0 por redondeo: lo garantiza el dominio. */
    toPyg: pyg("to_pyg").notNull(),
    reason: varchar("reason", { length: 500 }).notNull(),
    actor: varchar("actor", { length: 120 }).notNull(),
    actorUserId: int("actor_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("price_adjustments_variant_idx").on(t.variantId, t.createdAt)]
);

/** Append-only audit log. Written by transitionOrder() and nothing else. */
export const orderEvents = mysqlTable(
  "order_events",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("order_id")
      .notNull()
      .references(() => orders.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    fromStatus: mysqlEnum("from_status", ORDER_STATUSES),
    toStatus: mysqlEnum("to_status", ORDER_STATUSES).notNull(),
    actor: varchar("actor", { length: 120 }).notNull(),
    /**
     * Quién, como FK consultable (PR D). Ver el comentario largo en
     * `stock_adjustments.actor_user_id`: `actor` es la verdad histórica, esto
     * es para poder preguntar.
     *
     * NULL en todo lo que no lo movió una persona del panel — el cron que
     * vence pedidos, el webhook de Pagopar, la compradora que sube su
     * comprobante — y en todo lo anterior a esta columna.
     */
    actorUserId: int("actor_user_id"),
    reason: varchar("reason", { length: 500 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("order_events_order_idx").on(t.orderId, t.createdAt),
    index("order_events_actor_idx").on(t.actorUserId, t.createdAt),
  ]
);

/**
 * Notas internas del pedido (plan-operacion §2 y §5.1).
 *
 * **Nunca las ve la compradora.** Son el renglón que hoy se escribe en un
 * cuaderno o en el grupo de WhatsApp del local: "llamó, pasa a retirar el
 * jueves", "el timbre no anda, avisar por teléfono".
 *
 * Tabla propia y no un `order_events` con `from = to`: una nota **no es una
 * transición**. Meterla ahí obligaría a que todo lo que lee el historial de
 * estados —`reconcile`, la máquina de estados, el timeline del comprador—
 * aprendiera a ignorar filas que no son cambios de estado, y bastaría con
 * que uno se olvidara para que una nota apareciera como un movimiento del
 * pedido. En el feed de `/admin/actividad` las dos se muestran juntas, que es
 * donde tiene sentido mezclarlas.
 *
 * `ON DELETE CASCADE`: la nota no significa nada sin su pedido.
 */
export const orderNotes = mysqlTable(
  "order_notes",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("order_id")
      .notNull()
      .references(() => orders.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    /** 1..1000 caracteres, trimmed. Una nota vacía no se guarda. */
    body: varchar("body", { length: 1000 }).notNull(),
    actor: varchar("actor", { length: 120 }).notNull(),
    /** La FK consultable; ver el comentario largo en `stock_adjustments`. */
    actorUserId: int("actor_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("order_notes_order_idx").on(t.orderId, t.createdAt)]
);

/**
 * Devoluciones de mercadería: qué volvió de un pedido y si se repuso al stock.
 *
 * Append-only, como `refunds` y `stock_adjustments`: una devolución no se
 * edita ni se borra. Si se cargó de más, la corrección es otro movimiento
 * (un ajuste de stock con su motivo), y las dos filas quedan para contar la
 * historia completa.
 *
 * **No es plata.** El reembolso vive en `refunds` y se registra aparte, con
 * su propio formulario y su propio permiso (owner). Una devolución de
 * mercadería puede no tener reembolso —un cambio por otro talle— y un
 * reembolso puede no tener mercadería que vuelva —un paquete perdido—: atar
 * las dos cosas obligaría a inventar una de las mitades.
 *
 * `ON DELETE CASCADE` contra el pedido: sin pedido, la devolución no dice
 * nada. El stock que se repuso ya quedó contado en `stock_adjustments`.
 */
export const orderReturns = mysqlTable(
  "order_returns",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("order_id")
      .notNull()
      .references(() => orders.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    /** Obligatorio por diseño, igual que en `stock_adjustments`. */
    reason: varchar("reason", { length: 500 }).notNull(),
    actor: varchar("actor", { length: 120 }).notNull(),
    /** La FK consultable; ver el comentario largo en `stock_adjustments`. */
    actorUserId: int("actor_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("order_returns_order_idx").on(t.orderId),
    index("order_returns_created_idx").on(t.createdAt),
  ]
);

/**
 * Las líneas de una devolución: cuántas unidades de qué línea del pedido, y
 * si volvieron al stock (una prenda manchada vuelve, pero no se vende).
 *
 * `RESTRICT` contra `order_items` y `variants`, como `order_items` contra
 * `variants`: una línea que alguna vez se devolvió no puede desaparecer
 * debajo del registro.
 */
export const orderReturnItems = mysqlTable(
  "order_return_items",
  {
    id: int("id").autoincrement().primaryKey(),
    returnId: int("return_id")
      .notNull()
      .references(() => orderReturns.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    orderItemId: int("order_item_id")
      .notNull()
      // CASCADE y no RESTRICT: la fila ya cuelga del pedido por `return_id`, y
      // con dos caminos de borrado (pedido → devolución → ítem y pedido →
      // línea → ítem) un RESTRICT depende del orden en que InnoDB recorra las
      // cascadas para dejar borrar un pedido o no.
      .references(() => orderItems.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    variantId: int("variant_id")
      .notNull()
      .references(() => variants.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    /** ≥ 1, y nunca más de lo pedido menos lo ya devuelto de esa línea. */
    qty: int("qty", { unsigned: true }).notNull(),
    restocked: boolean("restocked").notNull(),
  },
  (t) => [
    index("order_return_items_return_idx").on(t.returnId),
    index("order_return_items_order_item_idx").on(t.orderItemId),
  ]
);

/**
 * Reseñas de producto, sólo de compras verificadas (ver `src/domain/reviews.ts`).
 *
 * Cada fila cuelga de un **pedido entregado** y no de una persona: es lo que
 * hace que la reseña sea de alguien que de verdad recibió el producto, que es
 * la condición de Google para mostrar estrellas en el resultado. El
 * `UNIQUE(order_id, product_id)` es "una reseña por producto por compra":
 * volver a mandar el formulario choca contra el índice y no duplica nada.
 *
 * `author_name` es un snapshot armado al escribir ("Rosa G."), nunca el
 * nombre completo del pedido: se publica en la vidriera y en el JSON-LD.
 *
 * `rating`, `title` y `body` los escribe la compradora y **nadie los edita
 * después**: el panel sólo cambia `status` y `owner_reply`. `ON DELETE
 * CASCADE` contra producto y pedido: sin ninguno de los dos, la reseña no
 * tiene de qué hablar ni quién la respalde.
 */
export const productReviews = mysqlTable(
  "product_reviews",
  {
    id: int("id").autoincrement().primaryKey(),
    productId: int("product_id")
      .notNull()
      .references(() => products.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    orderId: int("order_id")
      .notNull()
      .references(() => orders.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    /** 1..5. El rango lo valida el dominio. */
    rating: tinyint("rating", { unsigned: true }).notNull(),
    title: varchar("title", { length: 120 }),
    /** 10..2000 caracteres, trimmed. */
    body: text("body").notNull(),
    /** "Nombre I." — derivado del pedido al escribir, nunca el nombre completo. */
    authorName: varchar("author_name", { length: 80 }).notNull(),
    status: mysqlEnum("status", REVIEW_STATUSES).notNull().default("pending"),
    /** La respuesta pública de la tienda. NULL = sin respuesta. */
    ownerReply: text("owner_reply"),
    ownerReplyAt: datetime("owner_reply_at"),
    moderatedAt: datetime("moderated_at"),
    /** La FK consultable; ver el comentario largo en `stock_adjustments`. */
    moderatedByUserId: int("moderated_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("product_reviews_order_product_uq").on(t.orderId, t.productId),
    index("product_reviews_product_status_idx").on(
      t.productId,
      t.status,
      t.createdAt
    ),
  ]
);

// ---------------------------------------------------------------------------
// Cupones (PLAN.md FASE 2, PR G) — cero filas = invisible
// ---------------------------------------------------------------------------

/**
 * Códigos de descuento.
 *
 * **Un descuento es plata**, así que valen las mismas reglas que el resto del
 * camino del dinero (README §"Reglas no negociables"):
 *
 * - `value` es un **entero** en las dos variantes: el porcentaje (1..100) o el
 *   monto en guaraníes. Nunca un float, nunca un decimal.
 * - El navegador manda el **código**, jamás el descuento. Lo calcula
 *   `computeOrderTotals` en el servidor, contra estas filas.
 *
 * Sin filas en esta tabla no hay campo de cupón en el checkout: cero cupones =
 * la tienda de siempre.
 */
export const coupons = mysqlTable(
  "coupons",
  {
    id: int("id").autoincrement().primaryKey(),

    /** Siempre en mayúsculas y sin espacios: se normaliza antes de guardar. */
    code: varchar("code", { length: 40 }).notNull(),

    type: mysqlEnum("type", COUPON_TYPES).notNull(),

    /**
     * `porcentaje` → 1..100. `monto_fijo` → guaraníes enteros.
     *
     * Una sola columna para los dos casos porque son excluyentes, y en los dos
     * es un entero. Qué significa lo dice `type`, y el dominio lo valida.
     */
    value: bigint("value", { mode: "number", unsigned: true }).notNull(),

    /** Mínimo de compra (sobre el subtotal, sin envío). NULL = sin mínimo. */
    minOrderPyg: pyg("min_order_pyg"),

    /** Vigencia. NULL de cada lado = sin límite por ese lado. */
    startsAt: datetime("starts_at"),
    endsAt: datetime("ends_at"),

    /** Tope global de usos. NULL = ilimitado. */
    maxUses: int("max_uses", { unsigned: true }),
    /** Tope por comprador. NULL = ilimitado. */
    maxUsesPerCustomer: int("max_uses_per_customer", { unsigned: true }),

    /**
     * Cuántas veces se usó. La incrementa `createOrder` **adentro de la
     * transacción y con la fila bloqueada** (`FOR UPDATE`), igual que el stock:
     * sin eso, dos checkouts simultáneos gastan dos veces un cupón de un uso.
     */
    timesUsed: int("times_used", { unsigned: true }).notNull().default(0),

    /**
     * Sólo para quien tenga cuenta (PR E). Con `TIENDA.cuentasClientes`
     * apagado nadie tiene sesión de cliente, así que estos cupones
     * simplemente no validan — degradan solos, sin romper nada.
     */
    soloClientes: boolean("solo_clientes").notNull().default(false),

    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("coupons_code_uq").on(t.code),
    index("coupons_active_idx").on(t.isActive),
  ]
);

// ---------------------------------------------------------------------------
// Cuentas de cliente (PLAN.md FASE 2, PR E) — detrás de `TIENDA.cuentasClientes`
// ---------------------------------------------------------------------------

/**
 * Compradoras con cuenta.
 *
 * **Tabla propia, separada de `users`, y no es un detalle de estilo.** Un
 * cliente jamás tiene que poder pisar el panel: si compartieran tabla, un bug
 * de rol o un `UPDATE` mal escrito convierte a una compradora en staff. Acá no
 * hay ningún camino desde esta tabla hacia `/admin` — ni columna de rol, ni
 * sesión compartida (la cookie y el secreto son propios, ver
 * `src/lib/customer-session.ts`).
 *
 * **La cuenta es opcional y siempre lo va a ser.** El checkout de invitado no
 * se toca: obligar a registrarse antes de la primera compra es el mayor
 * asesino de conversión del e-commerce paraguayo (ARCH.md §1). Esto existe
 * para quien *quiere* que le guardemos los datos.
 */
export const customers = mysqlTable(
  "customers",
  {
    id: int("id").autoincrement().primaryKey(),

    /**
     * La llave real. Normalizado `+595XXXXXXXXX` por `normalizePhonePY` antes
     * de insertar — igual que `orders.customer_phone`, para que las dos
     * columnas se puedan comparar entre sí.
     */
    phone: varchar("phone", { length: 20 }).notNull(),

    /** Opcional: en PY se compra con WhatsApp, no con email. */
    email: varchar("email", { length: 200 }),

    /**
     * bcrypt. **Nullable a propósito**: el PR F agrega login sin contraseña
     * (OTP por WhatsApp), y una cuenta creada por ese camino nunca tuvo una.
     * NULL significa "esta cuenta no entra con contraseña", y `verifyPassword`
     * ya devuelve false contra un hash señuelo en ese caso.
     */
    passwordHash: varchar("password_hash", { length: 255 }),

    name: varchar("name", { length: 160 }).notNull(),

    /**
     * Consentimiento para novedades. Tres estados como en `orders`: NULL es
     * "no se le preguntó", y no se completa con `false`.
     */
    marketingOptIn: boolean("marketing_opt_in"),
    marketingOptInAt: datetime("marketing_opt_in_at"),

    /**
     * Cuándo se probó que el teléfono es suyo. **Siempre NULL en este PR**: no
     * hay proveedor de mensajería todavía, así que nadie puede probar nada.
     *
     * Existe desde ahora porque es lo que decide si `/cuenta` le muestra los
     * pedidos viejos que sólo matchean por número de teléfono. Sin esta
     * columna, cualquiera que se registre tipeando el WhatsApp de otra persona
     * ve el historial de compras de esa persona — nombre, dirección y todo.
     * El PR F (OTP) es el único que la va a escribir.
     */
    phoneVerifiedAt: datetime("phone_verified_at"),
    sessionVersion: int("session_version", { unsigned: true })
      .notNull()
      .default(1),

    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastLoginAt: datetime("last_login_at"),
  },
  (t) => [
    unique("customers_phone_uq").on(t.phone),
    unique("customers_email_uq").on(t.email),
  ]
);

/**
 * Códigos de un solo uso para entrar sin contraseña (PLAN.md FASE 2, PR F).
 *
 * **El código nunca se guarda.** Se guarda su SHA-256, igual que una
 * contraseña: quien lea esta tabla —un backup, un dump, una consulta de
 * soporte— no puede entrar a ninguna cuenta con lo que ve. La comparación es
 * por hash, y el hash es de un valor de 32 bytes aleatorios, así que no hay
 * nada que rainbow-tablear y no hace falta bcrypt (que además haría lento un
 * flujo que la gente espera mirando el teléfono).
 *
 * Append-only en la práctica: `consumed_at` marca el usado y `invalidated_at`
 * los que quedaron viejos al pedir uno nuevo. No se borran, porque "¿cuántos
 * códigos pidió esta cuenta anoche?" es la pregunta de un incidente.
 */
export const loginTokens = mysqlTable(
  "login_tokens",
  {
    id: int("id").autoincrement().primaryKey(),

    customerId: int("customer_id").notNull(),

    /** SHA-256 hex del código. Nunca el código. */
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    attempts: tinyint("attempts", { unsigned: true }).notNull().default(0),

    /** Por dónde se mandó, para poder explicar un "no me llegó". */
    channel: varchar("channel", { length: 20 }).notNull(),

    expiresAt: datetime("expires_at").notNull(),
    consumedAt: datetime("consumed_at"),
    /** Lo invalidó un pedido posterior: sólo el último código vale. */
    invalidatedAt: datetime("invalidated_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("login_tokens_customer_idx").on(t.customerId, t.createdAt)]
);

// ---------------------------------------------------------------------------
// Admin / operación
// ---------------------------------------------------------------------------

export const users = mysqlTable(
  "users",
  {
    id: int("id").autoincrement().primaryKey(),
    email: varchar("email", { length: 200 }).notNull(),
    /** bcrypt. There is no public registration route — see scripts/create-owner.ts. */
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    name: varchar("name", { length: 160 }),
    role: mysqlEnum("role", USER_ROLES).notNull().default("staff"),
    sessionVersion: int("session_version", { unsigned: true })
      .notNull()
      .default(1),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    /**
     * Última vez que entró al panel. La escribe `authenticate()` y nadie más.
     *
     * NULL es "nunca entró", que es información distinta de "entró hace
     * mucho": es lo que le dice al dueño que la cuenta que creó el martes
     * sigue sin usarse, o que la de alguien que ya no trabaja acá quedó viva.
     */
    lastLoginAt: datetime("last_login_at"),
  },
  (t) => [unique("users_email_uq").on(t.email)]
);

export const shippingZones = mysqlTable(
  "shipping_zones",
  {
    id: int("id").autoincrement().primaryKey(),
    slug: varchar("slug", { length: 120 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    /** Lista de ciudades PY que caen en esta zona. */
    cities: json("cities").$type<string[]>().notNull(),
    pricePyg: pyg("price_pyg").notNull(),
    /** Envío gratis a partir de este subtotal. NULL = sin umbral. */
    freeThresholdPyg: pyg("free_threshold_pyg"),
    isActive: boolean("is_active").notNull().default(true),
    position: int("position").notNull().default(0),
  },
  (t) => [unique("shipping_zones_slug_uq").on(t.slug)]
);

/**
 * Métodos de envío (FASE 3).
 *
 * Antes de esta tabla el envío era **una sola cosa**: la zona de la ciudad.
 * Un comercio paraguayo típico ofrece a la vez un courier nacional, una moto
 * propia que cobra al entregar y, a veces, retiro en el local — y "contra
 * entrega" quedaba habilitado para ciudades donde nadie iba a ir a cobrar en
 * la puerta. Acá cada forma de entregar es una fila, con **qué medios de pago
 * habilita**, que es lo que faltaba para que esa promesa no se hiciera sola.
 *
 * Tabla vacía = la tienda de siempre: `quoteShippingMethods` devuelve un
 * único método implícito con el precio de la zona y los tres medios de pago.
 * Ninguna tienda ya clonada cambia de comportamiento por actualizar.
 */
export const shippingMethods = mysqlTable(
  "shipping_methods",
  {
    id: int("id").autoincrement().primaryKey(),
    slug: varchar("slug", { length: 120 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    kind: mysqlEnum("kind", SHIPPING_METHOD_KINDS).notNull().default("courier"),
    pricing: mysqlEnum("pricing", SHIPPING_METHOD_PRICINGS)
      .notNull()
      .default("zona"),
    /** Sólo se usa con `pricing = 'fijo'`. NULL con `zona`, que manda la zona. */
    fixedPricePyg: pyg("fixed_price_pyg"),
    /**
     * A qué zonas de `shipping_zones` aplica este método. **Lista vacía =
     * todas las zonas activas**, que es el default y el caso más común: el
     * courier nacional llega a todos lados. `retiro` la ignora entera.
     */
    zoneIds: json("zone_ids").$type<number[]>().notNull(),
    /**
     * Qué medios de pago habilita, subconjunto de `PAYMENT_METHODS`. **Nunca
     * vacía**: un método que no acepta ninguna forma de pago no se puede
     * elegir, y una fila así apagaría el checkout sin decir por qué.
     */
    allowedPaymentMethods: json("allowed_payment_methods")
      .$type<PaymentMethod[]>()
      .notNull(),
    /** Una línea para el checkout: "Llega en 24-48 h a todo el país". */
    description: varchar("description", { length: 200 }),
    isActive: boolean("is_active").notNull().default(true),
    position: int("position").notNull().default(0),
  },
  (t) => [unique("shipping_methods_slug_uq").on(t.slug)]
);

/**
 * Dedicated order-number counter. One row, bumped with an atomic UPDATE.
 * Never COUNT(*) — gaps are fine, collisions are not.
 */
export const counters = mysqlTable("counters", {
  name: varchar("name", { length: 64 }).primaryKey(),
  value: bigint("value", { mode: "number", unsigned: true })
    .notNull()
    .default(0),
});

/**
 * Marker written by `POST /api/setup/init` (DEPLOY.md §4).
 *
 * One row, `id` always 1. It exists so the setup route can tell a first deploy
 * from a second call: without it, a curl repeated out of nerves re-seeds the
 * catalogue over a store that is already selling. Migrations and schema extras
 * are idempotent and always run; seeding and the owner upsert are what this
 * gates, and `force: true` is what re-opens them.
 *
 * Timestamps and nothing else — no ids, no emails. Whoever reads this table is
 * asking "did setup already run?", not "who ran it".
 */
export const setupState = mysqlTable("setup_state", {
  id: tinyint("id").primaryKey(),
  migratedAt: timestamp("migrated_at").notNull().defaultNow(),
  seededAt: timestamp("seeded_at"),
  ownerAt: timestamp("owner_at"),
  /** How many times the route ran. Only ever climbs; useful in a post-mortem. */
  runs: int("runs").notNull().default(1),
});

// ---------------------------------------------------------------------------
// Datos bancarios (PLAN.md FASE 2, PR T) — singleton, editable desde /admin
// ---------------------------------------------------------------------------

/**
 * A dónde transferir: banco, titular, RUC, cuenta y tipo de cuenta.
 *
 * Vivían sólo en `BANCO_*` del entorno, y eso significaba que corregir un
 * número de cuenta mal tipeado era un cambio en el hPanel y un redeploy — o
 * sea, una llamada al desarrollador para arreglar el dato del que depende
 * **el método de pago principal** de la tienda. Acá lo edita el dueño desde
 * el navegador y el entorno queda de fallback (ver `getDatosBancarios`).
 *
 * Singleton con el patrón de `setup_state`: una sola fila, `id` siempre 1, y
 * **columnas explícitas** en vez de clave-valor. Un key-value acepta
 * `bnaco = "Itaú"` sin quejarse y deja de tener tipos; acá una columna que no
 * existe no compila.
 *
 * Esto es **copy de display**: no entra en `computeOrderTotals` ni en ningún
 * total. Cambiarlo cambia lo que la compradora lee en la página del pedido y
 * en el WhatsApp de recuperación, nunca cuánto paga.
 *
 * Los cinco campos de texto son `NOT NULL` y el dominio los exige
 * todos-o-nada: media cuenta cargada es peor que ninguna, porque la página
 * mostraría un banco sin número. Sin fila —o con la fila incompleta— la
 * página avisa en vez de inventar, igual que antes.
 */
export const bankDetails = mysqlTable("bank_details", {
  id: tinyint("id").primaryKey(),
  banco: varchar("banco", { length: 120 }).notNull(),
  titular: varchar("titular", { length: 160 }).notNull(),
  ruc: varchar("ruc", { length: 20 }).notNull(),
  cuenta: varchar("cuenta", { length: 60 }).notNull(),
  tipoCuenta: varchar("tipo_cuenta", { length: 60 }).notNull(),
  /**
   * `public_id` del QR SPI en Cloudinary, en una carpeta **pública**. NULL =
   * sin QR cargado, y ahí manda `BANCO_QR_URL` del entorno si está.
   */
  qrCloudinaryId: varchar("qr_cloudinary_id", { length: 255 }),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  /**
   * Quién lo tocó por última vez. `ON DELETE SET NULL`: el dato bancario de
   * la tienda no se puede ir con el usuario que lo cargó.
   */
  updatedBy: int("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
});

// ---------------------------------------------------------------------------
// Ajustes de la tienda — singleton JSON, editable desde /admin/ajustes
// ---------------------------------------------------------------------------

/**
 * Lo que el dueño cambia sin llamar al desarrollador: la bajada, la portada,
 * la barra de anuncio, el contacto público, los textos de las políticas, los
 * datos de envío y devolución para Google, un par de interruptores de la
 * vidriera y el umbral de stock bajo.
 *
 * **Una columna JSON, a propósito** — lo contrario de `bank_details`. Allá
 * cinco campos obligatorios se validan juntos y una columna que no existe no
 * compila; acá son decenas de preferencias opcionales que van a seguir
 * creciendo, y cada una nueva sería una migración que viaja a todas las
 * tiendas. El contrato de tipos lo pone `StoreSettingsSchema`
 * (`src/domain/store-settings-schema.ts`), donde **todo** campo tiene un
 * default: un JSON viejo, parcial o roto se lee igual, y un ajuste nuevo no
 * necesita migración.
 *
 * `null` en un campo = "usá el de siempre" (`src/config/tienda.ts` o el
 * entorno). Sin fila, la tienda se ve exactamente como antes de que esta
 * tabla existiera.
 */
export const storeSettings = mysqlTable("store_settings", {
  id: tinyint("id").primaryKey(),
  data: json("data").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  /**
   * Quién guardó por última vez. La FK (`ON DELETE SET NULL`) la pone
   * `applySchemaExtras`, igual que las de `*_user_id` de las auditorías.
   */
  updatedByUserId: int("updated_by_user_id"),
});

// ---------------------------------------------------------------------------
// Integraciones — credenciales de terceros editables desde /admin/integraciones
// ---------------------------------------------------------------------------

/**
 * Cloudinary, WhatsApp, Pagopar, la medición y el reporte de errores,
 * cargados por el dueño desde el panel en vez del hPanel (una fila por
 * integración). La lectura y la precedencia —**esta fila > variable de
 * entorno > apagado**— viven en `src/lib/integraciones.ts`; la escritura en
 * `src/lib/integraciones-store.ts`.
 *
 * Dos columnas JSON y no una columna por campo, por lo mismo que
 * `store_settings`: son configuraciones opcionales que van a seguir creciendo
 * (una plantilla de WhatsApp nueva no puede ser una migración que viaja a
 * todas las tiendas).
 *
 * - `data`: los valores **no** secretos, en claro (`cloudName`, `ga4Id`…).
 * - `secrets`: campo → blob `v1.…` de AES-256-GCM (`src/lib/secret-box.ts`),
 *   con una clave derivada de `SESSION_SECRET` que **no está en la base**. Un
 *   backup (que sale de la máquina, a Cloudinary) trae los secretos cifrados
 *   y nada con qué abrirlos.
 *
 * Sin fila, la integración sale del entorno, como siempre.
 */
export const integrationSettings = mysqlTable("integration_settings", {
  /** `cloudinary` | `whatsapp` | `pagopar` | `analitica` | `errores`. */
  integration: varchar("integration", { length: 32 }).primaryKey(),
  data: json("data").notNull(),
  secrets: json("secrets").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  /**
   * Quién guardó por última vez. La FK (`ON DELETE SET NULL`) la pone
   * `applySchemaExtras`, igual que la de `store_settings`.
   */
  updatedByUserId: int("updated_by_user_id"),
});

/**
 * Idempotencia y lock de los trabajos programados (plan-operacion §2, §0.5).
 *
 * Un cron no es "algo que corre una vez por día": es una URL que Hostinger
 * puede reintentar, que un humano dispara a mano para probar, y que dos
 * entradas del hPanel pueden estar llamando sin que nadie se acuerde. Sin
 * esta tabla, el resumen diario le llega tres veces al dueño y dos backups se
 * pisan escribiendo el mismo archivo.
 *
 * La PK es el nombre del trabajo (`resumen_diario`, `backup`): hay una sola
 * fila por trabajo y se reescribe, así que la tabla no crece nunca. No es un
 * historial —para eso está el log— es el estado de "¿se puede correr ahora?".
 *
 * Cómo lo usan los dos casos (`src/domain/job-runs.ts`, O6):
 *
 *  - **una vez por día**: se compara `last_ok_at` contra el día calendario de
 *    Asunción. Se mira el último **éxito** y no el último intento, porque un
 *    intento fallido a las 8:00 tiene que poder reintentarse a las 9:00.
 *  - **lock**: `started_at` sin `finished_at` significa "hay una corrida
 *    viva". Con expiración por tiempo, porque un proceso que muere no libera
 *    nada y un lock eterno es peor que dos backups.
 */
export const jobRuns = mysqlTable("job_runs", {
  /** `resumen_diario` | `backup`. La PK: una fila por trabajo, se reescribe. */
  job: varchar("job", { length: 60 }).primaryKey(),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  /** NULL = corriendo (o muerta a mitad: por eso el lock expira). */
  finishedAt: datetime("finished_at"),
  /** El último éxito. Es lo que decide "ya corrió hoy". */
  lastOkAt: datetime("last_ok_at"),
  /** El motivo del último fallo, recortado. Para el panel y para el log. */
  lastError: varchar("last_error", { length: 500 }),
  /** Lo que produjo la corrida (cantidades, no datos de nadie). */
  payload: json("payload"),
});

/**
 * **Todas** las tablas de este schema, en orden de dependencia (las que no
 * dependen de nadie primero).
 *
 * Existe para el backup de O8, y el orden es lo que la hace útil: restaurar en
 * este orden nunca choca contra una FK, porque cada tabla llega después de
 * aquellas a las que apunta.
 *
 * **Lista explícita y no `SHOW TABLES`**, a propósito. Con `SHOW TABLES` una
 * tabla nueva entraría sola al backup y nadie decidiría nada; el día que
 * alguien agregue una tabla que **no** debe copiarse —o una que sí y hay que
 * ubicar bien en el orden— nada avisaría. Con la lista, hay un test que
 * compara esto contra las tablas declaradas en el archivo y falla si alguien
 * agrega una y se olvida: la decisión se toma una vez, a mano, y queda escrita.
 */
export const operationKeys = mysqlTable(
  "operation_keys",
  {
    id: int("id").autoincrement().primaryKey(),
    scope: varchar("scope", { length: 16 }).notNull(),
    opKey: varchar("op_key", { length: 64 }).notNull(),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    result: json("result"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("operation_keys_scope_key_uq").on(t.scope, t.opKey),
    index("operation_keys_created_idx").on(t.createdAt),
  ]
);

export const notificationOutbox = mysqlTable(
  "notification_outbox",
  {
    id: int("id").primaryKey().autoincrement(),
    eventKey: varchar("event_key", { length: 100 }).notNull(),
    orderId: int("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    kind: mysqlEnum("kind", [
      "confirmado",
      "pagado",
      "enviado",
      "recordatorio",
      "resena",
      "dueno",
    ]).notNull(),
    status: mysqlEnum("status", ORDER_STATUSES).notNull(),
    note: varchar("note", { length: 500 }),
    state: mysqlEnum("state", [
      "pending",
      "sending",
      "sent",
      "failed",
      "unknown",
    ])
      .notNull()
      .default("pending"),
    attempts: tinyint("attempts", { unsigned: true }).notNull().default(0),
    nextAttemptAt: datetime("next_attempt_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    claimedAt: datetime("claimed_at"),
    sentAt: datetime("sent_at"),
    providerMessageId: varchar("provider_message_id", { length: 200 }),
    lastError: varchar("last_error", { length: 200 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    unique("notification_outbox_event_unique").on(table.eventKey),
    index("notification_outbox_due_idx").on(table.state, table.nextAttemptAt),
  ]
);

export const BACKUP_TABLES = [
  "notification_outbox",
  "operation_keys",
  // Sin dependencias.
  "counters",
  "setup_state",
  "job_runs",
  "users",
  "customers",
  "categories",
  "coupons",
  "shipping_zones",
  "shipping_methods",
  "payment_events",
  // Cuelgan de las de arriba.
  "bank_details",
  "store_settings",
  // Los secretos viajan cifrados: la clave sale de SESSION_SECRET, que no
  // está en la base ni en el backup.
  "integration_settings",
  "login_tokens",
  "products",
  "product_images",
  "variants",
  "stock_alerts",
  "price_adjustments",
  "stock_adjustments",
  "orders",
  "order_items",
  "order_events",
  "order_notes",
  // Cuelga de `products` y de `orders`.
  "product_reviews",
  // Devoluciones: la cabecera cuelga de `orders`, las líneas de ella, de
  // `order_items` y de `variants`.
  "order_returns",
  "order_return_items",
  "payments",
  "refunds",
  "receipts",
  "stock_reservations",
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];
