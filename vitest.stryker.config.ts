import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import base from './vitest.config'

// Vitest config for Stryker only (stryker.config.json). These tests read route and server source
// files as text and match patterns in them; Stryker rewrites the files it mutates, so they would
// fail on any mutated route or server function and break the whole run. They guard code shape,
// not behaviour, so no mutant is caught by them anyway. `pnpm test` still runs them.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      exclude: [
        ...configDefaults.exclude,
        'tests/screen-guards.test.ts',
        'tests/server-fn-guards.test.ts',
      ],
    },
  }),
)
