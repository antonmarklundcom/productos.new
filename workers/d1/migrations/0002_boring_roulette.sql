CREATE TABLE `workers_admin_password_resets` (
	`digest` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`session_version` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workers_admin_password_resets_user_idx` ON `workers_admin_password_resets` (`user_id`);--> statement-breakpoint
CREATE INDEX `workers_admin_password_resets_expiry_idx` ON `workers_admin_password_resets` (`expires_at`);