CREATE TABLE `operation_keys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scope` varchar(16) NOT NULL,
	`op_key` varchar(64) NOT NULL,
	`fingerprint` varchar(64) NOT NULL,
	`result` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `operation_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `operation_keys_scope_key_uq` UNIQUE(`scope`,`op_key`)
);
--> statement-breakpoint
CREATE INDEX `operation_keys_created_idx` ON `operation_keys` (`created_at`);