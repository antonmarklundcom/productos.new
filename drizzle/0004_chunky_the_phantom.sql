ALTER TABLE `orders` ADD `is_gift` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `gift_note` varchar(300);