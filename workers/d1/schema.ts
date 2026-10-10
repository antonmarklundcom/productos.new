// Generated from the existing MySQL model for the isolated D1 staging build.
import { sql } from "drizzle-orm";
import { sqliteTable, integer, text, index, uniqueIndex, foreignKey, check } from "drizzle-orm/sqlite-core";
import { utcDate } from "./utc-date";
export * from "../../src/db/enums";
export * from "../../src/lib/roles";
export const SHIPPING_METHOD_KINDS = ["courier","local","retiro"] as const;
export const SHIPPING_METHOD_PRICINGS = ["zona","fijo"] as const;
export const PAYMENT_PROVIDERS = ["spi","cod","pagopar"] as const;
export const PAYMENT_STATUSES = ["pending","paid","failed","refunded"] as const;
export const RECEIPT_REVIEWS = ["pending","approved","rejected"] as const;
export const REVIEW_STATUSES = ["pending","approved","rejected"] as const;
export const INVOICE_STATUSES = ["none","queued","approved","rejected"] as const;
export const RESERVATION_STATES = ["held","consumed","released"] as const;
export const BACKUP_TABLES = ["notification_outbox","operation_keys","counters","setup_state","job_runs","users","customers","categories","coupons","shipping_zones","shipping_methods","payment_events","bank_details","store_settings","integration_settings","login_tokens","products","product_images","variants","supplier_offers","stock_alerts","price_adjustments","stock_adjustments","orders","order_items","order_events","order_notes","product_reviews","order_returns","order_return_items","payments","refunds","receipts","stock_reservations"] as const;
export type ShippingMethodKind = typeof SHIPPING_METHOD_KINDS[number];
export type ShippingMethodPricing = typeof SHIPPING_METHOD_PRICINGS[number];
export type PaymentProvider = typeof PAYMENT_PROVIDERS[number];
export type PaymentStatus = typeof PAYMENT_STATUSES[number];
export type ReceiptReview = typeof RECEIPT_REVIEWS[number];
export type ReviewStatus = typeof REVIEW_STATUSES[number];
export type InvoiceStatus = typeof INVOICE_STATUSES[number];
export type ReservationState = typeof RESERVATION_STATES[number];
export type BackupTable = typeof BACKUP_TABLES[number];

export const bankDetails = sqliteTable("bank_details", {
  id: integer("id").primaryKey(),
  banco: text("banco").notNull(),
  titular: text("titular").notNull(),
  ruc: text("ruc").notNull(),
  cuenta: text("cuenta").notNull(),
  tipoCuenta: text("tipo_cuenta").notNull(),
  qrCloudinaryId: text("qr_cloudinary_id"),
  updatedAt: utcDate("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`).$onUpdate(() => new Date()),
  updatedBy: integer("updated_by"),
}, (t) => [
  foreignKey({ columns: [t.updatedBy], foreignColumns: [users.id] }).onDelete("set null")
]);

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  parentId: integer("parent_id"),
  position: integer("position").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  description: text("description"),
  imageCloudinaryId: text("image_cloudinary_id"),
  imageAlt: text("image_alt"),
  createdAt: utcDate("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => [
  uniqueIndex("categories_slug_uq").on(t.slug),
  index("categories_parent_idx").on(t.parentId)
]);

export const counters = sqliteTable("counters", {
  name: text("name").primaryKey(),
  value: integer("value").notNull().default(0),
}, (t) => [
  check("counters_value_nonnegative", sql`${t.value} >= 0 AND ${t.value} <= 9007199254740991`)
]);

export const coupons = sqliteTable("coupons", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull(),
  type: text("type", { enum: ["porcentaje","monto_fijo"] }).notNull(),
  value: integer("value").notNull(),
  minOrderPyg: integer("min_order_pyg"),
  startsAt: utcDate("starts_at"),
  endsAt: utcDate("ends_at"),
  maxUses: integer("max_uses"),
  maxUsesPerCustomer: integer("max_uses_per_customer"),
  timesUsed: integer("times_used").notNull().default(0),
  soloClientes: integer("solo_clientes", { mode: "boolean" }).notNull().default(false),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: utcDate("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => [
  check("coupons_type_enum", sql`${t.type} IN ('porcentaje','monto_fijo')`),
  check("coupons_value_nonnegative", sql`${t.value} >= 0 AND ${t.value} <= 9007199254740991`),
  check("coupons_min_order_pyg_nonnegative", sql`${t.minOrderPyg} >= 0 AND ${t.minOrderPyg} <= 9007199254740991`),
  check("coupons_max_uses_nonnegative", sql`${t.maxUses} >= 0 AND ${t.maxUses} <= 9007199254740991`),
  check("coupons_max_uses_per_customer_nonnegative", sql`${t.maxUsesPerCustomer} >= 0 AND ${t.maxUsesPerCustomer} <= 9007199254740991`),
  check("coupons_times_used_nonnegative", sql`${t.timesUsed} >= 0 AND ${t.timesUsed} <= 9007199254740991`),
  uniqueIndex("coupons_code_uq").on(t.code),
  index("coupons_active_idx").on(t.isActive)
]);

export const customers = sqliteTable("customers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  phone: text("phone").notNull(),
  email: text("email"),
  passwordHash: text("password_hash"),
  name: text("name").notNull(),
  marketingOptIn: integer("marketing_opt_in", { mode: "boolean" }),
  marketingOptInAt: utcDate("marketing_opt_in_at"),
  phoneVerifiedAt: utcDate("phone_verified_at"),
  sessionVersion: integer("session_version").notNull().default(1),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: utcDate("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  lastLoginAt: utcDate("last_login_at"),
}, (t) => [
  check("customers_session_version_nonnegative", sql`${t.sessionVersion} >= 0 AND ${t.sessionVersion} <= 9007199254740991`),
  uniqueIndex("customers_phone_uq").on(t.phone),
  uniqueIndex("customers_email_uq").on(t.email)
]);

export const integrationSettings = sqliteTable("integration_settings", {
  integration: text("integration").primaryKey(),
  data: text("data", { mode: "json" }).$type<unknown>().notNull(),
  secrets: text("secrets", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: utcDate("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`).$onUpdate(() => new Date()),
  updatedByUserId: integer("updated_by_user_id"),
});

export const jobRuns = sqliteTable("job_runs", {
  job: text("job").primaryKey(),
  startedAt: utcDate("started_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  finishedAt: utcDate("finished_at"),
  lastOkAt: utcDate("last_ok_at"),
  lastError: text("last_error"),
  payload: text("payload", { mode: "json" }).$type<unknown>(),
});

export const loginTokens = sqliteTable("login_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customerId: integer("customer_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  channel: text("channel").notNull(),
  expiresAt: utcDate("expires_at").notNull(),
  consumedAt: utcDate("consumed_at"),
  invalidatedAt: utcDate("invalidated_at"),
  createdAt: utcDate("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => [
  check("login_tokens_attempts_nonnegative", sql`${t.attempts} >= 0 AND ${t.attempts} <= 9007199254740991`),
  index("login_tokens_customer_idx").on(t.customerId, t.createdAt)
]);

export const notificationOutbox = sqliteTable("notification_outbox", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventKey: text("event_key").notNull(),
  orderId: integer("order_id").notNull(),
  kind: text("kind", { enum: ["confirmado","pagado","enviado","recordatorio","resena","dueno"] }).notNull(),
  status: text("status", { enum: ["pendiente_pago","esperando_verificacion","pagado","preparando","enviado","entregado","rechazado","vencido","cancelado","reembolsado"] }).notNull(),
  note: text("note"),
  state: text("state", { enum: ["pending","sending","sent","failed","unknown"] }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: utcDate("next_attempt_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  claimedAt: utcDate("claimed_at"),
  sentAt: utcDate("sent_at"),
  providerMessageId: text("provider_message_id"),
  lastError: text("last_error"),
  createdAt: utcDate("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => [
  check("notification_outbox_kind_enum", sql`${t.kind} IN ('confirmado','pagado','enviado','recordatorio','resena','dueno')`),
  check("notification_outbox_status_enum", sql`${t.status} IN ('pendiente_pago','esperando_verificacion','pagado','preparando','enviado','entregado','rechazado','vencido','cancelado','reembolsado')`),
  check("notification_outbox_state_enum", sql`${t.state} IN ('pending','sending','sent','failed','unknown')`),
  check("notification_outbox_attempts_nonnegative", sql`${t.attempts} >= 0 AND ${t.attempts} <= 9007199254740991`),
  uniqueIndex("notification_outbox_event_unique").on(t.eventKey),
  index("notification_outbox_due_idx").on(t.state, t.nextAttemptAt),
  foreignKey({ columns: [t.orderId], foreignColumns: [orders.id] }).onDelete("cascade")
]);

export const operationKeys = sqliteTable("operation_keys", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scope: text("scope").notNull(),
  opKey: text("op_key").notNull(),
  fingerprint: text("fingerprint").notNull(),
  result: text("result", { mode: "json" }).$type<unknown>(),
  createdAt: utcDate("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => [
  uniqueIndex("operation_keys_scope_key_uq").on(t.scope, t.opKey),
  index("operation_keys_created_idx").on(t.createdAt)
]);

export const orderEvents = sqliteTable("order_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull(),
  fromStatus: text("from_status", { enum: ["pendiente_pago","esperando_verificacion","pagado","preparando","enviado","entregado","rechazado","vencido","cancelado","reembolsado"] }),
  toStatus: text("to_status", { enum: ["pendiente_pago","esperando_verificacion","pagado","preparando","enviado","entregado","rechazado","vencido","cancelado","reembolsado"] }).notNull(),
  actor: text("actor").notNull(),
  actorUserId: integer("actor_user_id"),
  reason: text("reason"),
  createdAt: utcDate("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => [
  check("order_events_from_status_enum", sql`${t.fromStatus} IN ('pendiente_pago','esperando_verificacion','pagado','preparando','enviado','entregado','rechazado','vencido','cancelado','reembolsado')`),
  check("order_events_to_status_enum", sql`${t.toStatus} IN ('pendiente_pago','esperando_verificacion','pagado','preparando','enviado','entregado','rechazado','vencido','cancelado','reembolsado')`),
  index("order_events_order_idx").on(t.orderId, t.createdAt),
  index("order_events_actor_idx").on(t.actorUserId, t.createdAt),
  foreignKey({ columns: [t.orderId], foreignColumns: [orders.id] }).onDelete("cascade").onUpdate("cascade")
]);

export const orderItems = sqliteTable("order_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull(),
  variantId: integer("variant_id").notNull(),
  nameSnapshot: text("name_snapshot").notNull(),
  skuSnapshot: text("sku_snapshot").notNull(),
  unitPricePyg: integer("unit_price_pyg").notNull(),
  qty: integer("qty").notNull(),
  ivaRate: integer("iva_rate").notNull(),
  lineTotalPyg: integer("line_total_pyg").notNull(),
}, (t) => [
  check("order_items_unit_price_pyg_nonnegative", sql`${t.unitPricePyg} >= 0 AND ${t.unitPricePyg} <= 9007199254740991`),
  check("order_items_qty_nonnegative", sql`${t.qty} >= 0 AND ${t.qty} <= 9007199254740991`),
  check("order_items_line_total_pyg_nonnegative", sql`${t.lineTotalPyg} >= 0 AND ${t.lineTotalPyg} <= 9007199254740991`),
  index("order_items_order_idx").on(t.orderId),
  index("order_items_variant_idx").on(t.variantId),
  foreignKey({ columns: [t.orderId], foreignColumns: [orders.id] }).onDelete("cascade").onUpdate("cascade"),
  foreignKey({ columns: [t.variantId], foreignColumns: [variants.id] }).onDelete("restrict").onUpdate("cascade")
]);

export const orderNotes = sqliteTable("order_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull(),
  body: text("body").notNull(),
  actor: text("actor").notNull(),
  actorUserId: integer("actor_user_id"),
  createdAt: utcDate("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => [
  index("order_notes_order_idx").on(t.orderId, t.createdAt),
  foreignKey({ columns: [t.orderId], foreignColumns: [orders.id] }).onDelete("cascade").onUpdate("cascade")
]);

export const orderReturnItems = sqliteTable("order_return_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  returnId: integer("return_id").notNull(),
  orderItemId: integer("order_item_id").notNull(),
  variantId: integer("variant_id").notNull(),
  qty: integer("qty").notNull(),
  restocked: integer("restocked", { mode: "boolean" }).notNull(),
}, (t) => [
  check("order_return_items_qty_nonnegative", sql`${t.qty} >= 0 AND ${t.qty} <= 9007199254740991`),
  index("order_return_items_return_idx").on(t.returnId),
  index("order_return_items_order_item_idx").on(t.orderItemId),
  foreignKey({ columns: [t.returnId], foreignColumns: [orderReturns.id] }).onDelete("cascade").onUpdate("cascade"),
  foreignKey({ columns: [t.orderItemId], foreignColumns: [orderItems.id] }).onDelete("cascade").onUpdate("cascade"),
  foreignKey({ columns: [t.variantId], foreignColumns: [variants.id] }).onDelete("restrict").onUpdate("cascade")
]);

export const orderReturns = sqliteTable("order_returns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull(),
  reason: text("reason").notNull(),
  actor: text("actor").notNull(),
  actorUserId: integer("actor_user_id"),
  createdAt: utcDate("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => [
  index("order_returns_order_idx").on(t.orderId),
  index("order_returns_created_idx").on(t.createdAt),
  foreignKey({ columns: [t.orderId], foreignColumns: [orders.id] }).onDelete("cascade").onUpdate("cascade")
]);

export const orders = sqliteTable("orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderNumber: text("order_number").notNull(),
  accessToken: text("access_token").notNull(),
  status: text("status", { enum: ["pendiente_pago","esperando_verificacion","pagado","preparando","enviado","entregado","rechazado","vencido","cancelado","reembolsado"] }).notNull().default("pendiente_pago"),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull(),
  customerEmail: text("customer_email"),
  docType: text("doc_type", { enum: ["RUC","CI","NINGUNO"] }).notNull().default("NINGUNO"),
  docNumber: text("doc_number"),
  isConsumidorFinal: integer("is_consumidor_final", { mode: "boolean" }).notNull().default(true),
  shipCity: text("ship_city").notNull(),
  shipBarrio: text("ship_barrio"),
  shipAddress: text("ship_address").notNull(),
  shipReference: text("ship_reference"),
  shipMapsUrl: text("ship_maps_url"),
  shippingZoneId: integer("shipping_zone_id"),
  shippingMethodId: integer("shipping_method_id"),
  shippingMethodName: text("shipping_method_name"),
  subtotalPyg: integer("subtotal_pyg").notNull().default(0),
  shippingPyg: integer("shipping_pyg").notNull().default(0),
  totalPyg: integer("total_pyg").notNull().default(0),
  iva10Pyg: integer("iva_10_pyg").notNull().default(0),
  iva5Pyg: integer("iva_5_pyg").notNull().default(0),
  paymentMethod: text("payment_method", { enum: ["transferencia","contra_entrega","tarjeta"] }).notNull(),
  cardCheckoutState: text("card_checkout_state", { enum: ["idle","starting","ready","unknown"] }).notNull().default("idle"),
  reservedUntil: utcDate("reserved_until"),
  paymentReminderSentAt: utcDate("payment_reminder_sent_at"),
  marketingOptIn: integer("marketing_opt_in", { mode: "boolean" }),
  marketingOptInAt: utcDate("marketing_opt_in_at"),
  isGift: integer("is_gift", { mode: "boolean" }).notNull().default(false),
  giftNote: text("gift_note"),
  invoiceStatus: text("invoice_status", { enum: ["none","queued","approved","rejected"] }).notNull().default("none"),
  invoiceCdc: text("invoice_cdc"),
  invoicePdfUrl: text("invoice_pdf_url"),
  couponId: integer("coupon_id"),
  couponCode: text("coupon_code"),
  discountPyg: integer("discount_pyg").notNull().default(0),
  customerId: integer("customer_id"),
  trackingCarrier: text("tracking_carrier"),
  trackingCode: text("tracking_code"),
  trackingUrl: text("tracking_url"),
  createdAt: utcDate("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: utcDate("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`).$onUpdate(() => new Date()),
  paidAt: utcDate("paid_at"),
}, (t) => [
  check("orders_status_enum", sql`${t.status} IN ('pendiente_pago','esperando_verificacion','pagado','preparando','enviado','entregado','rechazado','vencido','cancelado','reembolsado')`),
  check("orders_doc_type_enum", sql`${t.docType} IN ('RUC','CI','NINGUNO')`),
  check("orders_subtotal_pyg_nonnegative", sql`${t.subtotalPyg} >= 0 AND ${t.subtotalPyg} <= 9007199254740991`),
  check("orders_shipping_pyg_nonnegative", sql`${t.shippingPyg} >= 0 AND ${t.shippingPyg} <= 9007199254740991`),
  check("orders_total_pyg_nonnegative", sql`${t.totalPyg} >= 0 AND ${t.totalPyg} <= 9007199254740991`),
  check("orders_iva_10_pyg_nonnegative", sql`${t.iva10Pyg} >= 0 AND ${t.iva10Pyg} <= 9007199254740991`),
  check("orders_iva_5_pyg_nonnegative", sql`${t.iva5Pyg} >= 0 AND ${t.iva5Pyg} <= 9007199254740991`),
  check("orders_payment_method_enum", sql`${t.paymentMethod} IN ('transferencia','contra_entrega','tarjeta')`),
  check("orders_card_checkout_state_enum", sql`${t.cardCheckoutState} IN ('idle','starting','ready','unknown')`),
  check("orders_invoice_status_enum", sql`${t.invoiceStatus} IN ('none','queued','approved','rejected')`),
  check("orders_discount_pyg_nonnegative", sql`${t.discountPyg} >= 0 AND ${t.discountPyg} <= 9007199254740991`),
  uniqueIndex("orders_number_uq").on(t.orderNumber),
  uniqueIndex("orders_access_token_uq").on(t.accessToken),
  index("orders_customer_idx").on(t.customerId),
  index("orders_coupon_idx").on(t.couponId),
  index("orders_shipping_method_idx").on(t.shippingMethodId),
  index("orders_status_created_idx").on(t.status, t.createdAt),
  index("orders_phone_idx").on(t.customerPhone),
  index("orders_doc_number_idx").on(t.docNumber),
  index("orders_reserved_until_idx").on(t.reservedUntil)
]);

export const paymentEvents = sqliteTable("payment_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider", { enum: ["spi","cod","pagopar"] }).notNull(),
  eventKey: text("event_key").notNull(),
  payload: text("payload", { mode: "json" }).$type<unknown>(),
  receivedAt: utcDate("received_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => [
  check("payment_events_provider_enum", sql`${t.provider} IN ('spi','cod','pagopar')`),
  uniqueIndex("payment_events_key_uq").on(t.provider, t.eventKey)
]);

export const payments = sqliteTable("payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull(),
  provider: text("provider", { enum: ["spi","cod","pagopar"] }).notNull(),
  providerRef: text("provider_ref").notNull(),
  amountPyg: integer("amount_pyg").notNull(),
  status: text("status", { enum: ["pending","paid","failed","refunded"] }).notNull().default("pending"),
  refundedPyg: integer("refunded_pyg").notNull().default(0),
  rawPayload: text("raw_payload", { mode: "json" }).$type<unknown>(),
  createdAt: utcDate("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: utcDate("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`).$onUpdate(() => new Date()),
}, (t) => [
  check("payments_provider_enum", sql`${t.provider} IN ('spi','cod','pagopar')`),
  check("payments_amount_pyg_nonnegative", sql`${t.amountPyg} >= 0 AND ${t.amountPyg} <= 9007199254740991`),
  check("payments_status_enum", sql`${t.status} IN ('pending','paid','failed','refunded')`),
  check("payments_refunded_pyg_nonnegative", sql`${t.refundedPyg} >= 0 AND ${t.refundedPyg} <= 9007199254740991`),
  uniqueIndex("payments_provider_ref_uq").on(t.provider, t.providerRef),
  index("payments_order_idx").on(t.orderId),
  foreignKey({ columns: [t.orderId], foreignColumns: [orders.id] }).onDelete("cascade").onUpdate("cascade")
]);

export const priceAdjustments = sqliteTable("price_adjustments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  variantId: integer("variant_id").notNull(),
  fromPyg: integer("from_pyg").notNull(),
  toPyg: integer("to_pyg").notNull(),
  reason: text("reason").notNull(),
  actor: text("actor").notNull(),
  actorUserId: integer("actor_user_id"),
  createdAt: utcDate("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => [
  check("price_adjustments_from_pyg_nonnegative", sql`${t.fromPyg} >= 0 AND ${t.fromPyg} <= 9007199254740991`),
  check("price_adjustments_to_pyg_nonnegative", sql`${t.toPyg} >= 0 AND ${t.toPyg} <= 9007199254740991`),
  index("price_adjustments_variant_idx").on(t.variantId, t.createdAt),
  foreignKey({ columns: [t.variantId], foreignColumns: [variants.id] }).onDelete("cascade").onUpdate("cascade")
]);

export const productImages = sqliteTable("product_images", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productId: integer("product_id").notNull(),
  cloudinaryId: text("cloudinary_id").notNull(),
  blurDataUrl: text("blur_data_url"),
  alt: text("alt"),
  position: integer("position").notNull().default(0),
}, (t) => [
  index("product_images_product_idx").on(t.productId, t.position),
  foreignKey({ columns: [t.productId], foreignColumns: [products.id] }).onDelete("cascade").onUpdate("cascade")
]);

export const productReviews = sqliteTable("product_reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productId: integer("product_id").notNull(),
  orderId: integer("order_id").notNull(),
  rating: integer("rating").notNull(),
  title: text("title"),
  body: text("body").notNull(),
  authorName: text("author_name").notNull(),
  status: text("status", { enum: ["pending","approved","rejected"] }).notNull().default("pending"),
  ownerReply: text("owner_reply"),
  ownerReplyAt: utcDate("owner_reply_at"),
  moderatedAt: utcDate("moderated_at"),
  moderatedByUserId: integer("moderated_by_user_id"),
  createdAt: utcDate("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => [
  check("product_reviews_rating_nonnegative", sql`${t.rating} >= 0 AND ${t.rating} <= 9007199254740991`),
  check("product_reviews_status_enum", sql`${t.status} IN ('pending','approved','rejected')`),
  uniqueIndex("product_reviews_order_product_uq").on(t.orderId, t.productId),
  index("product_reviews_product_status_idx").on(t.productId, t.status, t.createdAt),
  foreignKey({ columns: [t.productId], foreignColumns: [products.id] }).onDelete("cascade").onUpdate("cascade"),
  foreignKey({ columns: [t.orderId], foreignColumns: [orders.id] }).onDelete("cascade").onUpdate("cascade")
]);

export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  saleMode: text("sale_mode", { enum: ["stock","enquiry","showcase"] }).notNull().default("stock"),
  showPrice: integer("show_price", { mode: "boolean" }).notNull().default(true),
  description: text("description"),
  categoryId: integer("category_id").notNull(),
  brand: text("brand"),
  dropiUrl: text("dropi_url"),
  ivaRate: integer("iva_rate").notNull().default(10),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  isFeatured: integer("is_featured", { mode: "boolean" }).notNull().default(false),
  publishedAt: utcDate("published_at"),
  createdAt: utcDate("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: utcDate("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`).$onUpdate(() => new Date()),
}, (t) => [
  check("products_sale_mode_enum", sql`${t.saleMode} IN ('stock','enquiry','showcase')`),
  uniqueIndex("products_slug_uq").on(t.slug),
  index("products_category_idx").on(t.categoryId),
  index("products_active_published_idx").on(t.isActive, t.publishedAt),
  index("products_featured_idx").on(t.isFeatured, t.publishedAt),
  foreignKey({ columns: [t.categoryId], foreignColumns: [categories.id] }).onDelete("restrict").onUpdate("cascade")
]);

export const receipts = sqliteTable("receipts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull(),
  cloudinaryId: text("cloudinary_id").notNull(),
  mime: text("mime").notNull(),
  bytes: integer("bytes").notNull(),
  uploadedAt: utcDate("uploaded_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  review: text("review", { enum: ["pending","approved","rejected"] }).notNull().default("pending"),
  reviewedBy: integer("reviewed_by"),
  reviewedAt: utcDate("reviewed_at"),
  note: text("note"),
}, (t) => [
  check("receipts_bytes_nonnegative", sql`${t.bytes} >= 0 AND ${t.bytes} <= 9007199254740991`),
  check("receipts_review_enum", sql`${t.review} IN ('pending','approved','rejected')`),
  index("receipts_order_idx").on(t.orderId),
  index("receipts_review_idx").on(t.review),
  foreignKey({ columns: [t.orderId], foreignColumns: [orders.id] }).onDelete("cascade").onUpdate("cascade")
]);

export const refunds = sqliteTable("refunds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  paymentId: integer("payment_id").notNull(),
  amountPyg: integer("amount_pyg").notNull(),
  reason: text("reason").notNull(),
  actor: text("actor").notNull(),
  actorUserId: integer("actor_user_id"),
  createdAt: utcDate("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => [
  check("refunds_amount_pyg_nonnegative", sql`${t.amountPyg} >= 0 AND ${t.amountPyg} <= 9007199254740991`),
  index("refunds_payment_idx").on(t.paymentId),
  foreignKey({ columns: [t.paymentId], foreignColumns: [payments.id] }).onDelete("cascade").onUpdate("cascade")
]);

export const setupState = sqliteTable("setup_state", {
  id: integer("id").primaryKey(),
  migratedAt: utcDate("migrated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  seededAt: utcDate("seeded_at"),
  ownerAt: utcDate("owner_at"),
  runs: integer("runs").notNull().default(1),
});

export const shippingMethods = sqliteTable("shipping_methods", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["courier","local","retiro"] }).notNull().default("courier"),
  pricing: text("pricing", { enum: ["zona","fijo"] }).notNull().default("zona"),
  fixedPricePyg: integer("fixed_price_pyg"),
  zoneIds: text("zone_ids", { mode: "json" }).$type<number[]>().notNull(),
  allowedPaymentMethods: text("allowed_payment_methods", { mode: "json" }).$type<string[]>().notNull(),
  description: text("description"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  position: integer("position").notNull().default(0),
}, (t) => [
  check("shipping_methods_kind_enum", sql`${t.kind} IN ('courier','local','retiro')`),
  check("shipping_methods_pricing_enum", sql`${t.pricing} IN ('zona','fijo')`),
  check("shipping_methods_fixed_price_pyg_nonnegative", sql`${t.fixedPricePyg} >= 0 AND ${t.fixedPricePyg} <= 9007199254740991`),
  uniqueIndex("shipping_methods_slug_uq").on(t.slug)
]);

export const shippingZones = sqliteTable("shipping_zones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  cities: text("cities", { mode: "json" }).$type<string[]>().notNull(),
  pricePyg: integer("price_pyg").notNull(),
  freeThresholdPyg: integer("free_threshold_pyg"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  position: integer("position").notNull().default(0),
}, (t) => [
  check("shipping_zones_price_pyg_nonnegative", sql`${t.pricePyg} >= 0 AND ${t.pricePyg} <= 9007199254740991`),
  check("shipping_zones_free_threshold_pyg_nonnegative", sql`${t.freeThresholdPyg} >= 0 AND ${t.freeThresholdPyg} <= 9007199254740991`),
  uniqueIndex("shipping_zones_slug_uq").on(t.slug)
]);

export const stockAdjustments = sqliteTable("stock_adjustments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  variantId: integer("variant_id").notNull(),
  delta: integer("delta").notNull(),
  previousOnHand: integer("previous_on_hand").notNull(),
  newOnHand: integer("new_on_hand").notNull(),
  reason: text("reason").notNull(),
  actor: text("actor").notNull(),
  actorUserId: integer("actor_user_id"),
  createdAt: utcDate("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => [
  check("stock_adjustments_previous_on_hand_nonnegative", sql`${t.previousOnHand} >= 0 AND ${t.previousOnHand} <= 9007199254740991`),
  check("stock_adjustments_new_on_hand_nonnegative", sql`${t.newOnHand} >= 0 AND ${t.newOnHand} <= 9007199254740991`),
  index("stock_adjustments_variant_idx").on(t.variantId, t.createdAt),
  index("stock_adjustments_actor_idx").on(t.actorUserId, t.createdAt),
  foreignKey({ columns: [t.variantId], foreignColumns: [variants.id] }).onDelete("restrict").onUpdate("cascade")
]);

export const stockAlerts = sqliteTable("stock_alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  variantId: integer("variant_id").notNull(),
  phone: text("phone").notNull(),
  createdAt: utcDate("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  notifiedAt: utcDate("notified_at"),
}, (t) => [
  uniqueIndex("stock_alerts_variant_phone_uq").on(t.variantId, t.phone),
  index("stock_alerts_pending_idx").on(t.variantId, t.notifiedAt),
  foreignKey({ columns: [t.variantId], foreignColumns: [variants.id] }).onDelete("cascade").onUpdate("cascade")
]);

export const stockReservations = sqliteTable("stock_reservations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  variantId: integer("variant_id").notNull(),
  orderId: integer("order_id").notNull(),
  qty: integer("qty").notNull(),
  expiresAt: utcDate("expires_at").notNull(),
  state: text("state", { enum: ["held","consumed","released"] }).notNull().default("held"),
  createdAt: utcDate("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => [
  check("stock_reservations_qty_nonnegative", sql`${t.qty} >= 0 AND ${t.qty} <= 9007199254740991`),
  check("stock_reservations_state_enum", sql`${t.state} IN ('held','consumed','released')`),
  index("stock_reservations_availability_idx").on(t.variantId, t.state, t.expiresAt),
  index("stock_reservations_order_idx").on(t.orderId),
  foreignKey({ columns: [t.variantId], foreignColumns: [variants.id] }).onDelete("restrict").onUpdate("cascade"),
  foreignKey({ columns: [t.orderId], foreignColumns: [orders.id] }).onDelete("cascade").onUpdate("cascade")
]);

export const storeSettings = sqliteTable("store_settings", {
  id: integer("id").primaryKey(),
  data: text("data", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: utcDate("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`).$onUpdate(() => new Date()),
  updatedByUserId: integer("updated_by_user_id"),
});

export const supplierOffers = sqliteTable("supplier_offers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  variantId: integer("variant_id").notNull(),
  unitCostPyg: integer("unit_cost_pyg"),
  source: text("source"),
  sourceType: text("source_type", { enum: ["dropi","local","import","other"] }).notNull().default("other"),
  productUrl: text("product_url"),
  supplierUrl: text("supplier_url"),
  supplierStock: integer("supplier_stock"),
  notes: text("notes"),
  isConfirmed: integer("is_confirmed", { mode: "boolean" }).notNull().default(false),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  isPreferred: integer("is_preferred", { mode: "boolean" }).notNull().default(false),
  checkedAt: utcDate("checked_at"),
  updatedAt: utcDate("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`).$onUpdate(() => new Date()),
}, (t) => [
  check("supplier_offers_unit_cost_pyg_nonnegative", sql`${t.unitCostPyg} >= 0 AND ${t.unitCostPyg} <= 9007199254740991`),
  check("supplier_offers_source_type_enum", sql`${t.sourceType} IN ('dropi','local','import','other')`),
  check("supplier_offers_supplier_stock_nonnegative", sql`${t.supplierStock} >= 0 AND ${t.supplierStock} <= 9007199254740991`),
  uniqueIndex("supplier_offers_one_preferred").on(t.variantId).where(sql`${t.isPreferred}=1`),
  check("supplier_preferred_valid", sql`${t.isPreferred}=0 OR (${t.isConfirmed}=1 AND ${t.isActive}=1 AND ${t.unitCostPyg} IS NOT NULL)`),
  index("supplier_offers_variant_idx").on(t.variantId),
  foreignKey({ columns: [t.variantId], foreignColumns: [variants.id] }).onDelete("cascade").onUpdate("cascade")
]);

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  role: text("role", { enum: ["owner","staff","vendedor"] }).notNull().default("staff"),
  sessionVersion: integer("session_version").notNull().default(1),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: utcDate("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  lastLoginAt: utcDate("last_login_at"),
}, (t) => [
  check("users_role_enum", sql`${t.role} IN ('owner','staff','vendedor')`),
  check("users_session_version_nonnegative", sql`${t.sessionVersion} >= 0 AND ${t.sessionVersion} <= 9007199254740991`),
  uniqueIndex("users_email_uq").on(t.email)
]);

export const variants = sqliteTable("variants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productId: integer("product_id").notNull(),
  sku: text("sku").notNull(),
  label: text("label").notNull(),
  pricePyg: integer("price_pyg").notNull(),
  compareAtPyg: integer("compare_at_pyg"),
  onHand: integer("on_hand").notNull().default(0),
  reorderPoint: integer("reorder_point"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  position: integer("position").notNull().default(0),
}, (t) => [
  check("variants_price_pyg_nonnegative", sql`${t.pricePyg} >= 0 AND ${t.pricePyg} <= 9007199254740991`),
  check("variants_compare_at_pyg_nonnegative", sql`${t.compareAtPyg} >= 0 AND ${t.compareAtPyg} <= 9007199254740991`),
  check("variants_on_hand_nonnegative", sql`${t.onHand} >= 0 AND ${t.onHand} <= 9007199254740991`),
  check("variants_reorder_point_nonnegative", sql`${t.reorderPoint} >= 0 AND ${t.reorderPoint} <= 9007199254740991`),
  uniqueIndex("variants_sku_uq").on(t.sku),
  index("variants_product_idx").on(t.productId),
  foreignKey({ columns: [t.productId], foreignColumns: [products.id] }).onDelete("cascade").onUpdate("cascade")
]);

export const workersLoginLimits = sqliteTable("workers_login_limits", {
  key: text("key").primaryKey(), starts: integer("starts").notNull(), hits: integer("hits").notNull()
});

// Only digests are persisted. Consuming a reset increments users.sessionVersion.
export const adminPasswordResets = sqliteTable("workers_admin_password_resets", {
  digest: text("digest").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionVersion: integer("session_version").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (t) => [index("workers_admin_password_resets_user_idx").on(t.userId), index("workers_admin_password_resets_expiry_idx").on(t.expiresAt)]);
