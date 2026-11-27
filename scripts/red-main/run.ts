// The red-main workflow's entry point (#338), run as `node scripts/red-main/run.ts`. Decides
// whether a finished CI run on main sends an email; on send, writes the message to MAIL_FILE
// and `send=true` to GITHUB_OUTPUT, and the workflow's next step sends it with curl.
import { appendFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { decide, formatMail, isRed, type Action, type Mail } from './decide.ts'
import { makeGithub } from './github.ts'

const TEST_MAIL: Mail = {
  subject: 'Taskmaster: red-main test',
  text: 'Test of the red-main email. Nothing is broken.',
}

async function act(env: NodeJS.ProcessEnv, action: Action): Promise<Action> {
  if (action.kind === 'send') {
    const { mail } = action
    const message = formatMail(
      env.ALERT_SMTP_USER ?? '',
      env.ALERT_EMAIL_TO ?? '',
      mail,
      new Date(),
    )
    if (!env.MAIL_FILE) throw new Error('red-main: MAIL_FILE missing')
    await writeFile(env.MAIL_FILE, message)
    if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, 'send=true\n')
  }
  console.log(
    `red-main: ${action.kind} ${action.kind === 'send' ? action.mail.subject : action.reason}`,
  )
  return action
}

export async function main(fetchFn: typeof fetch, env: NodeJS.ProcessEnv): Promise<Action> {
  // A workflow_dispatch test run has no RUN_ID and needs no GitHub reads.
  if (env.RED_MAIN_TEST === 'true') return act(env, { kind: 'send', mail: TEST_MAIL })
  if (!env.GH_TOKEN) throw new Error('red-main: GH_TOKEN missing')
  if (!env.RUN_ID) throw new Error('red-main: RUN_ID missing')
  const repo = env.GITHUB_REPOSITORY ?? 'SlatinskyJ/taskmaster'
  const repoUrl = `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repo}`
  const gh = makeGithub(env.GH_TOKEN, repo, fetchFn)
  const run = await gh.getRun(Number(env.RUN_ID))
  const completed = await gh.completedRuns()
  const failed = isRed(run.conclusion) ? await gh.failedJobs(run.id) : []
  const previousAttemptRed =
    run.conclusion === 'success' && run.attempt > 1
      ? isRed(await gh.attemptConclusion(run.id, run.attempt - 1))
      : false
  return act(env, decide(run, completed, failed, previousAttemptRed, repoUrl))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main(fetch, process.env)
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
