import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '~/components/ui/drawer'
import { cs } from '~/lib/strings'
import type { PersonSummary } from '~/server/users/functions'
import type { PersonFormValues } from './PersonForm'
import { PersonForm } from './PersonForm'

// Bottom sheet for adding or editing a person on Správa (UI doc §5, §7.5). The form is keyed
// by person so it starts fresh each time the sheet opens on someone.

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'add' | 'edit'
  person?: PersonSummary
  isSelf?: boolean
  onSubmit: (values: PersonFormValues) => Promise<string | null>
  onReset?: () => void
  /** The public demo (#328): see PersonForm. */
  locked?: boolean
}

export function PersonDrawer({
  open,
  onOpenChange,
  mode,
  person,
  isSelf,
  onSubmit,
  onReset,
  locked = false,
}: Props) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-describedby={undefined}>
        <DrawerHeader>
          <DrawerTitle className="break-words">
            {mode === 'add' ? cs.admin.addTitle : (person?.displayName ?? cs.admin.editTitle)}
          </DrawerTitle>
        </DrawerHeader>
        <PersonForm
          key={`${mode}-${String(person?.id ?? 'new')}-${String(open)}`}
          mode={mode}
          person={person}
          isSelf={isSelf}
          onSubmit={onSubmit}
          onReset={onReset}
          locked={locked}
        />
      </DrawerContent>
    </Drawer>
  )
}
