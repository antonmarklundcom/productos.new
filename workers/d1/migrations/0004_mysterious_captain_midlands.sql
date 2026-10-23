CREATE TABLE `catalog_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` integer NOT NULL,
	`operation` text NOT NULL,
	`record_type` text NOT NULL,
	`record_id` integer NOT NULL,
	`revision` integer NOT NULL,
	`fields` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `catalog_audit_record_idx` ON `catalog_audit` (`record_type`,`record_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `catalog_import_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`actor_id` integer NOT NULL,
	`offset` integer NOT NULL,
	`next_offset` integer NOT NULL,
	`variants_written` integer NOT NULL,
	`photos_written` integer NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_import_batch_uq` ON `catalog_import_receipts` (`import_id`,`offset`);--> statement-breakpoint
CREATE TABLE `catalog_import_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`total_products` integer NOT NULL,
	`next_offset` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `products` ADD `revision` integer DEFAULT 1 NOT NULL;