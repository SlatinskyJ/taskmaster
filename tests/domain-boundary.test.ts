import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

// Guards the spec §11 rule: the §5 domain layer stays framework-free.
const eslint = new ESLint({ cwd: process.cwd() })

async function restrictedImportErrors(code: string): Promise<number> {
  // Existing file path, so the type-aware project service accepts it.
  const [result] = await eslint.lintText(code, { filePath: 'src/domain/index.ts' })
  return result?.messages.filter((m) => m.ruleId === 'no-restricted-imports').length ?? 0
}

describe('domain layer import boundary', () => {
  it.each([
    "import { useState } from 'react'",
    "import { createServerFn } from '@tanstack/react-start'",
    "import { sql } from 'drizzle-orm'",
    "import Database from 'better-sqlite3'",
    "import { readFileSync } from 'node:fs'",
    "import { getRouter } from '~/router'",
  ])('rejects %s', async (line) => {
    expect(await restrictedImportErrors(`${line}\nexport {}\n`)).toBe(1)
  })

  it('allows imports inside the domain folder', async () => {
    expect(await restrictedImportErrors("export * from './index'\n")).toBe(0)
  })
})
