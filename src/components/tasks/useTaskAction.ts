import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { burstConfetti } from '~/components/effects/confetti'
import { showFloat } from '~/components/effects/floatStore'
import { cs } from '~/lib/strings'
import { taskErrorMessage } from '~/lib/taskErrors'
import type { LifecycleActionResult, TaskActionResult } from '~/server/tasks/functions'
import type { TemplateActionResult } from '~/server/templates/functions'
import { pointsFloat } from './pointsFloat'

/**
 * One task action (work flow or bidding) from a row or the task page: busy state, toast,
 * confetti, the "+N" float, and a reload. `opts.float` is the points to float on success, over
 * the `opts.confetti` element, measured before the reload moves its row; the app-wide FloatLayer
 * shows it.
 */
export function useTaskAction() {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  async function run<R extends LifecycleActionResult | TaskActionResult | TemplateActionResult>(
    key: string,
    action: () => Promise<R>,
    success: (r: Extract<R, { ok: true }>) => string,
    opts: { confetti?: Element | null; float?: number } = {},
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
      const next = pointsFloat(result, opts)
      if (next) showFloat(next)
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
