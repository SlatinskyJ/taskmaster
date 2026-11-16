// @ts-check
import js from '@eslint/js'
import pluginQuery from '@tanstack/eslint-plugin-query'
import pluginRouter from '@tanstack/eslint-plugin-router'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/** Imports the framework-free domain layer (spec §11) must never use. */
export const domainForbiddenImports = [
  {
    group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
    message: 'Domain layer is framework-free (spec §11).',
  },
  { group: ['@tanstack/*'], message: 'Domain layer is framework-free (spec §11).' },
  {
    group: ['drizzle-orm', 'drizzle-orm/*', 'better-sqlite3'],
    message: 'Domain layer has no DB access; pass data in.',
  },
  { group: ['node:*'], message: 'Domain layer has no Node APIs.' },
  { group: ['~/*', '../*'], message: 'Domain layer imports only from src/domain.' },
]

export default defineConfig(
  globalIgnores(['.output/', '.nitro/', '.tanstack/', 'coverage/', 'src/routeTree.gen.ts']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest'] ?? reactHooks.configs.flat.recommended],
  },
  pluginRouter.configs['flat/recommended'],
  pluginQuery.configs['flat/recommended'],
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: domainForbiddenImports }],
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
)
