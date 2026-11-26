import { useState } from 'react'
import { Button } from '~/components/ui/button'
import type { DemoLogin, SizeKey } from '~/lib/multiLayout'
import { cs } from '~/lib/strings'
import { SizeSelect, UserSelect } from './DeviceFrame'

// Přidat zařízení on /dev/multi: pick a user and a size, then Přidat. Inline under the
// toolbar rather than a popover; the new device opens at /.

const t = cs.devMulti

export function AddDevice({
  onAdd,
  onCancel,
}: {
  onAdd: (user: DemoLogin, size: SizeKey) => void
  onCancel: () => void
}) {
  const [user, setUser] = useState<DemoLogin>('tata')
  const [size, setSize] = useState<SizeKey>('phone')
  return (
    <div
      role="group"
      aria-label={t.add}
      className="flex max-w-[480px] flex-wrap items-center gap-2 rounded-card border-2 border-track bg-surface p-3"
    >
      <UserSelect value={user} onChange={setUser} />
      <SizeSelect value={size} onChange={setSize} />
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button
          onClick={() => {
            onAdd(user, size)
          }}
        >
          {t.confirmAdd}
        </Button>
      </div>
    </div>
  )
}
