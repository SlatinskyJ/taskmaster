import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { SectionLabel } from '~/components/shell/SectionLabel'
import type { Me } from '~/components/tasks/taskView'
import { Button } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import type {
  DescriptionTarget,
  WaitingDescription as Waiting,
} from '~/server/descriptions/functions'
import { descriptionToast, sheetStart } from './descriptionCalls'
import { DescriptionSheet } from './DescriptionSheet'
import { WaitingDescription } from './WaitingDescription'

// A task's or chore's description on its page (#207, spec §4): plain text with its line breaks,
// Upravit / Přidat for a parent who may change it (ruling 4), and the waiting change under it.
// Nothing at all when there is no text, no change and nothing to edit.
export function DescriptionBlock({
  text,
  change,
  target,
  canEdit,
  proposed,
  me,
}: {
  text: string | null
  change: Waiting | null
  target: DescriptionTarget
  canEdit: boolean
  /** A proposed item: a new text resets the agreements (else it waits for the brothers). */
  proposed: boolean
  me: Me
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [opens, setOpens] = useState(0)
  if (text === null && !change && !canEdit) return null
  return (
    <section data-slot="description" className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>{cs.description.label}</SectionLabel>
        {canEdit && (
          <Button
            type="button"
            variant="ghost"
            className="min-h-tap px-3 text-meta shadow-none"
            onClick={() => {
              setOpens((n) => n + 1)
              setOpen(true)
            }}
          >
            {text === null ? cs.description.add : cs.description.edit}
          </Button>
        )}
      </div>
      {text === null ? (
        <p className="text-meta text-muted">{cs.description.none}</p>
      ) : (
        <p className="break-words whitespace-pre-line">{text}</p>
      )}
      {change && <WaitingDescription change={change} target={target} inForce={text} me={me} />}
      {canEdit && (
        <DescriptionSheet
          key={opens}
          open={open}
          onOpenChange={setOpen}
          target={target}
          start={sheetStart(text, change)}
          warn={proposed ? cs.description.resetWarn : cs.description.waitWarn}
          onSaved={(outcome) => {
            setOpen(false)
            toast.success(descriptionToast(outcome))
            void router.invalidate()
          }}
        />
      )}
    </section>
  )
}
