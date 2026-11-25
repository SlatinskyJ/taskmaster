import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '~/components/ui/drawer'
import { cs } from '~/lib/strings'
import type { ChangePasswordResult } from '~/server/users/functions'
import { ChangePasswordForm } from './ChangePasswordForm'

// Bottom sheet for Profil → Změnit heslo (#210). The form is keyed by `open`, so it starts
// empty each time the sheet opens.

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  username: string
  onSubmit: (data: {
    current: string
    next: string
    logOutOthers: boolean
  }) => Promise<ChangePasswordResult>
  onDone: (toast: string) => void
}

export function ChangePasswordDrawer({ open, onOpenChange, username, onSubmit, onDone }: Props) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-describedby={undefined}>
        <DrawerHeader>
          <DrawerTitle>{cs.profile.passwordTitle}</DrawerTitle>
        </DrawerHeader>
        <ChangePasswordForm
          key={String(open)}
          username={username}
          onSubmit={onSubmit}
          onDone={onDone}
        />
      </DrawerContent>
    </Drawer>
  )
}
