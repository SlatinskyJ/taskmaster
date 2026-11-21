import { Fingerprint } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { cs } from '~/lib/strings'

/**
 * The login screen's passkey button (UI doc §7.4, Login mockup: the outlined one). Its own
 * error sits right under it, apart from the password form's; otherwise the hint does.
 */
export function PasskeyLoginButton({
  busy,
  error,
  onClick,
}: {
  busy: boolean
  error: string | null
  onClick: () => void
}) {
  return (
    <div className="grid gap-2">
      <Button
        type="button"
        variant="ghost"
        size="lg"
        disabled={busy}
        onClick={onClick}
        className="w-full"
      >
        <Fingerprint aria-hidden="true" />
        {cs.passkeys.loginButton}
      </Button>
      {error ? (
        <p role="alert" className="text-center font-bold text-state-rejected-text">
          {error}
        </p>
      ) : (
        <p className="text-center text-meta font-bold text-muted">{cs.passkeys.hint}</p>
      )}
    </div>
  )
}
