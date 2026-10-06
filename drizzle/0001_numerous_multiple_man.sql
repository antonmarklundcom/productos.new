CREATE TABLE `stock_adjustments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`variant_id` int NOT NULL,
	`delta` int NOT NULL,
	`previous_on_hand` int unsigned NOT NULL,
	`new_on_hand` int unsigned NOT NULL,
	`reason` varchar(300) NOT NULL,
	`actor` varchar(120) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stock_adjustments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `stock_adjustments` ADD CONSTRAINT `stock_adjustments_variant_id_variants_id_fk` FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `stock_adjustments_variant_idx` ON `stock_adjustments` (`variant_id`,`created_at`);