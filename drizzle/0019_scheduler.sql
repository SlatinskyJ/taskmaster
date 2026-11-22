CREATE TABLE `template_slots` (
	`template_id` integer PRIMARY KEY NOT NULL,
	`last_slot_at` text NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE no action
);
