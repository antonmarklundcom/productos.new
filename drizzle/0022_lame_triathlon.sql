ALTER TABLE `products` ADD `sale_mode` enum('stock','enquiry','showcase') DEFAULT 'stock' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `show_price` boolean DEFAULT true NOT NULL;