import { createFileRoute, useRouter } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { DefaultWeekCard } from '~/components/admin/DefaultWeekCard'
import { DismissDialog } from '~/components/admin/DismissDialog'
import { dismissInput, DisputesCard, loadAdminDisputes } from '~/components/admin/DisputesCard'
import { afterFix, draftKey, FixCard, fixStartOf, loadFixable } from '~/components/admin/FixCard'
import { FixDrawer } from '~/components/admin/FixDrawer'
import { CloseSuggestionDialog } from '~/components/admin/CloseSuggestionDialog'
import type { CloseMove } from '~/components/admin/CloseSuggestionDialog'
import { SendSuggestionDrawer } from '~/components/admin/SendSuggestionDrawer'
import type { SendOutcome } from '~/components/admin/SendSuggestionDrawer'
import { loadAdminSuggestions, SuggestionsCard } from '~/components/admin/SuggestionsCard'
import { sendClose, sendIssue } from '~/components/suggestions/suggestionForms'
import type { FixStart } from '~/components/admin/fixDraft'
import { sendDismiss } from '~/components/disputes/disputeCalls'
import { adminDisputeLines } from '~/components/disputes/disputeProps'
import type { PersonFormValues } from '~/components/admin/PersonForm'
import { PersonDrawer } from '~/components/admin/PersonDrawer'
import { ResetPasswordDialog } from '~/components/admin/ResetPasswordDialog'
import { AdminPasskeysControl } from '~/components/auth/AdminPasskeys'
import { Avatar } from '~/components/shell/Avatar'
import { Screen } from '~/components/shell/Screen'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'
import { userErrorMessage } from '~/lib/userErrors'
import type { PeriodDefaults } from '~/domain'
import type { AdminOutcome } from '~/components/disputes/disputeCalls'
import { getFixableFn } from '~/server/corrections/functions'
import type { AdminDisputeEntry } from '~/server/disputes/functions'
import { dismissDisputeFn, getAdminDisputesFn } from '~/server/disputes/functions'
import { listPasskeyCountsFn } from '~/server/passkeys/functions'
import { getPeriodDefaultsFn, savePeriodDefaultsFn } from '~/server/periods/functions'
import type { AdminSuggestion } from '~/server/suggestions/functions'
import {
  closeSuggestionFn,
  getAdminSuggestionsFn,
  sendSuggestionFn,
} from '~/server/suggestions/functions'
import type { PersonSummary } from '~/server/users/functions'
import { createUserFn, listUsersFn, resetPasswordFn, updateUserFn } from '~/server/users/functions'

// Správa, the admin's only screen, no bottom bar (UI doc §6, §7.5). Others go to their landing.
// People (#134): add, rename, change role, reset password. No deactivation (Jakub 2026-11-17).
// The list is never empty: the admin is always in it. Výchozí týden (#47, spec §5.8): the
// admin edits the default week directly. Sporné (#47, spec §5.11): the open disputes, first,
// each kept with a note or fixed (Opravit, #48); Opravy bodů (#48, spec §5.9): the admin adds
// or takes points, or corrects a settled week, directly. Both hidden while the `disputes`
// switch is off. Návrhy (#247, spec §5.13): everyone's suggestions, closed or sent to GitHub;
// hidden while the `suggestions` switch is off.
export const Route = createFileRoute('/_app/sprava')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/sprava')
  },
  loader: async () => {
    const [people, passkeys, defaults, disputes, fixable, suggestions] = await Promise.all([
      listUsersFn(),
      listPasskeyCountsFn(),
      getPeriodDefaultsFn(),
      loadAdminDisputes(() => getAdminDisputesFn()),
      loadFixable(() => getFixableFn()),
      loadAdminSuggestions(() => getAdminSuggestionsFn()),
    ])
    return { people, passkeys, defaults, disputes, fixable, suggestions }
  },
  component: Sprava,
})

type Sheet = { mode: 'add' } | { mode: 'edit'; person: PersonSummary } | null

function Sprava() {
  const { user } = Route.useRouteContext()
  const { people, passkeys, defaults, disputes, fixable, suggestions } = Route.useLoaderData()
  const router = useRouter()
  const [sheet, setSheet] = useState<Sheet>(null)
  // Kept apart from `sheet` so the drawer can close while its last content fades out.
  const [sheetOpen, setSheetOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [keeping, setKeeping] = useState<AdminDisputeEntry | null>(null)
  const [keepOpen, setKeepOpen] = useState(false)
  const [fixing, setFixing] = useState<FixStart | null>(null)
  const [fixOpen, setFixOpen] = useState(false)
  // Each opening starts a fresh sheet (its reason comes from `drafts`).
  const [fixOpenings, setFixOpenings] = useState(0)
  // The typed reasons, per sheet: a reload after a stale row keeps them.
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [closing, setClosing] = useState<{ item: AdminSuggestion; move: CloseMove } | null>(null)
  const [closeOpen, setCloseOpen] = useState(false)
  const [sending, setSending] = useState<AdminSuggestion | null>(null)
  const [sendOpen, setSendOpen] = useState(false)
  const editing = sheet?.mode === 'edit' ? sheet.person : undefined

  function open(next: Exclude<Sheet, null>) {
    setSheet(next)
    setSheetOpen(true)
  }

  async function done(message: string) {
    toast.success(message)
    setResetOpen(false)
    setSheetOpen(false)
    await router.invalidate()
  }

  async function save(values: PersonFormValues): Promise<string | null> {
    if (sheet?.mode === 'add') {
      const r = await createUserFn({ data: values })
      if (!r.ok) return userErrorMessage(r.error)
      await done(cs.admin.added)
      return null
    }
    if (!editing) return null
    const self = editing.id === user.id
    const r = await updateUserFn({
      data: self
        ? { userId: editing.id, displayName: values.displayName }
        : { userId: editing.id, displayName: values.displayName, role: values.role },
    })
    if (!r.ok) return userErrorMessage(r.error)
    await done(cs.admin.saved)
    return null
  }

  async function reset(password: string): Promise<string | null> {
    if (!editing) return null
    const r = await resetPasswordFn({ data: { userId: editing.id, password } })
    if (!r.ok) return userErrorMessage(r.error)
    await done(cs.admin.resetDone)
    return null
  }

  async function saveDefaults(next: PeriodDefaults): Promise<string | null> {
    const r = await savePeriodDefaultsFn({ data: next })
    if (!r.ok) return r.error
    toast.success(cs.admin.saved)
    await router.invalidate()
    return null
  }

  const showDisputes = !('error' in disputes && disputes.error === 'feature_off')
  const showFix = !('error' in fixable && fixable.error === 'feature_off')
  const fixTakers = Array.isArray(fixable) ? fixable : []

  function openFix(start: FixStart) {
    setFixing(start)
    setFixOpenings((n) => n + 1)
    setFixOpen(true)
  }

  async function fixDone(start: FixStart, outcome: AdminOutcome) {
    setFixOpen(false)
    setDrafts((d) => afterFix(d, draftKey(start), outcome))
    if (outcome.ok) toast.success(cs.admin.fix.done)
    else toast.error(outcome.message)
    await router.invalidate()
  }

  async function sendSettled(outcome: SendOutcome) {
    if ('notSaved' in outcome) {
      // The issue exists: the sheet stays with its link, the list catches up.
      await router.invalidate()
      return
    }
    setSendOpen(false)
    if (outcome.ok) toast.success(cs.suggestions.sentToast)
    else toast.error(outcome.message)
    await router.invalidate()
  }

  return (
    <Screen title={cs.admin.title} user={user}>
      {showDisputes && (
        <DisputesCard
          data={'error' in disputes ? { error: 'load' } : disputes}
          onKeep={(entry) => {
            setKeeping(entry)
            setKeepOpen(true)
          }}
          onFix={(entry) => {
            openFix(fixStartOf(entry))
          }}
          onRetry={() => {
            void router.invalidate()
          }}
        />
      )}
      <DismissDialog
        lines={keeping ? adminDisputeLines(keeping) : null}
        open={keepOpen}
        onOpenChange={setKeepOpen}
        onConfirm={(note) =>
          keeping
            ? sendDismiss(dismissDisputeFn, dismissInput(keeping, note))
            : Promise.resolve({ ok: true as const })
        }
        onDone={async (outcome) => {
          setKeepOpen(false)
          if (outcome.ok) toast.success(cs.admin.disputes.done)
          else toast.error(outcome.message)
          await router.invalidate()
        }}
      />
      <SuggestionsCard
        data={suggestions}
        onClose={(item, move) => {
          setClosing({ item, move })
          setCloseOpen(true)
        }}
        onSend={(item) => {
          setSending(item)
          setSendOpen(true)
        }}
        onRetry={() => {
          void router.invalidate()
        }}
      />
      <CloseSuggestionDialog
        move={closing?.move ?? null}
        open={closeOpen}
        onOpenChange={setCloseOpen}
        onConfirm={() =>
          closing
            ? sendClose(closeSuggestionFn, { id: closing.item.id, move: closing.move })
            : Promise.resolve({ ok: true as const })
        }
        onDone={async (outcome) => {
          setCloseOpen(false)
          if (outcome.ok) toast.success(cs.admin.saved)
          else toast.error(outcome.message)
          await router.invalidate()
        }}
      />
      <SendSuggestionDrawer
        item={sending}
        canSend={'canSend' in suggestions && suggestions.canSend}
        open={sendOpen}
        onOpenChange={setSendOpen}
        onSend={(input) => sendIssue(sendSuggestionFn, input)}
        onSettled={sendSettled}
      />
      {showFix && (
        <FixCard
          failed={!Array.isArray(fixable)}
          onAdjust={() => {
            openFix({ mode: 'points', takerId: null, dispute: null })
          }}
          onCorrect={() => {
            openFix({ mode: 'week', takerId: null, settlementId: null, dispute: null })
          }}
          onRetry={() => {
            void router.invalidate()
          }}
        />
      )}
      {fixing && (
        <FixDrawer
          key={fixOpenings}
          open={fixOpen}
          onOpenChange={setFixOpen}
          start={fixing}
          fixable={fixTakers}
          reason={drafts[draftKey(fixing)] ?? ''}
          onReason={(reason) => {
            setDrafts((d) => ({ ...d, [draftKey(fixing)]: reason }))
          }}
          onDone={(outcome) => void fixDone(fixing, outcome)}
        />
      )}
      <DefaultWeekCard defaults={defaults} onSave={saveDefaults} />
      <SectionLabel className="mt-3.5">{cs.admin.people}</SectionLabel>
      <Card>
        <ul className="grid gap-1">
          {people.map((p) => {
            const self = p.id === user.id
            return (
              <li key={p.id} className="grid gap-1">
                <button
                  type="button"
                  aria-label={cs.admin.editPerson(p.displayName)}
                  onClick={() => {
                    open({ mode: 'edit', person: p })
                  }}
                  className="flex min-h-tap w-full cursor-pointer items-center gap-2.5 rounded-button text-left"
                >
                  <Avatar userId={p.id} name={p.displayName} />
                  <span className="grid min-w-0 flex-1">
                    <b className="font-extrabold break-words">
                      {p.displayName}
                      {self && <span className="font-bold text-muted"> ({cs.admin.you})</span>}
                    </b>
                    <span className="truncate text-meta font-bold text-muted">{p.username}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-track px-2 py-0.5 text-xs font-extrabold text-muted">
                    {cs.roles[p.role]}
                  </span>
                  <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted" />
                </button>
                <AdminPasskeysControl
                  userId={p.id}
                  name={p.displayName}
                  count={passkeys[p.id] ?? 0}
                />
              </li>
            )
          })}
        </ul>
      </Card>
      <Button
        size="lg"
        className="mt-3.5 w-full"
        onClick={() => {
          open({ mode: 'add' })
        }}
      >
        {cs.admin.add}
      </Button>
      <PersonDrawer
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        mode={sheet?.mode ?? 'add'}
        person={editing}
        isSelf={editing?.id === user.id}
        onSubmit={save}
        onReset={() => {
          setResetOpen(true)
        }}
      />
      {editing && (
        <ResetPasswordDialog
          name={editing.displayName}
          open={resetOpen}
          onOpenChange={setResetOpen}
          onSubmit={reset}
        />
      )}
    </Screen>
  )
}
