-- Settlements are final (spec §5.9): the database itself rejects edits and deletes. An admin
-- correction is a new record that links to the original, never a change to it.
CREATE TRIGGER `settlements_no_update` BEFORE UPDATE ON `settlements`
BEGIN
	SELECT RAISE(ABORT, 'settlements are final');
END;
--> statement-breakpoint
CREATE TRIGGER `settlements_no_delete` BEFORE DELETE ON `settlements`
BEGIN
	SELECT RAISE(ABORT, 'settlements are final');
END;
