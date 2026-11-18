CREATE TABLE `passkey_challenges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`challenge` text NOT NULL,
	`purpose` text NOT NULL,
	`user_id` integer,
	`user_handle` text,
	`ip_key` text,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `passkey_challenges_token_hash_unique` ON `passkey_challenges` (`token_hash`);--> statement-breakpoint
CREATE INDEX `passkey_challenges_expires_idx` ON `passkey_challenges` (`expires_at`);--> statement-breakpoint
CREATE INDEX `passkey_challenges_ip_idx` ON `passkey_challenges` (`ip_key`);--> statement-breakpoint
CREATE INDEX `passkey_challenges_user_idx` ON `passkey_challenges` (`user_id`);--> statement-breakpoint
CREATE TABLE `passkeys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`credential_id` text NOT NULL,
	`public_key` blob NOT NULL,
	`counter` integer NOT NULL,
	`transports` text,
	`user_handle` text NOT NULL,
	`device_kind` text NOT NULL,
	`backed_up` integer NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `passkeys_credential_id_unique` ON `passkeys` (`credential_id`);--> statement-breakpoint
CREATE INDEX `passkeys_user_idx` ON `passkeys` (`user_id`);