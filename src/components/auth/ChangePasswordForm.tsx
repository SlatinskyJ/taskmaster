import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { sectionLabelClass } from '~/components/shell/SectionLabel'
import { Button } from '~/components/ui/button'
import { DrawerFooter } from '~/components/ui/drawer'
import { Input } from '~/components/ui/input'
import { cs } from '~/lib/strings'
import { MAX_PASSWORD_LENGTH, MIN_USER_PASSWORD } from '~/lib/userLimits'
import type { ChangePasswordResult } from '~/server/users/functions'
import type { ChangePasswordValues, PasswordField } from './changePasswordForm'
import { checkBeforeSending, EMPTY_PASSWORD_FORM, nextField, outcomeOf } from './changePasswordForm'

// The form inside ChangePasswordDrawer (Profil, #210). Fields scroll in their own body and the
// button sits in the footer, so it stays reachable above the phone keyboard.

interface Props {
  username: string
  onSubmit: (data: {
    current: string
    next: string
    logOutOthers: boolean
  }) => Promise<ChangePasswordResult>
  /** Called after a change went through, with the toast text. */
  onDone: (toast: string) => void
}

const LABELS: Record<PasswordField, string> = {
  current: cs.profile.currentPassword,
  next: cs.profile.newPassword,
  again: cs.profile.newPasswordAgain,
}

export function ChangePasswordForm({ username, onSubmit, onDone }: Props) {
  const [values, setValues] = useState<ChangePasswordValues>(EMPTY_PASSWORD_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refs = {
    current: useRef<HTMLInputElement>(null),
    next: useRef<HTMLInputElement>(null),
    again: useRef<HTMLInputElement>(null),
  }
  const set = (patch: Partial<ChangePasswordValues>) => {
    setValues((v) => ({ ...v, ...patch }))
    setError(null)
  }

  async function submit() {
    const invalid = checkBeforeSending(values)
    if (invalid) {
      setError(invalid)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const outcome = outcomeOf(
        await onSubmit({
          current: values.current,
          next: values.next,
          logOutOthers: values.logOutOthers,
        }),
      )
      if (outcome.done) {
        setValues(EMPTY_PASSWORD_FORM)
        onDone(outcome.toast)
      } else setError(outcome.error)
    } catch {
      setError(cs.login.failed)
    } finally {
      setBusy(false)
    }
  }

  /** Return moves to the next field instead of sending a half-filled form. */
  function onKeyDown(field: PasswordField, e: KeyboardEvent<HTMLInputElement>) {
    const next = nextField(field)
    if (e.key !== 'Enter' || next === null) return
    e.preventDefault()
    refs[next].current?.focus()
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-1">
        {/* For password managers: which saved login this new password belongs to. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={username}
          readOnly
          hidden
        />
        {(['current', 'next', 'again'] as const).map((field) => (
          <div key={field} className="grid gap-1.5">
            <label htmlFor={`password-${field}`} className={sectionLabelClass}>
              {LABELS[field]}
            </label>
            <Input
              id={`password-${field}`}
              ref={refs[field]}
              name={field}
              type="password"
              required
              autoComplete={field === 'current' ? 'current-password' : 'new-password'}
              enterKeyHint={field === 'again' ? 'done' : 'next'}
              maxLength={MAX_PASSWORD_LENGTH}
              value={values[field]}
              onChange={(e) => {
                set({ [field]: e.target.value })
              }}
              onKeyDown={(e) => {
                onKeyDown(field, e)
              }}
              aria-describedby={field === 'next' ? 'password-next-hint' : undefined}
            />
            {field === 'next' && (
              <span id="password-next-hint" className="text-meta font-bold text-muted">
                {cs.profile.passwordHint(MIN_USER_PASSWORD)}
              </span>
            )}
          </div>
        ))}
        <label className="flex min-h-tap items-center gap-2.5 text-row font-extrabold">
          <input
            type="checkbox"
            name="logOutOthers"
            checked={values.logOutOthers}
            onChange={(e) => {
              set({ logOutOthers: e.target.checked })
            }}
            className="size-5.5 shrink-0 accent-accent-strong"
          />
          {cs.profile.logOutOthers}
        </label>
      </div>
      <DrawerFooter>
        {error && (
          <p role="alert" className="font-bold text-state-rejected-text">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={busy} className="w-full">
          {busy ? cs.profile.passwordSaving : cs.profile.passwordSubmit}
        </Button>
      </DrawerFooter>
    </form>
  )
}
