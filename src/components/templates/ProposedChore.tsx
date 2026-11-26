import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import type { Me } from '~/components/tasks/taskView'
import { Button } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import type { TemplateView } from '~/server/templates/functions'
import { approveOutcome, approveTemplate } from './actions'

interface Person {
  id: number
  name: string
}

/** "Čeká se na: tebe nebo Mladší": any one of them completes their side (spec §3). */
export function choreWaitingText(waitingFor: readonly Person[], me: Me): string | null {
  if (waitingFor.length === 0) return null
  const who = waitingFor.map((p) => (p.id === me.id ? cs.bids.youAcc : p.name))
  return `${cs.bids.waitingFor}: ${who.join(` ${cs.bids.or} `)}`
}

/**
 * Souhlasím on a proposed chore's page (#205), for someone it waits for. The same call, toast
 * and reload as the Domů row (WaitingForYou).
 */
export function AgreeToChore({ template }: { template: Pick<TemplateView, 'id' | 'score'> }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  return (
    <Button
      variant="ok"
      className="w-full"
      disabled={busy}
      aria-busy={busy}
      onClick={() => {
        setBusy(true)
        void (async () => {
          try {
            const outcome = approveOutcome(
              await approveTemplate(template).catch(() => 'threw' as const),
            )
            if (outcome.toast === 'success') toast.success(outcome.message)
            else toast.error(outcome.message)
            await router.invalidate()
          } finally {
            setBusy(false)
          }
        })()
      }}
    >
      {busy ? cs.tasks.approving : cs.tasks.approve}
    </Button>
  )
}
