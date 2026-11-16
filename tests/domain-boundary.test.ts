import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

// Guards the spec §11 rule: the §5 domain layer stays framework-free.
const eslint = new ESLint({ cwd: process.cwd() })

async function restrictedImportErrors(code: string): Promise<number> {
  // Existing file path, so the type-aware project service accepts it.
  const [result] = await eslint.lintText(code, { filePath: 'src/domain/index.ts' })
  if (!result) throw new Error('ESLint returned no result')
  // A parse failure would also give zero restricted-import errors, so fail loudly instead.
  expect(result.fatalErrorCount).toBe(0)
  return result.messages.filter((m) => m.ruleId === 'no-restricted-imports').length
}

describe('domain layer import boundary', () => {
  it.each([
    "import { useState } from 'react'",
    "import { createServerFn } from '@tanstack/react-start'",
    "import { sql } from 'drizzle-orm'",
    "import Database from 'better-sqlite3'",
    "import { readFileSync } from 'node:fs'",
    "import { readFileSync } from 'fs'",
    "import { join } from 'path'",
    "import { Cron } from 'croner'",
    "import { hash } from '@node-rs/argon2'",
    "import { verifyRegistrationResponse } from '@simplewebauthn/server'",
    "import { getRouter } from '~/router'",
    "import { getRouter } from 'src/router'",
  ])('rejects %s', async (line) => {
    expect(await restrictedImportErrors(`${line}\nexport {}\n`)).toBe(1)
  })

  it.each(["export * from './index'", "export * from '~/domain/periods'"])(
    'allows domain-internal import %s',
    async (line) => {
      expect(await restrictedImportErrors(`${line}\n`)).toBe(0)
    },
  )

  it("rejects '../' escapes even toward other domain folders", async () => {
    expect(await restrictedImportErrors("export * from '../domain/periods'\n")).toBe(1)
  })
})
