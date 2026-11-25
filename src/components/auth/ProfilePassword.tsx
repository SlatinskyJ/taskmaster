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

export function ProfilePassword({ enabled, username }: { enabled: boolean; username: string }) {
  const [open, setOpen] = useState(false)
  if (!enabled) return null
  return (
    <>
      <SectionLabel>{cs.profile.passwordSection}</SectionLabel>
      <Card className="p-0">
        <button
          type="button"
          onClick={() => {
            setOpen(true)
          }}
          className="flex min-h-tap w-full cursor-pointer items-center justify-between gap-3 rounded-card p-card text-left text-row font-extrabold"
        >
          {cs.profile.passwordRow}
          <ChevronRight aria-hidden="true" className="shrink-0 text-muted" />
        </button>
      </Card>
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
