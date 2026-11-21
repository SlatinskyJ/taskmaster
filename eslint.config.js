// @ts-check
import js from '@eslint/js'
import { builtinModules } from 'node:module'
import pluginQuery from '@tanstack/eslint-plugin-query'
import pluginRouter from '@tanstack/eslint-plugin-router'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/** Imports the framework-free domain layer (spec §11) must never use. */
export const domainForbiddenImports = [
  {
    group: ['react', 'react-dom', 'react/*', 'react-dom/*', '@tanstack/*'],
    message: 'Domain layer is framework-free (spec §11).',
  },
  {
    group: ['drizzle-orm', 'drizzle-orm/*', 'better-sqlite3'],
    message: 'Domain layer has no DB access; pass data in.',
  },
  {
    group: ['croner', '@simplewebauthn/*', '@node-rs/*'],
    message: 'Domain layer has no scheduler or auth code; server code calls into it.',
  },
  { group: ['node:*'], message: 'Domain layer has no Node APIs.' },
  {
    group: ['~/*', '!~/domain', '!~/domain/*', '../*', 'src/*'],
    message: 'Domain layer imports only from src/domain (use ~/domain/... across subfolders).',
  },
]

export default defineConfig(
  globalIgnores([
    '.output/',
    '.nitro/',
    '.tanstack/',
    'coverage/',
    'reports/',
    '.stryker-tmp/',
    'src/routeTree.gen.ts',
  ]),
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
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          // Bare Node built-ins ('fs', 'path') as exact names; a pattern would also catch ~/domain.
          paths: builtinModules.map((name) => ({
            name,
            message: 'Domain layer has no Node APIs.',
          })),
          patterns: domainForbiddenImports,
        },
      ],
    },
  },
  {
    // Screens reach the server only through server functions; any other server import would
    // pull server code (and the DB driver) into the browser bundle.
    files: ['src/routes/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^~/server/(?![\\w-]+/functions$)',
              message: 'Screens import only server functions (~/server/<module>/functions).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
)
