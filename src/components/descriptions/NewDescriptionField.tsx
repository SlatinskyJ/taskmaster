import { sectionLabelClass } from '~/components/shell/SectionLabel'
import { Textarea } from '~/components/ui/textarea'
import { DESCRIPTION_MAX } from '~/domain/description'
import { cs } from '~/lib/strings'

// Nový úkol's optional description (#207), shown only with the `descriptions` switch on.
export function NewDescriptionField({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="grid gap-2">
      <span className={sectionLabelClass}>{cs.description.newField}</span>
      <Textarea
        name="description"
        maxLength={DESCRIPTION_MAX}
        rows={4}
        className="max-h-48 overflow-y-auto"
        value={value}
        aria-describedby="description-hint"
        onChange={(e) => {
          onChange(e.target.value)
        }}
      />
      <span id="description-hint" className="text-meta text-muted">
        {cs.description.newHint} {cs.description.count(value.length)}
      </span>
    </label>
  )
}
