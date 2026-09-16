CREATE TABLE `action_items` (
	`id` text PRIMARY KEY NOT NULL,
	`action_plan_id` text NOT NULL,
	`finding_id` text,
	`household_id` text NOT NULL,
	`space_id` text,
	`priority` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`estimated_cost_min` integer,
	`estimated_cost_max` integer,
	`cost_confidence` text,
	`cost_disclaimer` text,
	`due_date` text,
	`status` text NOT NULL,
	`completed_at` text,
	`completed_by` text,
	`notes` text,
	`sort_order` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`action_plan_id`) REFERENCES `action_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`finding_id`) REFERENCES `findings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `household_spaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`completed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `action_items_action_plan_id_idx` ON `action_items` (`action_plan_id`);--> statement-breakpoint
CREATE INDEX `action_items_household_id_idx` ON `action_items` (`household_id`);--> statement-breakpoint
CREATE INDEX `action_items_status_idx` ON `action_items` (`status`);--> statement-breakpoint
CREATE INDEX `action_items_priority_idx` ON `action_items` (`priority`);--> statement-breakpoint
CREATE INDEX `action_items_space_id_idx` ON `action_items` (`space_id`);--> statement-breakpoint
CREATE TABLE `action_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`timeframe` text NOT NULL,
	`generated_at` text NOT NULL,
	`ai_model_version` text,
	`prompt_version` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `action_plans_report_id_idx` ON `action_plans` (`report_id`);--> statement-breakpoint
CREATE INDEX `action_plans_timeframe_idx` ON `action_plans` (`timeframe`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`metadata` text,
	`ip_address` text,
	`user_agent` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_log_user_id_idx` ON `audit_log` (`user_id`);--> statement-breakpoint
CREATE INDEX `audit_log_action_idx` ON `audit_log` (`action`);--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_log_created_at_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `email_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`verified_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_verifications_token_hash_unique` ON `email_verifications` (`token_hash`);--> statement-breakpoint
CREATE INDEX `email_verifications_user_id_idx` ON `email_verifications` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_verifications_token_hash_idx` ON `email_verifications` (`token_hash`);--> statement-breakpoint
CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`chunk_id` text,
	`system_category` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`plain_language_summary` text,
	`ai_confidence` real,
	`evidence_page_numbers` text,
	`raw_ai_output` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chunk_id`) REFERENCES `report_chunks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `findings_report_id_idx` ON `findings` (`report_id`);--> statement-breakpoint
CREATE INDEX `findings_severity_idx` ON `findings` (`severity`);--> statement-breakpoint
CREATE INDEX `findings_system_category_idx` ON `findings` (`system_category`);--> statement-breakpoint
CREATE TABLE `household_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`invited_by` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`accepted_at` text,
	`declined_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_invitations_token_hash_unique` ON `household_invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `household_invitations_household_id_idx` ON `household_invitations` (`household_id`);--> statement-breakpoint
CREATE INDEX `household_invitations_email_idx` ON `household_invitations` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `household_invitations_token_hash_idx` ON `household_invitations` (`token_hash`);--> statement-breakpoint
CREATE TABLE `household_members` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`invited_by` text,
	`joined_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_members_household_user_idx` ON `household_members` (`household_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `household_members_user_id_idx` ON `household_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `household_spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`space_type` text NOT NULL,
	`category` text,
	`floor_level` integer,
	`icon_emoji` text,
	`icon_color` text,
	`custom_image_key` text,
	`display_order` integer DEFAULT 0 NOT NULL,
	`description` text,
	`area_sqft` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `household_spaces_household_id_idx` ON `household_spaces` (`household_id`);--> statement-breakpoint
CREATE INDEX `household_spaces_display_order_idx` ON `household_spaces` (`household_id`,`display_order`);--> statement-breakpoint
CREATE TABLE `households` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`address_line1` text,
	`address_line2` text,
	`city` text,
	`state_province` text,
	`postal_code` text,
	`country` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `households_name_idx` ON `households` (`name`);--> statement-breakpoint
CREATE TABLE `maintenance_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`completed_by` text NOT NULL,
	`completed_at` text NOT NULL,
	`notes` text,
	`photo_keys` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `maintenance_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`completed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `maintenance_completions_task_id_idx` ON `maintenance_completions` (`task_id`);--> statement-breakpoint
CREATE INDEX `maintenance_completions_completed_at_idx` ON `maintenance_completions` (`completed_at`);--> statement-breakpoint
CREATE TABLE `maintenance_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`space_id` text,
	`system_category` text,
	`title` text NOT NULL,
	`description` text,
	`frequency` text NOT NULL,
	`custom_interval_days` integer,
	`next_due_date` text,
	`last_completed_at` text,
	`assigned_to` text,
	`reminder_days_before` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`source` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `household_spaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `maintenance_tasks_household_id_idx` ON `maintenance_tasks` (`household_id`);--> statement-breakpoint
CREATE INDEX `maintenance_tasks_next_due_date_idx` ON `maintenance_tasks` (`next_due_date`);--> statement-breakpoint
CREATE INDEX `maintenance_tasks_is_active_idx` ON `maintenance_tasks` (`is_active`);--> statement-breakpoint
CREATE INDEX `maintenance_tasks_space_id_idx` ON `maintenance_tasks` (`space_id`);--> statement-breakpoint
CREATE TABLE `password_resets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_resets_token_hash_unique` ON `password_resets` (`token_hash`);--> statement-breakpoint
CREATE INDEX `password_resets_user_id_idx` ON `password_resets` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `password_resets_token_hash_idx` ON `password_resets` (`token_hash`);--> statement-breakpoint
CREATE TABLE `processing_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`job_type` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`last_error` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `processing_jobs_report_id_idx` ON `processing_jobs` (`report_id`);--> statement-breakpoint
CREATE INDEX `processing_jobs_status_idx` ON `processing_jobs` (`status`);--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`device_info` text,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refresh_tokens_token_hash_unique` ON `refresh_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_user_id_idx` ON `refresh_tokens` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `refresh_tokens_token_hash_idx` ON `refresh_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `report_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`page_number` integer,
	`section_type` text,
	`content` text NOT NULL,
	`embedding_key` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `report_chunks_report_id_idx` ON `report_chunks` (`report_id`);--> statement-breakpoint
CREATE INDEX `report_chunks_report_chunk_idx` ON `report_chunks` (`report_id`,`chunk_index`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`filename` text NOT NULL,
	`file_size` integer NOT NULL,
	`file_key` text NOT NULL,
	`status` text NOT NULL,
	`processing_started_at` text,
	`processing_completed_at` text,
	`error_message` text,
	`page_count` integer,
	`inspection_date` text,
	`inspector_name` text,
	`property_address` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reports_household_id_idx` ON `reports` (`household_id`);--> statement-breakpoint
CREATE INDEX `reports_status_idx` ON `reports` (`status`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tier` text NOT NULL,
	`status` text NOT NULL,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`current_period_start` text NOT NULL,
	`current_period_end` text NOT NULL,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_user_id_unique` ON `subscriptions` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_user_id_idx` ON `subscriptions` (`user_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_stripe_customer_id_idx` ON `subscriptions` (`stripe_customer_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`password_hash` text,
	`apple_id` text,
	`google_id` text,
	`display_name` text,
	`avatar_url` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_apple_id_unique` ON `users` (`apple_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_id_unique` ON `users` (`google_id`);--> statement-breakpoint
CREATE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_apple_id_idx` ON `users` (`apple_id`);--> statement-breakpoint
CREATE INDEX `users_google_id_idx` ON `users` (`google_id`);