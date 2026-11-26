import { Download, Share } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '~/components/ui/drawer'
import { cs } from '~/lib/strings'
import { getInstallMode, installApp, subscribeInstall, type InstallMode } from '~/pwa/install'

// Profil → Aplikace (#302, spec §11 PWA): the browser's install prompt where there is one,
// three steps on iPhone and iPad, nothing when already installed or not installable.
// The server render is hidden; the browser's mode arrives after hydration.

export function ProfileInstall() {
  const mode = useSyncExternalStore(subscribeInstall, getInstallMode, () => 'hidden' as const)
  const [busy, setBusy] = useState(false)
  const [stepsOpen, setStepsOpen] = useState(false)

  function onInstall() {
    if (mode === 'ios') {
      setStepsOpen(true)
      return
    }
    setBusy(true)
    void installApp().finally(() => {
      setBusy(false)
    })
  }

  return (
    <>
      <InstallSection mode={mode} busy={busy} onInstall={onInstall} />
      <IosSteps open={stepsOpen} onOpenChange={setStepsOpen} />
    </>
  )
}

export function InstallSection({
  mode,
  busy = false,
  onInstall,
}: {
  mode: InstallMode
  busy?: boolean
  onInstall: () => void
}) {
  if (mode === 'hidden') return null
  return (
    <>
      <SectionLabel>{cs.profile.installSection}</SectionLabel>
      <Card className="p-0">
        <button
          type="button"
          disabled={busy}
          aria-describedby="install-hint"
          onClick={onInstall}
          className="flex min-h-tap w-full cursor-pointer items-center gap-3 rounded-card p-card text-left disabled:cursor-default disabled:opacity-50"
        >
          <Download aria-hidden="true" className="shrink-0 text-muted" />
          <span className="grid flex-1">
            <b className="text-row font-extrabold">{cs.profile.installButton}</b>
            <span id="install-hint" className="text-meta font-bold text-muted">
              {cs.profile.installHint}
            </span>
          </span>
        </button>
      </Card>
    </>
  )
}

function IosSteps({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-describedby={undefined}>
        <DrawerHeader>
          <DrawerTitle>{cs.profile.installIosTitle}</DrawerTitle>
        </DrawerHeader>
        <ol className="grid list-decimal gap-2 pl-6 text-row font-bold">
          {cs.profile.installIosSteps.map((step, i) => (
            <li key={step}>
              {step}
              {i === 0 && (
                <Share aria-hidden="true" className="ml-1.5 inline size-5 align-text-bottom" />
              )}
            </li>
          ))}
        </ol>
        <DrawerFooter>
          <Button
            className="w-full"
            onClick={() => {
              onOpenChange(false)
            }}
          >
            {cs.profile.installIosClose}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
