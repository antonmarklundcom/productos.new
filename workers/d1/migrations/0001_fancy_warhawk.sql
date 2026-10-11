CREATE TABLE `workers_login_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`starts` integer NOT NULL,
	`hits` integer NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_supplier_offers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`variant_id` integer NOT NULL,
	`unit_cost_pyg` integer,
	`source` text,
	`source_type` text DEFAULT 'other' NOT NULL,
	`product_url` text,
	`supplier_url` text,
	`supplier_stock` integer,
	`notes` text,
	`is_confirmed` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_preferred` integer DEFAULT false NOT NULL,
	`checked_at` text,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "supplier_offers_unit_cost_pyg_nonnegative" CHECK("__new_supplier_offers"."unit_cost_pyg" >= 0 AND "__new_supplier_offers"."unit_cost_pyg" <= 9007199254740991),
	CONSTRAINT "supplier_offers_source_type_enum" CHECK("__new_supplier_offers"."source_type" IN ('dropi','local','import','other')),
	CONSTRAINT "supplier_offers_supplier_stock_nonnegative" CHECK("__new_supplier_offers"."supplier_stock" >= 0 AND "__new_supplier_offers"."supplier_stock" <= 9007199254740991),
	CONSTRAINT "supplier_preferred_valid" CHECK("__new_supplier_offers"."is_preferred"=0 OR ("__new_supplier_offers"."is_confirmed"=1 AND "__new_supplier_offers"."is_active"=1 AND "__new_supplier_offers"."unit_cost_pyg" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_supplier_offers`("id", "variant_id", "unit_cost_pyg", "source", "source_type", "product_url", "supplier_url", "supplier_stock", "notes", "is_confirmed", "is_active", "is_preferred", "checked_at", "updated_at") SELECT "id", "variant_id", "unit_cost_pyg", "source", "source_type", "product_url", "supplier_url", "supplier_stock", "notes", "is_confirmed", "is_active", "is_preferred", "checked_at", "updated_at" FROM `supplier_offers`;--> statement-breakpoint
DROP TABLE `supplier_offers`;--> statement-breakpoint
ALTER TABLE `__new_supplier_offers` RENAME TO `supplier_offers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_offers_one_preferred` ON `supplier_offers` (`variant_id`) WHERE "supplier_offers"."is_preferred"=1;--> statement-breakpoint
CREATE INDEX `supplier_offers_variant_idx` ON `supplier_offers` (`variant_id`);