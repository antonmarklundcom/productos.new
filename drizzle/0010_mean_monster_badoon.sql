CREATE TABLE `bank_details` (
	`id` tinyint NOT NULL,
	`banco` varchar(120) NOT NULL,
	`titular` varchar(160) NOT NULL,
	`ruc` varchar(20) NOT NULL,
	`cuenta` varchar(60) NOT NULL,
	`tipo_cuenta` varchar(60) NOT NULL,
	`qr_cloudinary_id` varchar(255),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`updated_by` int,
	CONSTRAINT `bank_details_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `bank_details` ADD CONSTRAINT `bank_details_updated_by_users_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;