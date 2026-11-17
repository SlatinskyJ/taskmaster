-- Audit log is append-only (spec §5.10): the database itself rejects edits and deletes,
-- so no code path (or stray script using the app's connection) can rewrite history.
CREATE TRIGGER `audit_log_no_update` BEFORE UPDATE ON `audit_log`
BEGIN
	SELECT RAISE(ABORT, 'audit_log is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_log_no_delete` BEFORE DELETE ON `audit_log`
BEGIN
	SELECT RAISE(ABORT, 'audit_log is append-only');
END;
