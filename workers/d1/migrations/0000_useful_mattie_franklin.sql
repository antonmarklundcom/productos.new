CREATE TABLE `bank_details` (
	`id` integer PRIMARY KEY NOT NULL,
	`banco` text NOT NULL,
	`titular` text NOT NULL,
	`ruc` text NOT NULL,
	`cuenta` text NOT NULL,
	`tipo_cuenta` text NOT NULL,
	`qr_cloudinary_id` text,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_by` integer,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`parent_id` integer,
	`position` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`description` text,
	`image_cloudinary_id` text,
	`image_alt` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_uq` ON `categories` (`slug`);--> statement-breakpoint
CREATE INDEX `categories_parent_idx` ON `categories` (`parent_id`);--> statement-breakpoint
CREATE TABLE `counters` (
	`name` text PRIMARY KEY NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "counters_value_nonnegative" CHECK("counters"."value" >= 0 AND "counters"."value" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE `coupons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`type` text NOT NULL,
	`value` integer NOT NULL,
	`min_order_pyg` integer,
	`starts_at` text,
	`ends_at` text,
	`max_uses` integer,
	`max_uses_per_customer` integer,
	`times_used` integer DEFAULT 0 NOT NULL,
	`solo_clientes` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT "coupons_type_enum" CHECK("coupons"."type" IN ('porcentaje','monto_fijo')),
	CONSTRAINT "coupons_value_nonnegative" CHECK("coupons"."value" >= 0 AND "coupons"."value" <= 9007199254740991),
	CONSTRAINT "coupons_min_order_pyg_nonnegative" CHECK("coupons"."min_order_pyg" >= 0 AND "coupons"."min_order_pyg" <= 9007199254740991),
	CONSTRAINT "coupons_max_uses_nonnegative" CHECK("coupons"."max_uses" >= 0 AND "coupons"."max_uses" <= 9007199254740991),
	CONSTRAINT "coupons_max_uses_per_customer_nonnegative" CHECK("coupons"."max_uses_per_customer" >= 0 AND "coupons"."max_uses_per_customer" <= 9007199254740991),
	CONSTRAINT "coupons_times_used_nonnegative" CHECK("coupons"."times_used" >= 0 AND "coupons"."times_used" <= 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coupons_code_uq` ON `coupons` (`code`);--> statement-breakpoint
CREATE INDEX `coupons_active_idx` ON `coupons` (`is_active`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`phone` text NOT NULL,
	`email` text,
	`password_hash` text,
	`name` text NOT NULL,
	`marketing_opt_in` integer,
	`marketing_opt_in_at` text,
	`phone_verified_at` text,
	`session_version` integer DEFAULT 1 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`last_login_at` text,
	CONSTRAINT "customers_session_version_nonnegative" CHECK("customers"."session_version" >= 0 AND "customers"."session_version" <= 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_phone_uq` ON `customers` (`phone`);--> statement-breakpoint
CREATE UNIQUE INDEX `customers_email_uq` ON `customers` (`email`);--> statement-breakpoint
CREATE TABLE `integration_settings` (
	`integration` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`secrets` text NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_by_user_id` integer
);
--> statement-breakpoint
CREATE TABLE `job_runs` (
	`job` text PRIMARY KEY NOT NULL,
	`started_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`finished_at` text,
	`last_ok_at` text,
	`last_error` text,
	`payload` text
);
--> statement-breakpoint
CREATE TABLE `login_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`channel` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`invalidated_at` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT "login_tokens_attempts_nonnegative" CHECK("login_tokens"."attempts" >= 0 AND "login_tokens"."attempts" <= 9007199254740991)
);
--> statement-breakpoint
CREATE INDEX `login_tokens_customer_idx` ON `login_tokens` (`customer_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `notification_outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_key` text NOT NULL,
	`order_id` integer NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`note` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`claimed_at` text,
	`sent_at` text,
	`provider_message_id` text,
	`last_error` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_outbox_kind_enum" CHECK("notification_outbox"."kind" IN ('confirmado','pagado','enviado','recordatorio','resena','dueno')),
	CONSTRAINT "notification_outbox_status_enum" CHECK("notification_outbox"."status" IN ('pendiente_pago','esperando_verificacion','pagado','preparando','enviado','entregado','rechazado','vencido','cancelado','reembolsado')),
	CONSTRAINT "notification_outbox_state_enum" CHECK("notification_outbox"."state" IN ('pending','sending','sent','failed','unknown')),
	CONSTRAINT "notification_outbox_attempts_nonnegative" CHECK("notification_outbox"."attempts" >= 0 AND "notification_outbox"."attempts" <= 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_outbox_event_unique` ON `notification_outbox` (`event_key`);--> statement-breakpoint
CREATE INDEX `notification_outbox_due_idx` ON `notification_outbox` (`state`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `operation_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope` text NOT NULL,
	`op_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`result` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_keys_scope_key_uq` ON `operation_keys` (`scope`,`op_key`);--> statement-breakpoint
CREATE INDEX `operation_keys_created_idx` ON `operation_keys` (`created_at`);--> statement-breakpoint
CREATE TABLE `order_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`actor` text NOT NULL,
	`actor_user_id` integer,
	`reason` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "order_events_from_status_enum" CHECK("order_events"."from_status" IN ('pendiente_pago','esperando_verificacion','pagado','preparando','enviado','entregado','rechazado','vencido','cancelado','reembolsado')),
	CONSTRAINT "order_events_to_status_enum" CHECK("order_events"."to_status" IN ('pendiente_pago','esperando_verificacion','pagado','preparando','enviado','entregado','rechazado','vencido','cancelado','reembolsado'))
);
--> statement-breakpoint
CREATE INDEX `order_events_order_idx` ON `order_events` (`order_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `order_events_actor_idx` ON `order_events` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`variant_id` integer NOT NULL,
	`name_snapshot` text NOT NULL,
	`sku_snapshot` text NOT NULL,
	`unit_price_pyg` integer NOT NULL,
	`qty` integer NOT NULL,
	`iva_rate` integer NOT NULL,
	`line_total_pyg` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "order_items_unit_price_pyg_nonnegative" CHECK("order_items"."unit_price_pyg" >= 0 AND "order_items"."unit_price_pyg" <= 9007199254740991),
	CONSTRAINT "order_items_qty_nonnegative" CHECK("order_items"."qty" >= 0 AND "order_items"."qty" <= 9007199254740991),
	CONSTRAINT "order_items_line_total_pyg_nonnegative" CHECK("order_items"."line_total_pyg" >= 0 AND "order_items"."line_total_pyg" <= 9007199254740991)
);
--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_items_variant_idx` ON `order_items` (`variant_id`);--> statement-breakpoint
CREATE TABLE `order_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`body` text NOT NULL,
	`actor` text NOT NULL,
	`actor_user_id` integer,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `order_notes_order_idx` ON `order_notes` (`order_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `order_return_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`return_id` integer NOT NULL,
	`order_item_id` integer NOT NULL,
	`variant_id` integer NOT NULL,
	`qty` integer NOT NULL,
	`restocked` integer NOT NULL,
	FOREIGN KEY (`return_id`) REFERENCES `order_returns`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "order_return_items_qty_nonnegative" CHECK("order_return_items"."qty" >= 0 AND "order_return_items"."qty" <= 9007199254740991)
);
--> statement-breakpoint
CREATE INDEX `order_return_items_return_idx` ON `order_return_items` (`return_id`);--> statement-breakpoint
CREATE INDEX `order_return_items_order_item_idx` ON `order_return_items` (`order_item_id`);--> statement-breakpoint
CREATE TABLE `order_returns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`reason` text NOT NULL,
	`actor` text NOT NULL,
	`actor_user_id` integer,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `order_returns_order_idx` ON `order_returns` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_returns_created_idx` ON `order_returns` (`created_at`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_number` text NOT NULL,
	`access_token` text NOT NULL,
	`status` text DEFAULT 'pendiente_pago' NOT NULL,
	`customer_name` text NOT NULL,
	`customer_phone` text NOT NULL,
	`customer_email` text,
	`doc_type` text DEFAULT 'NINGUNO' NOT NULL,
	`doc_number` text,
	`is_consumidor_final` integer DEFAULT true NOT NULL,
	`ship_city` text NOT NULL,
	`ship_barrio` text,
	`ship_address` text NOT NULL,
	`ship_reference` text,
	`ship_maps_url` text,
	`shipping_zone_id` integer,
	`shipping_method_id` integer,
	`shipping_method_name` text,
	`subtotal_pyg` integer DEFAULT 0 NOT NULL,
	`shipping_pyg` integer DEFAULT 0 NOT NULL,
	`total_pyg` integer DEFAULT 0 NOT NULL,
	`iva_10_pyg` integer DEFAULT 0 NOT NULL,
	`iva_5_pyg` integer DEFAULT 0 NOT NULL,
	`payment_method` text NOT NULL,
	`card_checkout_state` text DEFAULT 'idle' NOT NULL,
	`reserved_until` text,
	`payment_reminder_sent_at` text,
	`marketing_opt_in` integer,
	`marketing_opt_in_at` text,
	`is_gift` integer DEFAULT false NOT NULL,
	`gift_note` text,
	`invoice_status` text DEFAULT 'none' NOT NULL,
	`invoice_cdc` text,
	`invoice_pdf_url` text,
	`coupon_id` integer,
	`coupon_code` text,
	`discount_pyg` integer DEFAULT 0 NOT NULL,
	`customer_id` integer,
	`tracking_carrier` text,
	`tracking_code` text,
	`tracking_url` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`paid_at` text,
	CONSTRAINT "orders_status_enum" CHECK("orders"."status" IN ('pendiente_pago','esperando_verificacion','pagado','preparando','enviado','entregado','rechazado','vencido','cancelado','reembolsado')),
	CONSTRAINT "orders_doc_type_enum" CHECK("orders"."doc_type" IN ('RUC','CI','NINGUNO')),
	CONSTRAINT "orders_subtotal_pyg_nonnegative" CHECK("orders"."subtotal_pyg" >= 0 AND "orders"."subtotal_pyg" <= 9007199254740991),
	CONSTRAINT "orders_shipping_pyg_nonnegative" CHECK("orders"."shipping_pyg" >= 0 AND "orders"."shipping_pyg" <= 9007199254740991),
	CONSTRAINT "orders_total_pyg_nonnegative" CHECK("orders"."total_pyg" >= 0 AND "orders"."total_pyg" <= 9007199254740991),
	CONSTRAINT "orders_iva_10_pyg_nonnegative" CHECK("orders"."iva_10_pyg" >= 0 AND "orders"."iva_10_pyg" <= 9007199254740991),
	CONSTRAINT "orders_iva_5_pyg_nonnegative" CHECK("orders"."iva_5_pyg" >= 0 AND "orders"."iva_5_pyg" <= 9007199254740991),
	CONSTRAINT "orders_payment_method_enum" CHECK("orders"."payment_method" IN ('transferencia','contra_entrega','tarjeta')),
	CONSTRAINT "orders_card_checkout_state_enum" CHECK("orders"."card_checkout_state" IN ('idle','starting','ready','unknown')),
	CONSTRAINT "orders_invoice_status_enum" CHECK("orders"."invoice_status" IN ('none','queued','approved','rejected')),
	CONSTRAINT "orders_discount_pyg_nonnegative" CHECK("orders"."discount_pyg" >= 0 AND "orders"."discount_pyg" <= 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_number_uq` ON `orders` (`order_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_access_token_uq` ON `orders` (`access_token`);--> statement-breakpoint
CREATE INDEX `orders_customer_idx` ON `orders` (`customer_id`);--> statement-breakpoint
CREATE INDEX `orders_coupon_idx` ON `orders` (`coupon_id`);--> statement-breakpoint
CREATE INDEX `orders_shipping_method_idx` ON `orders` (`shipping_method_id`);--> statement-breakpoint
CREATE INDEX `orders_status_created_idx` ON `orders` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_phone_idx` ON `orders` (`customer_phone`);--> statement-breakpoint
CREATE INDEX `orders_doc_number_idx` ON `orders` (`doc_number`);--> statement-breakpoint
CREATE INDEX `orders_reserved_until_idx` ON `orders` (`reserved_until`);--> statement-breakpoint
CREATE TABLE `payment_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`event_key` text NOT NULL,
	`payload` text,
	`received_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT "payment_events_provider_enum" CHECK("payment_events"."provider" IN ('spi','cod','pagopar'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_events_key_uq` ON `payment_events` (`provider`,`event_key`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`provider` text NOT NULL,
	`provider_ref` text NOT NULL,
	`amount_pyg` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`refunded_pyg` integer DEFAULT 0 NOT NULL,
	`raw_payload` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "payments_provider_enum" CHECK("payments"."provider" IN ('spi','cod','pagopar')),
	CONSTRAINT "payments_amount_pyg_nonnegative" CHECK("payments"."amount_pyg" >= 0 AND "payments"."amount_pyg" <= 9007199254740991),
	CONSTRAINT "payments_status_enum" CHECK("payments"."status" IN ('pending','paid','failed','refunded')),
	CONSTRAINT "payments_refunded_pyg_nonnegative" CHECK("payments"."refunded_pyg" >= 0 AND "payments"."refunded_pyg" <= 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_provider_ref_uq` ON `payments` (`provider`,`provider_ref`);--> statement-breakpoint
CREATE INDEX `payments_order_idx` ON `payments` (`order_id`);--> statement-breakpoint
CREATE TABLE `price_adjustments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`variant_id` integer NOT NULL,
	`from_pyg` integer NOT NULL,
	`to_pyg` integer NOT NULL,
	`reason` text NOT NULL,
	`actor` text NOT NULL,
	`actor_user_id` integer,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "price_adjustments_from_pyg_nonnegative" CHECK("price_adjustments"."from_pyg" >= 0 AND "price_adjustments"."from_pyg" <= 9007199254740991),
	CONSTRAINT "price_adjustments_to_pyg_nonnegative" CHECK("price_adjustments"."to_pyg" >= 0 AND "price_adjustments"."to_pyg" <= 9007199254740991)
);
--> statement-breakpoint
CREATE INDEX `price_adjustments_variant_idx` ON `price_adjustments` (`variant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `product_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`cloudinary_id` text NOT NULL,
	`blur_data_url` text,
	`alt` text,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_images_product_idx` ON `product_images` (`product_id`,`position`);--> statement-breakpoint
CREATE TABLE `product_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`order_id` integer NOT NULL,
	`rating` integer NOT NULL,
	`title` text,
	`body` text NOT NULL,
	`author_name` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`owner_reply` text,
	`owner_reply_at` text,
	`moderated_at` text,
	`moderated_by_user_id` integer,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "product_reviews_rating_nonnegative" CHECK("product_reviews"."rating" >= 0 AND "product_reviews"."rating" <= 9007199254740991),
	CONSTRAINT "product_reviews_status_enum" CHECK("product_reviews"."status" IN ('pending','approved','rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_reviews_order_product_uq` ON `product_reviews` (`order_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `product_reviews_product_status_idx` ON `product_reviews` (`product_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`sale_mode` text DEFAULT 'stock' NOT NULL,
	`show_price` integer DEFAULT true NOT NULL,
	`description` text,
	`category_id` integer NOT NULL,
	`brand` text,
	`dropi_url` text,
	`iva_rate` integer DEFAULT 10 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_featured` integer DEFAULT false NOT NULL,
	`published_at` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "products_sale_mode_enum" CHECK("products"."sale_mode" IN ('stock','enquiry','showcase'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_slug_uq` ON `products` (`slug`);--> statement-breakpoint
CREATE INDEX `products_category_idx` ON `products` (`category_id`);--> statement-breakpoint
CREATE INDEX `products_active_published_idx` ON `products` (`is_active`,`published_at`);--> statement-breakpoint
CREATE INDEX `products_featured_idx` ON `products` (`is_featured`,`published_at`);--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`cloudinary_id` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`uploaded_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`review` text DEFAULT 'pending' NOT NULL,
	`reviewed_by` integer,
	`reviewed_at` text,
	`note` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "receipts_bytes_nonnegative" CHECK("receipts"."bytes" >= 0 AND "receipts"."bytes" <= 9007199254740991),
	CONSTRAINT "receipts_review_enum" CHECK("receipts"."review" IN ('pending','approved','rejected'))
);
--> statement-breakpoint
CREATE INDEX `receipts_order_idx` ON `receipts` (`order_id`);--> statement-breakpoint
CREATE INDEX `receipts_review_idx` ON `receipts` (`review`);--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_id` integer NOT NULL,
	`amount_pyg` integer NOT NULL,
	`reason` text NOT NULL,
	`actor` text NOT NULL,
	`actor_user_id` integer,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "refunds_amount_pyg_nonnegative" CHECK("refunds"."amount_pyg" >= 0 AND "refunds"."amount_pyg" <= 9007199254740991)
);
--> statement-breakpoint
CREATE INDEX `refunds_payment_idx` ON `refunds` (`payment_id`);--> statement-breakpoint
CREATE TABLE `setup_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`migrated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`seeded_at` text,
	`owner_at` text,
	`runs` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shipping_methods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'courier' NOT NULL,
	`pricing` text DEFAULT 'zona' NOT NULL,
	`fixed_price_pyg` integer,
	`zone_ids` text NOT NULL,
	`allowed_payment_methods` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "shipping_methods_kind_enum" CHECK("shipping_methods"."kind" IN ('courier','local','retiro')),
	CONSTRAINT "shipping_methods_pricing_enum" CHECK("shipping_methods"."pricing" IN ('zona','fijo')),
	CONSTRAINT "shipping_methods_fixed_price_pyg_nonnegative" CHECK("shipping_methods"."fixed_price_pyg" >= 0 AND "shipping_methods"."fixed_price_pyg" <= 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shipping_methods_slug_uq` ON `shipping_methods` (`slug`);--> statement-breakpoint
CREATE TABLE `shipping_zones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`cities` text NOT NULL,
	`price_pyg` integer NOT NULL,
	`free_threshold_pyg` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "shipping_zones_price_pyg_nonnegative" CHECK("shipping_zones"."price_pyg" >= 0 AND "shipping_zones"."price_pyg" <= 9007199254740991),
	CONSTRAINT "shipping_zones_free_threshold_pyg_nonnegative" CHECK("shipping_zones"."free_threshold_pyg" >= 0 AND "shipping_zones"."free_threshold_pyg" <= 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shipping_zones_slug_uq` ON `shipping_zones` (`slug`);--> statement-breakpoint
CREATE TABLE `stock_adjustments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`variant_id` integer NOT NULL,
	`delta` integer NOT NULL,
	`previous_on_hand` integer NOT NULL,
	`new_on_hand` integer NOT NULL,
	`reason` text NOT NULL,
	`actor` text NOT NULL,
	`actor_user_id` integer,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "stock_adjustments_previous_on_hand_nonnegative" CHECK("stock_adjustments"."previous_on_hand" >= 0 AND "stock_adjustments"."previous_on_hand" <= 9007199254740991),
	CONSTRAINT "stock_adjustments_new_on_hand_nonnegative" CHECK("stock_adjustments"."new_on_hand" >= 0 AND "stock_adjustments"."new_on_hand" <= 9007199254740991)
);
--> statement-breakpoint
CREATE INDEX `stock_adjustments_variant_idx` ON `stock_adjustments` (`variant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `stock_adjustments_actor_idx` ON `stock_adjustments` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `stock_alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`variant_id` integer NOT NULL,
	`phone` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`notified_at` text,
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_alerts_variant_phone_uq` ON `stock_alerts` (`variant_id`,`phone`);--> statement-breakpoint
CREATE INDEX `stock_alerts_pending_idx` ON `stock_alerts` (`variant_id`,`notified_at`);--> statement-breakpoint
CREATE TABLE `stock_reservations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`variant_id` integer NOT NULL,
	`order_id` integer NOT NULL,
	`qty` integer NOT NULL,
	`expires_at` text NOT NULL,
	`state` text DEFAULT 'held' NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "stock_reservations_qty_nonnegative" CHECK("stock_reservations"."qty" >= 0 AND "stock_reservations"."qty" <= 9007199254740991),
	CONSTRAINT "stock_reservations_state_enum" CHECK("stock_reservations"."state" IN ('held','consumed','released'))
);
--> statement-breakpoint
CREATE INDEX `stock_reservations_availability_idx` ON `stock_reservations` (`variant_id`,`state`,`expires_at`);--> statement-breakpoint
CREATE INDEX `stock_reservations_order_idx` ON `stock_reservations` (`order_id`);--> statement-breakpoint
CREATE TABLE `store_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_by_user_id` integer
);
--> statement-breakpoint
CREATE TABLE `supplier_offers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`variant_id` integer NOT NULL,
	`unit_cost_pyg` integer,
	`source` text,
	`source_type` text DEFAULT 'other' NOT NULL,
	`product_url` text,
	`supplier_url` text,
	`supplier_stock` integer,
	`notes` text,
	`is_confirmed` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_preferred` integer DEFAULT false NOT NULL,
	`checked_at` text,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "supplier_offers_unit_cost_pyg_nonnegative" CHECK("supplier_offers"."unit_cost_pyg" >= 0 AND "supplier_offers"."unit_cost_pyg" <= 9007199254740991),
	CONSTRAINT "supplier_offers_source_type_enum" CHECK("supplier_offers"."source_type" IN ('dropi','local','import','other')),
	CONSTRAINT "supplier_offers_supplier_stock_nonnegative" CHECK("supplier_offers"."supplier_stock" >= 0 AND "supplier_offers"."supplier_stock" <= 9007199254740991)
);
--> statement-breakpoint
CREATE INDEX `supplier_offers_variant_idx` ON `supplier_offers` (`variant_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text,
	`role` text DEFAULT 'staff' NOT NULL,
	`session_version` integer DEFAULT 1 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`last_login_at` text,
	CONSTRAINT "users_role_enum" CHECK("users"."role" IN ('owner','staff','vendedor')),
	CONSTRAINT "users_session_version_nonnegative" CHECK("users"."session_version" >= 0 AND "users"."session_version" <= 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `variants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`sku` text NOT NULL,
	`label` text NOT NULL,
	`price_pyg` integer NOT NULL,
	`compare_at_pyg` integer,
	`on_hand` integer DEFAULT 0 NOT NULL,
	`reorder_point` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "variants_price_pyg_nonnegative" CHECK("variants"."price_pyg" >= 0 AND "variants"."price_pyg" <= 9007199254740991),
	CONSTRAINT "variants_compare_at_pyg_nonnegative" CHECK("variants"."compare_at_pyg" >= 0 AND "variants"."compare_at_pyg" <= 9007199254740991),
	CONSTRAINT "variants_on_hand_nonnegative" CHECK("variants"."on_hand" >= 0 AND "variants"."on_hand" <= 9007199254740991),
	CONSTRAINT "variants_reorder_point_nonnegative" CHECK("variants"."reorder_point" >= 0 AND "variants"."reorder_point" <= 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `variants_sku_uq` ON `variants` (`sku`);--> statement-breakpoint
CREATE INDEX `variants_product_idx` ON `variants` (`product_id`);