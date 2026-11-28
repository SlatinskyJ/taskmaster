import { useState } from 'react'
import { sectionLabelClass } from '~/components/shell/SectionLabel'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { demoLockedMessage } from '~/lib/demo'
import { cs } from '~/lib/strings'
import { MAX_PASSWORD_LENGTH, MIN_USER_PASSWORD } from '~/lib/userLimits'
import { plainTextField } from './PersonForm'

// The admin sets a new password for someone (spec §6). It can't be undone (their sessions
// end), so it is a Dialog that says so. Zrušit closes only this dialog, back to the edit sheet.

interface Props {
  name: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Resolves to a Czech error message, or null when it worked. */
  onSubmit: (password: string) => Promise<string | null>
}

export function ResetPasswordDialog({ name, open, onOpenChange, onSubmit }: Props) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const message = await onSubmit(password)
      setError(message)
      if (message === null) setPassword('')
    } catch (e) {
      setError(demoLockedMessage(e) ?? cs.login.failed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setPassword('')
          setError(null)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{cs.admin.resetTitle}</DialogTitle>
            <DialogDescription>{cs.admin.resetConfirm(name)}</DialogDescription>
          </DialogHeader>
          <label className="grid gap-1.5">
            <span className={sectionLabelClass}>{cs.admin.password}</span>
            <Input
              name="newPassword"
              required
              {...plainTextField}
              maxLength={MAX_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setError(null)
              }}
              aria-describedby="reset-password-hint"
            />
            <span id="reset-password-hint" className="text-meta font-bold text-muted">
              {cs.admin.startPasswordHint(MIN_USER_PASSWORD)}
            </span>
          </label>
          {error && (
            <p role="alert" className="font-bold text-state-rejected-text">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {cs.admin.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? cs.admin.saving : cs.admin.resetSubmit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
