import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { burstConfetti } from '~/components/effects/confetti'
import { cs } from '~/lib/strings'
import { taskErrorMessage } from '~/lib/taskErrors'
import type { LifecycleActionResult, TaskActionResult } from '~/server/tasks/functions'
import type { TemplateActionResult } from '~/server/templates/functions'

/** One task action (work flow or bidding) from a row or the task page: busy state, toast, confetti, and a reload. */
export function useTaskAction() {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  async function run<R extends LifecycleActionResult | TaskActionResult | TemplateActionResult>(
    key: string,
    action: () => Promise<R>,
    success: (r: Extract<R, { ok: true }>) => string,
    opts: { confetti?: Element | null } = {},
  ): Promise<boolean> {
    setBusy(key)
    try {
      const result = await action()
      if (!result.ok) {
        toast.error(taskErrorMessage(result.error))
        await router.invalidate()
        return false
      }
      toast.success(success(result as Extract<R, { ok: true }>))
      if (opts.confetti !== undefined) burstConfetti(opts.confetti)
      await router.invalidate()
      return true
    } catch {
      toast.error(cs.login.failed)
      return false
    } finally {
      setBusy(null)
    }
  }

  return { busy, run }
}
