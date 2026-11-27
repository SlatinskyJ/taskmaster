import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { sectionLabelClass } from '~/components/shell/SectionLabel'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { demoLockedMessage } from '~/lib/demo'
import { cs } from '~/lib/strings'
import { MAX_DISPLAY_NAME, MAX_PASSWORD_LENGTH, MIN_USER_PASSWORD } from '~/lib/userLimits'
import type { PersonSummary } from '~/server/users/functions'
import {
  nextPersonField,
  PERSON_FIELDS,
  personEnterKeyHint,
  type PersonField,
} from './personFields'

// The add / edit form inside PersonDrawer (UI doc §5: forms go in the bottom sheet). The
// fields and Uložit scroll in one body, Uložit after the last field (#159, Jakub 2026-11-26):
// with the phone keyboard up, a pinned Uložit under a short field list hid that more fields
// follow. Uložit may sit under the keyboard; the body scrolls to it (CLAUDE.md phone form
// rule); a refusal scrolls into view. Exported on its own so tests render it without the drawer's portal.

type Role = PersonSummary['role']
const ROLES: readonly Role[] = ['taker', 'giver', 'admin']

export interface PersonFormValues {
  displayName: string
  username: string
  role: Role
  password: string
}

/** Keeps a phone keyboard from changing what the admin types and reads out (#134). */
export const plainTextField = {
  type: 'text',
  autoComplete: 'off',
  autoCapitalize: 'none',
  autoCorrect: 'off',
  spellCheck: false,
} as const

interface Props {
  mode: 'add' | 'edit'
  /** The person being edited (edit mode). */
  person?: PersonSummary
  /** The admin's own row: no role change, no reset (they would lock themselves out). */
  isSelf?: boolean
  /** Saves; resolves to a Czech error message, or null when it worked. */
  onSubmit: (values: PersonFormValues) => Promise<string | null>
  /** Opens the reset password dialog (edit mode, not self). */
  onReset?: () => void
  /**
   * The public demo (#328): the form shows, every control disabled through its one fieldset
   * (the controls carry no `disabled` of their own for it), with the lock note at the top.
   */
  locked?: boolean
}

export function PersonForm({
  mode,
  person,
  isSelf = false,
  onSubmit,
  onReset,
  locked = false,
}: Props) {
  const [values, setValues] = useState<PersonFormValues>({
    displayName: person?.displayName ?? '',
    username: person?.username ?? '',
    role: person?.role ?? 'taker',
    password: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<PersonFormValues>) => {
    setValues((v) => ({ ...v, ...patch }))
    setError(null)
  }
  const id = mode === 'add' ? 'person-add' : 'person-edit'
  const shows = (field: PersonField) => PERSON_FIELDS[mode].includes(field)
  // A refusal shows at the end of the scroll body, maybe under the keyboard (#159): bring it up.
  const alertRef = useRef<HTMLParagraphElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  /** Return moves to the next field instead of sending a half-filled form (#286). */
  function onReturn(field: PersonField, e: KeyboardEvent<HTMLInputElement>) {
    const next = nextPersonField(mode, field)
    if (e.key !== 'Enter' || next === null) return
    e.preventDefault()
    const refs = { displayName: nameRef, username: usernameRef, password: passwordRef }
    refs[next].current?.focus()
  }
  useEffect(() => {
    if (error) alertRef.current?.scrollIntoView({ block: 'nearest' })
  }, [error])

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      setError(await onSubmit(values))
    } catch (e) {
      setError(demoLockedMessage(e) ?? cs.login.failed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div
        data-slot="person-form-body"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-1"
      >
        <fieldset disabled={locked} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
          {locked && (
            <p className="text-meta font-bold break-words text-muted">{cs.demo.lockedNote}</p>
          )}
          <label className="grid gap-1.5">
            <span className={sectionLabelClass}>{cs.admin.displayName}</span>
            <Input
              name="displayName"
              required
              ref={nameRef}
              enterKeyHint={personEnterKeyHint(mode, 'displayName')}
              onKeyDown={(e) => {
                onReturn('displayName', e)
              }}
              maxLength={MAX_DISPLAY_NAME}
              value={values.displayName}
              onChange={(e) => {
                set({ displayName: e.target.value })
              }}
              className="font-bold"
            />
          </label>
          {shows('username') && (
            <label className="grid gap-1.5">
              <span className={sectionLabelClass}>{cs.admin.username}</span>
              <Input
                name="username"
                required
                {...plainTextField}
                ref={usernameRef}
                enterKeyHint={personEnterKeyHint(mode, 'username')}
                onKeyDown={(e) => {
                  onReturn('username', e)
                }}
                value={values.username}
                onChange={(e) => {
                  set({ username: e.target.value })
                }}
                aria-describedby={`${id}-username-hint`}
              />
              <span id={`${id}-username-hint`} className="text-meta font-bold text-muted">
                {cs.admin.usernameHint}
              </span>
            </label>
          )}
          {isSelf ? (
            <p className="text-meta font-bold text-muted">{cs.admin.selfHint}</p>
          ) : (
            <div className="grid gap-1.5">
              <span id={`${id}-role`} className={sectionLabelClass}>
                {cs.admin.role}
              </span>
              <Select
                value={values.role}
                onValueChange={(role) => {
                  set({ role: role as Role })
                }}
              >
                <SelectTrigger aria-labelledby={`${id}-role`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {cs.roles[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {shows('password') && (
            <label className="grid gap-1.5">
              <span className={sectionLabelClass}>{cs.admin.password}</span>
              <Input
                name="password"
                required
                {...plainTextField}
                ref={passwordRef}
                enterKeyHint={personEnterKeyHint(mode, 'password')}
                onKeyDown={(e) => {
                  onReturn('password', e)
                }}
                maxLength={MAX_PASSWORD_LENGTH}
                value={values.password}
                onChange={(e) => {
                  set({ password: e.target.value })
                }}
                aria-describedby={`${id}-password-hint`}
              />
              <span id={`${id}-password-hint`} className="text-meta font-bold text-muted">
                {cs.admin.startPasswordHint(MIN_USER_PASSWORD)}
              </span>
            </label>
          )}
          {mode === 'edit' && !isSelf && onReset && (
            <div className="mt-1 border-t-2 border-track pt-3">
              <Button type="button" variant="ghost" className="w-full" onClick={onReset}>
                {cs.admin.reset}
              </Button>
            </div>
          )}
          <div className="grid gap-3 pt-3">
            {error && (
              <p ref={alertRef} role="alert" className="font-bold text-state-rejected-text">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" disabled={busy} className="w-full">
              {busy ? cs.admin.saving : cs.admin.save}
            </Button>
          </div>
        </fieldset>
      </div>
    </form>
  )
}
