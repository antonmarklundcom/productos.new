CREATE TABLE `integration_settings` (
	`integration` varchar(32) NOT NULL,
	`data` json NOT NULL,
	`secrets` json NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`updated_by_user_id` int,
	CONSTRAINT `integration_settings_integration` PRIMARY KEY(`integration`)
);
