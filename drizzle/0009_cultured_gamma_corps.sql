CREATE TABLE `login_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`customer_id` int NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`channel` varchar(20) NOT NULL,
	`expires_at` datetime NOT NULL,
	`consumed_at` datetime,
	`invalidated_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `login_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `login_tokens_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE INDEX `login_tokens_customer_idx` ON `login_tokens` (`customer_id`,`created_at`);