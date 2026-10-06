CREATE TABLE `job_runs` (
	`job` varchar(60) NOT NULL,
	`started_at` timestamp NOT NULL DEFAULT (now()),
	`finished_at` datetime,
	`last_ok_at` datetime,
	`last_error` varchar(500),
	`payload` json,
	CONSTRAINT `job_runs_job` PRIMARY KEY(`job`)
);
--> statement-breakpoint
CREATE TABLE `order_notes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`order_id` int NOT NULL,
	`body` varchar(1000) NOT NULL,
	`actor` varchar(120) NOT NULL,
	`actor_user_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `order_notes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `price_adjustments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`variant_id` int NOT NULL,
	`from_pyg` bigint unsigned NOT NULL,
	`to_pyg` bigint unsigned NOT NULL,
	`reason` varchar(500) NOT NULL,
	`actor` varchar(120) NOT NULL,
	`actor_user_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `price_adjustments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` int AUTO_INCREMENT NOT NULL,
	`payment_id` int NOT NULL,
	`amount_pyg` bigint unsigned NOT NULL,
	`reason` varchar(500) NOT NULL,
	`actor` varchar(120) NOT NULL,
	`actor_user_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `refunds_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stock_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`variant_id` int NOT NULL,
	`phone` varchar(20) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`notified_at` datetime,
	CONSTRAINT `stock_alerts_id` PRIMARY KEY(`id`),
	CONSTRAINT `stock_alerts_variant_phone_uq` UNIQUE(`variant_id`,`phone`)
);
--> statement-breakpoint
ALTER TABLE `categories` ADD `description` text;--> statement-breakpoint
ALTER TABLE `categories` ADD `image_cloudinary_id` varchar(255);--> statement-breakpoint
ALTER TABLE `categories` ADD `image_alt` varchar(200);--> statement-breakpoint
ALTER TABLE `orders` ADD `tracking_carrier` varchar(80);--> statement-breakpoint
ALTER TABLE `orders` ADD `tracking_code` varchar(120);--> statement-breakpoint
ALTER TABLE `orders` ADD `tracking_url` varchar(500);--> statement-breakpoint
ALTER TABLE `payments` ADD `refunded_pyg` bigint unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `is_featured` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `variants` ADD `reorder_point` int unsigned;--> statement-breakpoint
ALTER TABLE `order_notes` ADD CONSTRAINT `order_notes_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `price_adjustments` ADD CONSTRAINT `price_adjustments_variant_id_variants_id_fk` FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_payment_id_payments_id_fk` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_alerts` ADD CONSTRAINT `stock_alerts_variant_id_variants_id_fk` FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `order_notes_order_idx` ON `order_notes` (`order_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `price_adjustments_variant_idx` ON `price_adjustments` (`variant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `refunds_payment_idx` ON `refunds` (`payment_id`);--> statement-breakpoint
CREATE INDEX `stock_alerts_pending_idx` ON `stock_alerts` (`variant_id`,`notified_at`);--> statement-breakpoint
CREATE INDEX `products_featured_idx` ON `products` (`is_featured`,`published_at`);
--> statement-breakpoint
-- Backfill escrito a mano (src/db/backfills.ts → REFUNDS_LEDGER_BACKFILL).
-- Sin esto, las invariantes de `pnpm reconcile` sobre el ledger de
-- devoluciones nacen rojas en toda tienda con una devolución anterior a
-- esta migración. Idempotente: correrlo de nuevo no encuentra nada.
UPDATE `payments` SET `refunded_pyg` = `amount_pyg`, `updated_at` = `updated_at` WHERE `status` = 'refunded' AND `refunded_pyg` = 0 AND `amount_pyg` > 0;
--> statement-breakpoint
INSERT INTO `refunds` (`payment_id`, `amount_pyg`, `reason`, `actor`, `actor_user_id`, `created_at`) SELECT `p`.`id`, `p`.`amount_pyg`, 'devolución registrada antes del ledger', 'migracion', NULL, `p`.`updated_at` FROM `payments` `p` LEFT JOIN `refunds` `r` ON `r`.`payment_id` = `p`.`id` WHERE `p`.`status` = 'refunded' AND `p`.`amount_pyg` > 0 AND `r`.`id` IS NULL;
