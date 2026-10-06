CREATE TABLE `order_return_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`return_id` int NOT NULL,
	`order_item_id` int NOT NULL,
	`variant_id` int NOT NULL,
	`qty` int unsigned NOT NULL,
	`restocked` boolean NOT NULL,
	CONSTRAINT `order_return_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `order_returns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`order_id` int NOT NULL,
	`reason` varchar(500) NOT NULL,
	`actor` varchar(120) NOT NULL,
	`actor_user_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `order_returns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `order_return_items` ADD CONSTRAINT `order_return_items_return_id_order_returns_id_fk` FOREIGN KEY (`return_id`) REFERENCES `order_returns`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `order_return_items` ADD CONSTRAINT `order_return_items_order_item_id_order_items_id_fk` FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `order_return_items` ADD CONSTRAINT `order_return_items_variant_id_variants_id_fk` FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `order_returns` ADD CONSTRAINT `order_returns_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `order_return_items_return_idx` ON `order_return_items` (`return_id`);--> statement-breakpoint
CREATE INDEX `order_return_items_order_item_idx` ON `order_return_items` (`order_item_id`);--> statement-breakpoint
CREATE INDEX `order_returns_order_idx` ON `order_returns` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_returns_created_idx` ON `order_returns` (`created_at`);