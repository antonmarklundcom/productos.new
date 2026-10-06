CREATE TABLE `customers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`phone` varchar(20) NOT NULL,
	`email` varchar(200),
	`password_hash` varchar(255),
	`name` varchar(160) NOT NULL,
	`marketing_opt_in` boolean,
	`marketing_opt_in_at` datetime,
	`phone_verified_at` datetime,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`last_login_at` datetime,
	CONSTRAINT `customers_id` PRIMARY KEY(`id`),
	CONSTRAINT `customers_phone_uq` UNIQUE(`phone`),
	CONSTRAINT `customers_email_uq` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `customer_id` int;--> statement-breakpoint
CREATE INDEX `orders_customer_idx` ON `orders` (`customer_id`);