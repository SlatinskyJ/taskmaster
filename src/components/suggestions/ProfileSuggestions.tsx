import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { cs } from '~/lib/strings'
import type { MySuggestion } from '~/server/suggestions/functions'
import { MySuggestions } from './MySuggestions'
import { SuggestDrawer } from './SuggestDrawer'

// Profil → Nápady na zlepšení (#247, spec §5.13): a row that opens the Navrhnout zlepšení sheet,
// then Moje návrhy. For every role. Nothing while the `suggestions` switch is off.

const t = cs.suggestions

/** What the loader gives the section: the list, the switch off (no section), or a failed fetch. */
export type MineData = MySuggestion[] | { error: 'feature_off' } | { error: 'load' }

/** The loader's step: a fetch that throws becomes the retry state, not a broken Profil. */
export async function loadMine(
  call: () => Promise<MySuggestion[] | { error: 'feature_off' }>,
): Promise<MineData> {
  try {
    return await call()
  } catch {
    return { error: 'load' }
  }
}

export function ProfileSuggestions({
  enabled,
  data,
  onReload,
}: {
  enabled: boolean
  data: MineData
  /** Loads Profil again (after a send, or Zkusit znovu). */
  onReload: () => unknown
}) {
  const [open, setOpen] = useState(false)
  if (!enabled || ('error' in data && data.error === 'feature_off')) return null
  return (
    <>
      <SectionLabel>{t.section}</SectionLabel>
      <Card className="p-0">
        <button
          type="button"
          onClick={() => {
            setOpen(true)
          }}
          className="flex min-h-tap w-full cursor-pointer items-center justify-between gap-3 rounded-card p-card text-left text-row font-extrabold"
        >
          {t.row}
          <ChevronRight aria-hidden="true" className="shrink-0 text-muted" />
        </button>
      </Card>
      <SuggestDrawer
        open={open}
        onOpenChange={setOpen}
        onSent={() => {
          setOpen(false)
          toast.success(t.sent)
          void onReload()
        }}
      />
      <SectionLabel>{t.mine}</SectionLabel>
      {Array.isArray(data) ? (
        <MySuggestions items={data} />
      ) : (
        <div className="grid gap-2 rounded-card bg-surface p-3 shadow-sticker">
          <p role="alert" className="font-bold text-state-rejected-text">
            {t.loadError}
          </p>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              void onReload()
            }}
          >
            {t.retry}
          </Button>
        </div>
      )}
    </>
  )
}
