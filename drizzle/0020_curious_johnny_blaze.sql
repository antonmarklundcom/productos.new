CREATE TABLE `notification_outbox` (
	`id` int AUTO_INCREMENT NOT NULL,
	`event_key` varchar(100) NOT NULL,
	`order_id` int NOT NULL,
	`kind` enum('confirmado','pagado','enviado','recordatorio','resena','dueno') NOT NULL,
	`status` enum('pendiente_pago','esperando_verificacion','pagado','preparando','enviado','entregado','rechazado','vencido','cancelado','reembolsado') NOT NULL,
	`note` varchar(500),
	`state` enum('pending','sending','sent','failed','unknown') NOT NULL DEFAULT 'pending',
	`attempts` tinyint unsigned NOT NULL DEFAULT 0,
	`next_attempt_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`claimed_at` datetime,
	`sent_at` datetime,
	`provider_message_id` varchar(200),
	`last_error` varchar(200),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notification_outbox_id` PRIMARY KEY(`id`),
	CONSTRAINT `notification_outbox_event_unique` UNIQUE(`event_key`)
);
--> statement-breakpoint
ALTER TABLE `notification_outbox` ADD CONSTRAINT `notification_outbox_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `notification_outbox_due_idx` ON `notification_outbox` (`state`,`next_attempt_at`);