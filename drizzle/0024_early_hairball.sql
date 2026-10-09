CREATE TABLE `supplier_offers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`variant_id` int NOT NULL,
	`unit_cost_pyg` bigint unsigned,
	`source` varchar(200),
	`source_type` enum('dropi','local','import','other') NOT NULL DEFAULT 'other',
	`product_url` varchar(2048),
	`supplier_url` varchar(2048),
	`supplier_stock` int unsigned,
	`notes` varchar(1000),
	`is_confirmed` boolean NOT NULL DEFAULT false,
	`is_active` boolean NOT NULL DEFAULT true,
	`is_preferred` boolean NOT NULL DEFAULT false,
	`checked_at` datetime,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `supplier_offers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `supplier_offers` ADD CONSTRAINT `supplier_offers_variant_id_variants_id_fk` FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `supplier_offers_variant_idx` ON `supplier_offers` (`variant_id`);