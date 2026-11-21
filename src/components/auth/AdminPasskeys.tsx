import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import { cs, formatKeys } from '~/lib/strings'
import { removeUserPasskeysFn } from '~/server/passkeys/functions'
import { ConfirmRemove } from './ConfirmRemove'

/** A person's passkey count and the admin's remove button on Správa (#29). */
export function AdminPasskeys({
  count,
  busy,
  onRemove,
}: {
  count: number
  busy: boolean
  onRemove: () => void
}) {
  if (count === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2 pl-[54px]">
      <span className="text-meta font-bold text-muted">{formatKeys(count)}</span>
      <Button variant="no" disabled={busy} onClick={onRemove} className="ml-auto">
        {cs.passkeys.admin.removeAll}
      </Button>
    </div>
  )
}

/** `AdminPasskeys` with its confirm and the server call: one line on a Správa person row. */
export function AdminPasskeysControl({
  userId,
  name,
  count,
}: {
  userId: number
  name: string
  count: number
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  async function remove() {
    setBusy(true)
    try {
      await removeUserPasskeysFn({ data: { userId } })
      toast.success(cs.passkeys.admin.removed)
    } catch {
      toast.error(cs.login.failed)
    } finally {
      setBusy(false)
      setConfirming(false)
      await router.invalidate()
    }
  }

  return (
    <>
      <AdminPasskeys
        count={count}
        busy={busy}
        onRemove={() => {
          setConfirming(true)
        }}
      />
      <ConfirmRemove
        title={confirming ? cs.passkeys.admin.confirmTitle(name) : null}
        text={cs.passkeys.admin.confirmText}
        confirm={cs.passkeys.admin.removeAll}
        busy={busy}
        onConfirm={() => void remove()}
        onClose={() => {
          setConfirming(false)
        }}
      />
    </>
  )
}
