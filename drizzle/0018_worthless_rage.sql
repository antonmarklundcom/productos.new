ALTER TABLE `login_tokens` DROP INDEX `login_tokens_hash_uq`;--> statement-breakpoint
ALTER TABLE `customers` ADD `session_version` int unsigned DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `login_tokens` ADD `attempts` tinyint unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `session_version` int unsigned DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE `login_tokens` SET `invalidated_at` = NOW() WHERE `consumed_at` IS NULL AND `invalidated_at` IS NULL;
