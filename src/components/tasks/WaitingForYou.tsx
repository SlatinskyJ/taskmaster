import { Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { approveOutcome, approveTemplate } from '~/components/templates/actions'
import { myTemplateBid, priceMeta, templateChip } from '~/components/templates/priceView'
import { Button, buttonVariants } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import { cn } from '~/lib/utils'
import { templateDetail } from '~/lib/templateText'
import type { DescriptionWaitingRow } from '~/server/descriptions/functions'
import type { ProposalKind } from '~/server/periods/functions'
import type { TaskView } from '~/server/tasks/functions'
import type { TemplateView } from '~/server/templates/functions'
import { callBid } from './bidCalls'
import type { Me } from './taskView'
import { bidButtons, myBid, taskChipState, toastFor, waitingMeta } from './taskView'
import { taskLink, templateLink } from './rowLink'
import { TaskRow } from './TaskRow'
import type { RowLink } from './rowLink'
import { useTaskAction } from './useTaskAction'

const targetLink = (t: DescriptionWaitingRow['target']): RowLink =>
  t.kind === 'task' ? taskLink(t.id) : templateLink(t.id)

/**
 * "Čeká na tebe" (UI doc §6 [call]: always at the top of Domů): new task offers and new
 * recurring templates waiting for this person's approval (TApprove, spec §5.1, §5.2 path 1).
 * A template row shows its whole schedule, deadline and who agreed, so nobody agrees to a score
 * without seeing what it is for. Renders nothing when nothing waits.
 * A task row stays short and the task page explains (#34): without my bid, "Souhlasím" and a
 * link "Jiná cena" to the page; with my bid only "Otevřít", because picking between "Beru" and
 * "Souhlasím" needs both hints, which a row has no room for.
 * A price change of an agreed template (#138) waiting for this person's side links to its page;
 * so does a new price of an agreed one-time task waiting for this person (#36), and a new
 * description waiting for his OK (#207 ruling 6). A proposed item with a description links to its
 * page ("Přečíst a souhlasit", a full-width line under the row so the name keeps its width)
 * instead of Souhlasím, so he reads the text first (ruling 1, Jakub 2026-11-26).
 */
export function WaitingForYou({
  items,
  templates = [],
  priceChanges,
  taskPriceChanges,
  descriptionChanges,
  proposals = [],
  me,
  links = false,
}: {
  items: readonly TaskView[]
  templates?: readonly TemplateView[]
  /** Required, so a screen can't forget it: price changes waiting for this person's side. */
  priceChanges: readonly TemplateView[]
  /** Required too: one-time tasks whose new price waits for this person (#36). */
  taskPriceChanges: readonly TaskView[]
  /** Required too: description changes waiting for this brother's OK (#207). */
  descriptionChanges: readonly DescriptionWaitingRow[]
  /** Proposals for next week or the default week waiting for this person (#43). */
  proposals?: readonly ProposalKind[]
  me: Me
  /** The `openRows` switch (#205): each row opens its page. */
  links?: boolean
}) {
  const router = useRouter()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const action = useTaskAction()
  const anyBusy = busyKey !== null || action.busy !== null
  const count =
    items.length +
    templates.length +
    priceChanges.length +
    taskPriceChanges.length +
    descriptionChanges.length +
    proposals.length
  if (count === 0) return null

  async function approve(
    key: string,
    call: () => Promise<{ ok: true } | { ok: false; error: string }>,
  ) {
    setBusyKey(key)
    try {
      const outcome = approveOutcome(await call().catch(() => 'threw' as const))
      if (outcome.toast === 'success') toast.success(outcome.message)
      else toast.error(outcome.message)
      await router.invalidate()
    } finally {
      setBusyKey(null)
    }
  }

  function approveButton(
    key: string,
    call: () => Promise<{ ok: true } | { ok: false; error: string }>,
  ) {
    return (
      <Button
        variant="ok"
        disabled={anyBusy}
        aria-busy={busyKey === key}
        onClick={() => {
          void approve(key, call)
        }}
      >
        {busyKey === key ? cs.tasks.approving : cs.tasks.approve}
      </Button>
    )
  }

  function answerLink(t: TemplateView, label: string, wide = false) {
    return (
      <Link
        to="/sablona/$templateId"
        params={{ templateId: String(t.id) }}
        className={cn(buttonVariants({ variant: 'ghost' }), wide && 'w-full')}
      >
        {label}
      </Link>
    )
  }

  /**
   * A proposed chore's approval: Souhlasím, and with first-price bidding (#209) a way to the
   * page like a Návrh: Jiná cena next to it, or only Otevřít once he has a bid.
   */
  function templateActions(t: TemplateView) {
    const key = `template-${String(t.id)}`
    const yes = approveButton(key, () => approveTemplate(t))
    if (!t.bidding) return yes
    if (myTemplateBid(t, me) !== null) return answerLink(t, cs.bids.open)
    return (
      <div className="flex flex-col items-stretch gap-1.5">
        {yes}
        {answerLink(t, cs.bids.otherPriceShort)}
      </div>
    )
  }

  function pageLink(task: TaskView, label: string, wide = false) {
    return (
      <Link
        to="/ukol/$taskId"
        params={{ taskId: String(task.id) }}
        className={cn(buttonVariants({ variant: 'ghost' }), wide && 'w-full')}
      >
        {label}
      </Link>
    )
  }

  function taskActions(task: TaskView) {
    const approve = bidButtons(task, me).find((b) => b.key === 'approve')
    if (myBid(task, me) !== null || !approve) return pageLink(task, cs.bids.open)
    const key = `task-${String(task.id)}`
    return (
      <div className="flex flex-col items-stretch gap-1.5">
        <Button
          variant="ok"
          disabled={anyBusy}
          aria-busy={action.busy === key}
          onClick={() => {
            void action.run(
              key,
              () => callBid(approve),
              (r) => toastFor(approve, r.status, me, false),
            )
          }}
        >
          {action.busy === key ? cs.tasks.approving : approve.label}
        </Button>
        {pageLink(task, cs.bids.otherPriceShort)}
      </div>
    )
  }

  return (
    <section className="grid gap-2" aria-labelledby="waiting-label">
      <SectionLabel id="waiting-label">
        {cs.home.waiting} ({count})
      </SectionLabel>
      <ul className="grid gap-2">
        {items.map((task) => (
          <li key={`task-${String(task.id)}`}>
            <TaskRow
              described={task.description !== null}
              name={task.title}
              state={taskChipState(task)}
              points={task.score}
              meta={waitingMeta(task, me)}
              action={task.description === null ? taskActions(task) : undefined}
              footer={
                task.description === null
                  ? undefined
                  : pageLink(task, cs.description.readAndAgree, true)
              }
              link={links ? taskLink(task.id) : undefined}
            />
          </li>
        ))}
        {templates.map((t) => (
          <li key={`template-${String(t.id)}`}>
            <TaskRow
              described={t.description !== null}
              name={t.title}
              state={templateChip(t).state}
              points={t.score}
              meta={(t.bidding && priceMeta(t, me)) ?? cs.templates.recurringMeta}
              detail={templateDetail(t)}
              action={t.description === null ? templateActions(t) : undefined}
              footer={
                t.description === null
                  ? undefined
                  : answerLink(t, cs.description.readAndAgree, true)
              }
              link={links ? templateLink(t.id) : undefined}
            />
          </li>
        ))}
        {priceChanges.map((t) => (
          <li key={`price-${String(t.id)}`}>
            <TaskRow
              described={t.description !== null}
              name={t.title}
              state="negotiating"
              points={t.score}
              meta={priceMeta(t, me)}
              action={answerLink(t, cs.bids.answer)}
              link={links ? templateLink(t.id) : undefined}
            />
          </li>
        ))}
        {taskPriceChanges.map((t) => (
          <li key={`task-price-${String(t.id)}`}>
            <TaskRow
              described={t.description !== null}
              name={t.title}
              state="negotiating"
              points={t.score}
              meta={cs.taskPrice.rowMeta(t.score, t.scoreChange?.score ?? t.score)}
              action={pageLink(t, cs.bids.answer)}
              link={links ? taskLink(t.id) : undefined}
            />
          </li>
        ))}
        {descriptionChanges.map((c) => (
          <li key={`description-${c.target.kind}-${String(c.target.id)}`}>
            <TaskRow
              name={c.name}
              state="negotiating"
              points={c.score}
              meta={cs.description.homeRow}
              described
              action={
                <Link {...targetLink(c.target)} className={buttonVariants({ variant: 'ghost' })}>
                  {cs.bids.answer}
                </Link>
              }
              link={links ? targetLink(c.target) : undefined}
            />
          </li>
        ))}
        {proposals.map((kind) => (
          <li key={`proposal-${kind}`}>
            <div
              data-slot="proposal-row"
              className="flex min-h-tap items-center gap-3 rounded-card border-l-4 border-l-state-proposed bg-surface py-2.5 pr-2.5 pl-3 shadow-sticker"
            >
              <span className="min-w-0 flex-1 text-row font-bold break-words">
                {kind === 'period' ? cs.proposals.entry.periodRow : cs.proposals.entry.defaultsRow}
              </span>
              <Link to="/tyden/pristi" className={buttonVariants({ variant: 'ghost' })}>
                {cs.proposals.entry.open}
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
