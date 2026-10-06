ALTER TABLE `order_events` ADD `actor_user_id` int;--> statement-breakpoint
ALTER TABLE `stock_adjustments` ADD `actor_user_id` int;--> statement-breakpoint
CREATE INDEX `order_events_actor_idx` ON `order_events` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `stock_adjustments_actor_idx` ON `stock_adjustments` (`actor_user_id`,`created_at`);