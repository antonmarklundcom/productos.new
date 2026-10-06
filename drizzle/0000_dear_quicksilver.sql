CREATE TABLE `categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(120) NOT NULL,
	`name` varchar(120) NOT NULL,
	`parent_id` int,
	`position` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `categories_slug_uq` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `counters` (
	`name` varchar(64) NOT NULL,
	`value` bigint unsigned NOT NULL DEFAULT 0,
	CONSTRAINT `counters_name` PRIMARY KEY(`name`)
);
--> statement-breakpoint
CREATE TABLE `order_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`order_id` int NOT NULL,
	`from_status` enum('pendiente_pago','esperando_verificacion','pagado','preparando','enviado','entregado','rechazado','vencido','cancelado','reembolsado'),
	`to_status` enum('pendiente_pago','esperando_verificacion','pagado','preparando','enviado','entregado','rechazado','vencido','cancelado','reembolsado') NOT NULL,
	`actor` varchar(120) NOT NULL,
	`reason` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `order_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`order_id` int NOT NULL,
	`variant_id` int NOT NULL,
	`name_snapshot` varchar(255) NOT NULL,
	`sku_snapshot` varchar(64) NOT NULL,
	`unit_price_pyg` bigint unsigned NOT NULL,
	`qty` int unsigned NOT NULL,
	`iva_rate` tinyint NOT NULL,
	`line_total_pyg` bigint unsigned NOT NULL,
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`order_number` varchar(16) NOT NULL,
	`access_token` varchar(64) NOT NULL,
	`status` enum('pendiente_pago','esperando_verificacion','pagado','preparando','enviado','entregado','rechazado','vencido','cancelado','reembolsado') NOT NULL DEFAULT 'pendiente_pago',
	`customer_name` varchar(160) NOT NULL,
	`customer_phone` varchar(20) NOT NULL,
	`customer_email` varchar(200),
	`doc_type` enum('RUC','CI','NINGUNO') NOT NULL DEFAULT 'NINGUNO',
	`doc_number` varchar(32),
	`is_consumidor_final` boolean NOT NULL DEFAULT true,
	`ship_city` varchar(120) NOT NULL,
	`ship_barrio` varchar(120),
	`ship_address` varchar(255) NOT NULL,
	`ship_reference` varchar(255),
	`ship_maps_url` varchar(500),
	`shipping_zone_id` int,
	`subtotal_pyg` bigint unsigned NOT NULL DEFAULT 0,
	`shipping_pyg` bigint unsigned NOT NULL DEFAULT 0,
	`total_pyg` bigint unsigned NOT NULL DEFAULT 0,
	`iva_10_pyg` bigint unsigned NOT NULL DEFAULT 0,
	`iva_5_pyg` bigint unsigned NOT NULL DEFAULT 0,
	`payment_method` enum('transferencia','contra_entrega','tarjeta') NOT NULL,
	`reserved_until` datetime,
	`invoice_status` enum('none','queued','approved','rejected') NOT NULL DEFAULT 'none',
	`invoice_cdc` varchar(64),
	`invoice_pdf_url` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`paid_at` datetime,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_number_uq` UNIQUE(`order_number`),
	CONSTRAINT `orders_access_token_uq` UNIQUE(`access_token`)
);
--> statement-breakpoint
CREATE TABLE `payment_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provider` enum('spi','cod','pagopar') NOT NULL,
	`event_key` varchar(191) NOT NULL,
	`payload` json,
	`received_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payment_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `payment_events_key_uq` UNIQUE(`provider`,`event_key`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`order_id` int NOT NULL,
	`provider` enum('spi','cod','pagopar') NOT NULL,
	`provider_ref` varchar(191) NOT NULL,
	`amount_pyg` bigint unsigned NOT NULL,
	`status` enum('pending','paid','failed','refunded') NOT NULL DEFAULT 'pending',
	`raw_payload` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `payments_provider_ref_uq` UNIQUE(`provider`,`provider_ref`)
);
--> statement-breakpoint
CREATE TABLE `product_images` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`cloudinary_id` varchar(255) NOT NULL,
	`blur_data_url` text,
	`alt` varchar(255),
	`position` int NOT NULL DEFAULT 0,
	CONSTRAINT `product_images_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(160) NOT NULL,
	`name` varchar(200) NOT NULL,
	`description` text,
	`category_id` int NOT NULL,
	`brand` varchar(120),
	`iva_rate` tinyint NOT NULL DEFAULT 10,
	`is_active` boolean NOT NULL DEFAULT true,
	`published_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_slug_uq` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`order_id` int NOT NULL,
	`cloudinary_id` varchar(255) NOT NULL,
	`mime` varchar(100) NOT NULL,
	`bytes` int unsigned NOT NULL,
	`uploaded_at` timestamp NOT NULL DEFAULT (now()),
	`review` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`reviewed_by` int,
	`reviewed_at` datetime,
	`note` varchar(500),
	CONSTRAINT `receipts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shipping_zones` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(120) NOT NULL,
	`name` varchar(160) NOT NULL,
	`cities` json NOT NULL,
	`price_pyg` bigint unsigned NOT NULL,
	`free_threshold_pyg` bigint unsigned,
	`is_active` boolean NOT NULL DEFAULT true,
	`position` int NOT NULL DEFAULT 0,
	CONSTRAINT `shipping_zones_id` PRIMARY KEY(`id`),
	CONSTRAINT `shipping_zones_slug_uq` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `stock_reservations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`variant_id` int NOT NULL,
	`order_id` int NOT NULL,
	`qty` int unsigned NOT NULL,
	`expires_at` datetime NOT NULL,
	`state` enum('held','consumed','released') NOT NULL DEFAULT 'held',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stock_reservations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(200) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`name` varchar(160),
	`role` enum('owner','staff') NOT NULL DEFAULT 'staff',
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_uq` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `variants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`sku` varchar(64) NOT NULL,
	`label` varchar(120) NOT NULL,
	`price_pyg` bigint unsigned NOT NULL,
	`compare_at_pyg` bigint unsigned,
	`on_hand` int unsigned NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`position` int NOT NULL DEFAULT 0,
	CONSTRAINT `variants_id` PRIMARY KEY(`id`),
	CONSTRAINT `variants_sku_uq` UNIQUE(`sku`)
);
--> statement-breakpoint
ALTER TABLE `order_events` ADD CONSTRAINT `order_events_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_variant_id_variants_id_fk` FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `product_images` ADD CONSTRAINT `product_images_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_reservations` ADD CONSTRAINT `stock_reservations_variant_id_variants_id_fk` FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_reservations` ADD CONSTRAINT `stock_reservations_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `variants` ADD CONSTRAINT `variants_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `categories_parent_idx` ON `categories` (`parent_id`);--> statement-breakpoint
CREATE INDEX `order_events_order_idx` ON `order_events` (`order_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_items_variant_idx` ON `order_items` (`variant_id`);--> statement-breakpoint
CREATE INDEX `orders_status_created_idx` ON `orders` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_phone_idx` ON `orders` (`customer_phone`);--> statement-breakpoint
CREATE INDEX `orders_doc_number_idx` ON `orders` (`doc_number`);--> statement-breakpoint
CREATE INDEX `orders_reserved_until_idx` ON `orders` (`reserved_until`);--> statement-breakpoint
CREATE INDEX `payments_order_idx` ON `payments` (`order_id`);--> statement-breakpoint
CREATE INDEX `product_images_product_idx` ON `product_images` (`product_id`,`position`);--> statement-breakpoint
CREATE INDEX `products_category_idx` ON `products` (`category_id`);--> statement-breakpoint
CREATE INDEX `products_active_published_idx` ON `products` (`is_active`,`published_at`);--> statement-breakpoint
CREATE INDEX `receipts_order_idx` ON `receipts` (`order_id`);--> statement-breakpoint
CREATE INDEX `receipts_review_idx` ON `receipts` (`review`);--> statement-breakpoint
CREATE INDEX `stock_reservations_availability_idx` ON `stock_reservations` (`variant_id`,`state`,`expires_at`);--> statement-breakpoint
CREATE INDEX `stock_reservations_order_idx` ON `stock_reservations` (`order_id`);--> statement-breakpoint
CREATE INDEX `variants_product_idx` ON `variants` (`product_id`);