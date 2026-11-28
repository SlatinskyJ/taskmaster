import { useId } from 'react'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { Button } from '~/components/ui/button'
import { DEMO_LOGINS, type DemoLogin } from '~/lib/demoAccounts'
import { cs } from '~/lib/strings'

/**
 * The public demo's login page (#328): log in as one of the demo family with one tap, or open
 * the multi-device viewer. A plain link: /dev/multi renders in the browser only.
 */
export function DemoAccounts({
  busy,
  disabled,
  onPick,
}: {
  /** The account whose login is running, if a button started it. */
  busy: DemoLogin | null
  /** Any login running (a button or the form). */
  disabled: boolean
  onPick: (login: DemoLogin) => void
}) {
  const labelId = useId()
  return (
    <section aria-labelledby={labelId} className="grid gap-3">
      <SectionLabel id={labelId}>{cs.demo.tryAs}</SectionLabel>
      <div className="grid grid-cols-2 gap-3">
        {DEMO_LOGINS.map((login) => (
          <Button
            key={login}
            type="button"
            variant="ghost"
            className="min-h-tap"
            disabled={disabled}
            aria-busy={busy === login ? true : undefined}
            onClick={() => {
              onPick(login)
            }}
          >
            {cs.demo.users[login]}
          </Button>
        ))}
      </div>
      <div className="grid justify-items-center gap-1 text-center">
        <a
          href="/dev/multi"
          className="inline-flex min-h-tap items-center font-display font-semibold text-accent-strong underline underline-offset-4"
        >
          {cs.demo.multi}
        </a>
        <p className="text-meta font-bold break-words text-muted">{cs.demo.multiHint}</p>
      </div>
    </section>
  )
}
