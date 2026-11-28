import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { Card } from '~/components/ui/card'
import { cs } from '~/lib/strings'
import { changePasswordFn } from '~/server/users/functions'
import { ChangePasswordDrawer } from './ChangePasswordDrawer'

// Profil → Heslo (#210): a row that opens the Změnit heslo sheet. Nothing while the
// `passwordChange` switch is off.

export function ProfilePassword({
  enabled,
  username,
  locked = false,
}: {
  enabled: boolean
  username: string
  /** The public demo (#328): the row shows, disabled, with the lock note; the sheet never opens. */
  locked?: boolean
}) {
  const [open, setOpen] = useState(false)
  if (!enabled) return null
  return (
    <>
      <SectionLabel>{cs.profile.passwordSection}</SectionLabel>
      <Card className="p-0">
        <button
          type="button"
          disabled={locked}
          onClick={() => {
            setOpen(true)
          }}
          className="flex min-h-tap w-full cursor-pointer items-center justify-between gap-3 rounded-card p-card text-left text-row font-extrabold disabled:cursor-default disabled:opacity-60"
        >
          {cs.profile.passwordRow}
          <ChevronRight aria-hidden="true" className="shrink-0 text-muted" />
        </button>
      </Card>
      {locked && <p className="text-meta font-bold break-words text-muted">{cs.demo.lockedNote}</p>}
      <ChangePasswordDrawer
        open={open}
        onOpenChange={setOpen}
        username={username}
        onSubmit={(data) => changePasswordFn({ data })}
        onDone={(text) => {
          setOpen(false)
          toast.success(text)
        }}
      />
    </>
  )
}
