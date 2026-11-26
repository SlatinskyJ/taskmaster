ALTER TABLE `templates` ADD `bids_from` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `templates` SET `bids_from` = coalesce((SELECT max(`id`) FROM `template_thread` WHERE `template_id` = `templates`.`id`), 0);
