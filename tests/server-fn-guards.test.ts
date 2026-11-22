import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PUBLIC_SERVER_FNS } from '~/server/auth/guards'

// Every server function is reachable by anyone on the internet, so each one must say who may
// call it (#28). This scans the source: a server function either has a guard middleware
// (`requireUser`, `requireRole(...)`) or is listed in PUBLIC_SERVER_FNS. EXPECTED_ROLES pins
// who may call each guarded one, so a reviewer sees every change to it in this file.

/** Server function → roles allowed (`any` = every signed-in user). Add new ones here. */
const EXPECTED_ROLES: Record<string, string> = {
  listUsersFn: 'admin',
  getPeriodDefaultsFn: 'admin',
  savePeriodDefaultsFn: 'admin',
  getProposalsFn: 'giver,taker',
  proposePeriodFn: 'giver,taker',
  proposeDefaultsFn: 'giver',
  approveProposalFn: 'giver,taker',
  rejectProposalFn: 'giver,taker',
  withdrawProposalFn: 'giver,taker',
  createUserFn: 'admin',
  updateUserFn: 'admin',
  resetPasswordFn: 'admin',
  createTaskFn: 'giver',
  approveTaskOfferFn: 'giver,taker',
  listPendingApprovalsFn: 'giver,taker',
  listTasksFn: 'giver',
  listPlanTasksFn: 'giver',
  listBoardFn: 'taker',
  listPendingCompletionsFn: 'giver',
  reserveTaskFn: 'taker',
  releaseTaskFn: 'giver,taker',
  completeTaskFn: 'giver,taker',
  approveTaskFn: 'giver',
  rejectTaskFn: 'giver',
  placeBidFn: 'taker',
  acceptOfferFn: 'taker',
  counterOfferFn: 'giver',
  acceptLowestTaskBidFn: 'giver',
  getTaskDetailFn: 'giver,taker',
  listBidsToAnswerFn: 'giver',
  proposeTaskScoreChangeFn: 'giver,taker',
  approveTaskScoreChangeFn: 'giver,taker',
  declineTaskScoreChangeFn: 'giver,taker',
  listScoreChangesWaitingFn: 'giver,taker',
  cancelTaskFn: 'giver',
  createTemplateFn: 'giver',
  approveTemplateScoreFn: 'giver,taker',
  listTemplatesFn: 'giver,taker',
  bidTemplateScoreFn: 'taker',
  counterTemplateScoreFn: 'giver',
  acceptTemplateBidFn: 'giver',
  acceptTemplateOfferFn: 'taker',
  getTemplateDetailFn: 'giver,taker',
  listPendingTemplatePriceChangesFn: 'giver,taker',
  listPendingTemplateApprovalsFn: 'giver,taker',
  passkeyRegisterOptionsFn: 'any',
  passkeyRegisterFn: 'any',
  listMyPasskeysFn: 'any',
  removeMyPasskeyFn: 'any',
  listPasskeyCountsFn: 'admin',
  removeUserPasskeysFn: 'admin',
  getMeetingFn: 'giver',
  getWeekFn: 'taker,giver',
  settlePeriodFn: 'giver',
  getPointsFn: 'giver,taker',
  getFeaturesFn: 'any',
}

const SRC = join(import.meta.dirname, '..', 'src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

interface ServerFn {
  name: string
  file: string
  /** `public`, `any`, a comma-separated role list, or `unguarded`. */
  access: string
}

function serverFns(): ServerFn[] {
  const found: ServerFn[] = []
  for (const file of sourceFiles(SRC)) {
    // Comment lines dropped: examples in comments are not server functions.
    const text = readFileSync(file, 'utf8').replace(/^\s*(\/\/|\/?\*).*$/gm, '')
    const rel = relative(SRC, file)
    // Each declaration runs from its `createServerFn(` to the next top-level statement.
    const decl = /^export const (\w+) = createServerFn\([\s\S]*?(?=^\S|(?![\s\S]))/gm
    const all = text.match(/createServerFn\(/g)?.length ?? 0
    let seen = 0
    for (const m of text.matchAll(decl)) {
      seen++
      const [body, name = ''] = m
      // The guard may sit anywhere in the middleware list, next to other middlewares.
      const list = /\.middleware\(\[([^\]]*)\]\)/.exec(body)?.[1] ?? ''
      const middleware = /\b(requireUser|requireRole\(([^)]*)\))/.exec(list)
      const roles = middleware?.[2]?.replace(/['"\s]/g, '')
      // Public by name only in its listed file: a same-named function elsewhere is not public.
      const publicFile = PUBLIC_SERVER_FNS[name]
      const access =
        publicFile !== undefined && rel === join('server', ...publicFile.split('/'))
          ? 'public'
          : middleware
            ? (roles ?? 'any')
            : 'unguarded'
      found.push({ name, file: rel, access })
    }
    // A server function not declared as `export const X = createServerFn(` can't be checked.
    if (seen !== all)
      found.push({
        name: '(not `export const X = createServerFn(`)',
        file: rel,
        access: 'unguarded',
      })
  }
  return found
}

describe('server function guards (#28)', () => {
  const fns = serverFns()

  it('every server function has a guard or is listed as public', () => {
    expect(fns.filter((f) => f.access === 'unguarded')).toEqual([])
  })

  it('every name in PUBLIC_SERVER_FNS is a real server function', () => {
    const names = fns.map((f) => f.name)
    for (const name of Object.keys(PUBLIC_SERVER_FNS)) expect(names).toContain(name)
  })

  it('each guarded function allows exactly the roles pinned here', () => {
    const guarded = Object.fromEntries(
      fns.filter((f) => f.access !== 'public').map((f) => [f.name, f.access]),
    )
    expect(guarded).toEqual(EXPECTED_ROLES)
  })
})
