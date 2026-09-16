-- Tracks Expo push "send" tickets pending a delivery receipt check. A ticket
-- status of 'ok' only means Expo accepted the request — actual APNs/FCM
-- delivery failures (bad credentials, sandbox/production mismatch, device not
-- registered, etc.) only surface via Expo's separate receipts endpoint,
-- polled on a later cron tick. Rows are deleted once resolved.

CREATE TABLE `push_receipt_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`push_token_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`push_token_id`) REFERENCES `push_tokens`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_receipt_checks_ticket_id_idx` ON `push_receipt_checks` (`ticket_id`);
--> statement-breakpoint
CREATE INDEX `push_receipt_checks_created_at_idx` ON `push_receipt_checks` (`created_at`);
