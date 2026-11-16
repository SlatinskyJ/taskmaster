# Domain layer (spec §5)

Plain TypeScript for the section 5 rules: agreement, lifecycle, periods, settlement.

No framework, DB or Node imports here (React, TanStack, Drizzle, `better-sqlite3`, `node:*`).
ESLint enforces this. Server functions are thin wrappers that call into this folder.
