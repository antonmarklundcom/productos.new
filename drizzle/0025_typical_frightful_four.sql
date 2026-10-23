CREATE TABLE `catalog_audit` (
	`id` varchar(100) NOT NULL,
	`actor_id` int NOT NULL,
	`operation` varchar(40) NOT NULL,
	`record_type` varchar(20) NOT NULL,
	`record_id` int NOT NULL,
	`revision` int NOT NULL,
	`fields` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `catalog_audit_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `products` ADD `revision` int DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `catalog_audit_record_idx` ON `catalog_audit` (`record_type`,`record_id`,`created_at`);