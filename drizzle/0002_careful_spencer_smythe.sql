CREATE TABLE `setup_state` (
	`id` tinyint NOT NULL,
	`migrated_at` timestamp NOT NULL DEFAULT (now()),
	`seeded_at` timestamp,
	`owner_at` timestamp,
	`runs` int NOT NULL DEFAULT 1,
	CONSTRAINT `setup_state_id` PRIMARY KEY(`id`)
);
