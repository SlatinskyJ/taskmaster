import { defineConfig } from 'drizzle-kit'

// Schema → SQL migrations. Run `pnpm db:generate` after any schema change and commit the
// output; CI (`pnpm db:check`) fails when the two disagree.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/server/db/schema',
  out: './drizzle',
  strict: true,
  verbose: true,
})
