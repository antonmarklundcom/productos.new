CREATE TABLE `admin_mutation_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` integer NOT NULL,
	`product_id` integer,
	`kind` text NOT NULL,
	`fingerprint` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_mutation_actor_idx` ON `admin_mutation_receipts` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `catalog_import_plans` (
	`import_id` text PRIMARY KEY NOT NULL,
	`actor_id` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`plan_json` text NOT NULL,
	`mode` text DEFAULT 'direct' NOT NULL,
	`status` text DEFAULT 'applying' NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT "catalog_plan_mode" CHECK("catalog_import_plans"."mode" IN ('direct','staged')),
	CONSTRAINT "catalog_plan_status" CHECK("catalog_import_plans"."status" IN ('applying','ready','published'))
);
--> statement-breakpoint
CREATE TABLE `catalog_import_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`offset` integer NOT NULL,
	`payload_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_stage_offset_uq` ON `catalog_import_stages` (`import_id`,`offset`);--> statement-breakpoint
CREATE TABLE `gallery_tombstones` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`image_id` integer NOT NULL,
	`cloudinary_id` text NOT NULL,
	`alt` text,
	`position` integer NOT NULL,
	`expires_at` text NOT NULL,
	`restored_at` text
);
--> statement-breakpoint
CREATE INDEX `gallery_tombstone_product_idx` ON `gallery_tombstones` (`product_id`,`restored_at`);--> statement-breakpoint
ALTER TABLE `products` ADD `featured_position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `search_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `search_brand` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `search_description` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE products SET search_name = lower(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(coalesce(name, ''), 'Á', 'a'), 'É', 'e'), 'Í', 'i'), 'Ó', 'o'), 'Ú', 'u'), 'Ü', 'u'), 'Ñ', 'ñ'), 'á', 'a'), 'é', 'e'), 'í', 'i'), 'ó', 'o'), 'ú', 'u'), 'ü', 'u')), search_brand = lower(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(coalesce(brand, ''), 'Á', 'a'), 'É', 'e'), 'Í', 'i'), 'Ó', 'o'), 'Ú', 'u'), 'Ü', 'u'), 'Ñ', 'ñ'), 'á', 'a'), 'é', 'e'), 'í', 'i'), 'ó', 'o'), 'ú', 'u'), 'ü', 'u')), search_description = lower(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(coalesce(description, ''), 'Á', 'a'), 'É', 'e'), 'Í', 'i'), 'Ó', 'o'), 'Ú', 'u'), 'Ü', 'u'), 'Ñ', 'ñ'), 'á', 'a'), 'é', 'e'), 'í', 'i'), 'ó', 'o'), 'ú', 'u'), 'ü', 'u'));
--> statement-breakpoint
CREATE TRIGGER products_search_insert AFTER INSERT ON products BEGIN UPDATE products SET search_name = lower(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(coalesce(NEW.name, ''), 'Á', 'a'), 'É', 'e'), 'Í', 'i'), 'Ó', 'o'), 'Ú', 'u'), 'Ü', 'u'), 'Ñ', 'ñ'), 'á', 'a'), 'é', 'e'), 'í', 'i'), 'ó', 'o'), 'ú', 'u'), 'ü', 'u')), search_brand = lower(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(coalesce(NEW.brand, ''), 'Á', 'a'), 'É', 'e'), 'Í', 'i'), 'Ó', 'o'), 'Ú', 'u'), 'Ü', 'u'), 'Ñ', 'ñ'), 'á', 'a'), 'é', 'e'), 'í', 'i'), 'ó', 'o'), 'ú', 'u'), 'ü', 'u')), search_description = lower(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(coalesce(NEW.description, ''), 'Á', 'a'), 'É', 'e'), 'Í', 'i'), 'Ó', 'o'), 'Ú', 'u'), 'Ü', 'u'), 'Ñ', 'ñ'), 'á', 'a'), 'é', 'e'), 'í', 'i'), 'ó', 'o'), 'ú', 'u'), 'ü', 'u')) WHERE id = NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER products_search_update AFTER UPDATE OF name, brand, description ON products BEGIN UPDATE products SET search_name = lower(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(coalesce(NEW.name, ''), 'Á', 'a'), 'É', 'e'), 'Í', 'i'), 'Ó', 'o'), 'Ú', 'u'), 'Ü', 'u'), 'Ñ', 'ñ'), 'á', 'a'), 'é', 'e'), 'í', 'i'), 'ó', 'o'), 'ú', 'u'), 'ü', 'u')), search_brand = lower(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(coalesce(NEW.brand, ''), 'Á', 'a'), 'É', 'e'), 'Í', 'i'), 'Ó', 'o'), 'Ú', 'u'), 'Ü', 'u'), 'Ñ', 'ñ'), 'á', 'a'), 'é', 'e'), 'í', 'i'), 'ó', 'o'), 'ú', 'u'), 'ü', 'u')), search_description = lower(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(coalesce(NEW.description, ''), 'Á', 'a'), 'É', 'e'), 'Í', 'i'), 'Ó', 'o'), 'Ú', 'u'), 'Ü', 'u'), 'Ñ', 'ñ'), 'á', 'a'), 'é', 'e'), 'í', 'i'), 'ó', 'o'), 'ú', 'u'), 'ü', 'u')) WHERE id = NEW.id; END;
