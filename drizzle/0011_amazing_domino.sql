CREATE TABLE `shipping_methods` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(120) NOT NULL,
	`name` varchar(160) NOT NULL,
	`kind` enum('courier','local','retiro') NOT NULL DEFAULT 'courier',
	`pricing` enum('zona','fijo') NOT NULL DEFAULT 'zona',
	`fixed_price_pyg` bigint unsigned,
	`zone_ids` json NOT NULL,
	`allowed_payment_methods` json NOT NULL,
	`description` varchar(200),
	`is_active` boolean NOT NULL DEFAULT true,
	`position` int NOT NULL DEFAULT 0,
	CONSTRAINT `shipping_methods_id` PRIMARY KEY(`id`),
	CONSTRAINT `shipping_methods_slug_uq` UNIQUE(`slug`)
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `shipping_method_id` int;--> statement-breakpoint
ALTER TABLE `orders` ADD `shipping_method_name` varchar(160);--> statement-breakpoint
CREATE INDEX `orders_shipping_method_idx` ON `orders` (`shipping_method_id`);