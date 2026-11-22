import { weekLabel } from '~/components/period/periodView'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { cs } from '~/lib/strings'
import type { DisputeListEntry } from '~/server/disputes/functions'
import { DisputeOutcome } from './DisputeOutcome'

// Rozporováno (#46): the viewer's disputes on Týden → Historie, so an outcome
// stays visible after its week. Nothing when there are none.
export function DisputeList({ entries }: { entries: readonly DisputeListEntry[] }) {
  if (entries.length === 0) return null
  return (
    <section className="mb-3.5 grid gap-2" aria-labelledby="disputes-label">
      <SectionLabel id="disputes-label">{cs.disputes.list}</SectionLabel>
      <ul className="grid gap-2">
        {entries.map((e) => (
          <li
            key={e.id}
            data-dispute={e.id}
            className="grid gap-1 rounded-card border-l-4 border-l-state-disputed bg-surface py-2.5 pr-2.5 pl-3 shadow-sticker"
          >
            <span className="text-meta font-bold text-muted">{cs.disputes.what[e.item.kind]}</span>
            <span className="text-row font-bold break-words">
              {e.week ? weekLabel(e.week.startsAt, e.week.endsAt) : e.title}
              {/* The boy's name once: the opened-by line below names him when he opened it. */}
              {e.takerName && e.takerName !== e.openedByName && (
                <span className="font-bold text-muted"> · {e.takerName}</span>
              )}
            </span>
            <span className="text-meta break-words text-muted">
              {cs.disputes.openedBy(e.openedByName, e.reason)}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <DisputeOutcome mark={e.mark} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
