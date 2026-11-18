import { Fingerprint } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { cs } from '~/lib/strings'

/** The login screen's passkey button and the hint under it (UI doc §7.4, Login mockup). */
export function PasskeyLoginButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <div className="grid gap-2">
      <Button type="button" size="lg" disabled={busy} onClick={onClick} className="w-full">
        <Fingerprint aria-hidden="true" />
        {cs.passkeys.loginButton}
      </Button>
      <p className="text-center text-meta font-bold text-muted">{cs.passkeys.hint}</p>
    </div>
  )
}
