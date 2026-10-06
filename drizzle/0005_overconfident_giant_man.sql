ALTER TABLE `users` MODIFY COLUMN `role` enum('owner','staff','vendedor') NOT NULL DEFAULT 'staff';--> statement-breakpoint
ALTER TABLE `users` ADD `last_login_at` datetime;