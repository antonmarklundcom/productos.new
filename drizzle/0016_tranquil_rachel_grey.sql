CREATE TABLE `store_settings` (
	`id` tinyint NOT NULL,
	`data` json NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`updated_by_user_id` int,
	CONSTRAINT `store_settings_id` PRIMARY KEY(`id`)
);
