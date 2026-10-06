CREATE TABLE `coupons` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(40) NOT NULL,
	`type` enum('porcentaje','monto_fijo') NOT NULL,
	`value` bigint unsigned NOT NULL,
	`min_order_pyg` bigint unsigned,
	`starts_at` datetime,
	`ends_at` datetime,
	`max_uses` int unsigned,
	`max_uses_per_customer` int unsigned,
	`times_used` int unsigned NOT NULL DEFAULT 0,
	`solo_clientes` boolean NOT NULL DEFAULT false,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `coupons_id` PRIMARY KEY(`id`),
	CONSTRAINT `coupons_code_uq` UNIQUE(`code`)
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `coupon_id` int;--> statement-breakpoint
ALTER TABLE `orders` ADD `coupon_code` varchar(40);--> statement-breakpoint
ALTER TABLE `orders` ADD `discount_pyg` bigint unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `coupons_active_idx` ON `coupons` (`is_active`);--> statement-breakpoint
CREATE INDEX `orders_coupon_idx` ON `orders` (`coupon_id`);