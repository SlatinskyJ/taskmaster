import { SectionLabel } from '~/components/shell/SectionLabel'
import { SwitchRow } from '~/components/shell/SwitchRow'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import type { FeatureKey, Features } from '~/lib/features'
import { cs } from '~/lib/strings'
import { switchRows } from './featureSwitch'

// Funkce on Správa (#296, spec §6): every launch switch with its state. A tap asks the page to
// confirm (the page holds the dialog and the call). Pure: no hooks.

const t = cs.admin.features

export function FeaturesCard({
  features,
  failed,
  locked = false,
  onToggle,
  onRetry,
}: {
  features: Features | null
  failed: boolean
  /** The public demo (#328): the switches show, disabled, with the lock note. */
  locked?: boolean
  onToggle: (key: FeatureKey, turnOn: boolean) => void
  onRetry: () => void
}) {
  return (
    <section className="mt-3.5 grid gap-2" aria-labelledby="admin-features-label">
      <SectionLabel id="admin-features-label">{t.title}</SectionLabel>
      {failed || !features ? (
        <Card className="grid gap-2">
          <p role="alert" className="font-bold text-state-rejected-text">
            {t.failedLoad}
          </p>
          <Button type="button" variant="ghost" onClick={onRetry}>
            {t.retry}
          </Button>
        </Card>
      ) : (
        <>
          <Card className="grid p-0">
            {switchRows(features).map((row) => (
              <SwitchRow
                key={row.key}
                id={`feature-${row.key}`}
                label={row.name}
                hint={`${row.hint} · ${row.on ? t.on : t.off}`}
                checked={row.on}
                disabled={locked}
                onToggle={() => {
                  onToggle(row.key, !row.on)
                }}
              />
            ))}
          </Card>
          {locked ? (
            <p className="text-meta font-bold break-words text-muted">{cs.demo.lockedNote}</p>
          ) : (
            <p className="text-meta font-bold text-muted">{t.note}</p>
          )}
        </>
      )}
    </section>
  )
}
