import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { formatPragueDate } from '~/lib/formatDate'
import {
  addPasskey,
  setThisDevicePasskey,
  usePasskeysUsable,
  useThisDevicePasskey,
} from '~/lib/passkeys'
import { cs } from '~/lib/strings'
import { removeMyPasskeyFn, type PasskeySummary } from '~/server/passkeys/functions'
import { ConfirmRemove } from './ConfirmRemove'
import { PasskeyList } from './PasskeyList'

/**
 * Profil's passkey section (UI doc §7.4, #29). Shown when this deployment has passkeys and
 * this browser can add one, or when there are passkeys to remove (any browser).
 */
export function ProfilePasskeys({
  enabled,
  items,
}: {
  enabled: boolean
  items: readonly PasskeySummary[]
}) {
  const router = useRouter()
  const hereId = useThisDevicePasskey()
  const hereListed = items.some((p) => p.id === hereId)
  const canAdd = usePasskeysUsable() && enabled
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<PasskeySummary | null>(null)
  const [busy, setBusy] = useState(false)

  if (!canAdd && items.length === 0) return null

  async function add() {
    setAdding(true)
    try {
      const outcome = await addPasskey()
      if (outcome.ok) toast.success(cs.passkeys.added)
      else if (outcome.reason === 'already') toast(cs.passkeys.already)
      else if (outcome.reason === 'failed') toast.error(cs.login.failed)
      await router.invalidate()
    } finally {
      setAdding(false)
    }
  }

  async function remove(item: PasskeySummary) {
    setBusy(true)
    try {
      const result = await removeMyPasskeyFn({ data: { passkeyId: item.id } })
      if (result.ok) {
        if (item.id === hereId) setThisDevicePasskey(null)
        toast.success(cs.passkeys.removed)
      } else toast.error(cs.login.failed)
    } catch {
      toast.error(cs.login.failed)
    } finally {
      setBusy(false)
      setRemoving(null)
      await router.invalidate()
    }
  }

  return (
    <>
      <SectionLabel>{cs.passkeys.section}</SectionLabel>
      <Card className="grid gap-3">
        <PasskeyList
          items={items}
          hereId={hereId}
          busyId={busy ? (removing?.id ?? null) : null}
          onRemove={setRemoving}
        />
        {canAdd && !hereListed && (
          <Button variant="ghost" disabled={adding} onClick={() => void add()} className="w-full">
            {cs.passkeys.addHere}
          </Button>
        )}
      </Card>
      <ConfirmRemove
        title={
          removing
            ? cs.passkeys.removeConfirmTitle(
                cs.passkeys.device[removing.deviceKind],
                formatPragueDate(removing.createdAt),
              )
            : null
        }
        text={cs.passkeys.removeConfirmText}
        confirm={cs.passkeys.remove}
        busy={busy}
        onConfirm={() => {
          if (removing) void remove(removing)
        }}
        onClose={() => {
          setRemoving(null)
        }}
      />
    </>
  )
}
