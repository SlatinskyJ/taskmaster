// People limits (spec §6), shared by the server's checks and the Správa forms.

/** Shortest starting or reset password the admin may set (Jakub 2026-11-18). */
export const MIN_USER_PASSWORD = 8

/** Longest password; longer input is refused before hashing so a huge body can't keep the CPU busy. */
export const MAX_PASSWORD_LENGTH = 256

/** Longest display name, in characters. */
export const MAX_DISPLAY_NAME = 40
