import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ProfilePassword } from '~/components/auth/ProfilePassword'
import { ProfilePasskeys } from '~/components/auth/ProfilePasskeys'
import { Avatar } from '~/components/shell/Avatar'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { Button, buttonVariants } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { useEffectsSwitch } from '~/lib/effects'
import { landingPath } from '~/lib/landing'
import { guardScreen } from '~/lib/screenGuard'
import { keepFrameToken } from '~/lib/frame'
import { cs } from '~/lib/strings'
import { THEME_PREFS, useThemePref, type ThemePref } from '~/lib/theme'
import { cn } from '~/lib/utils'
import { logoutFn } from '~/server/auth/functions'
import { getPasskeysEnabledFn, listMyPasskeysFn } from '~/server/passkeys/functions'

// Profile (UI doc §7.4): light / dark / auto, effects on/off, passkeys (#29), own password
// (#210, behind the `passwordChange` switch), log out. Both choices are
// stored on this device (src/lib/theme.ts, src/lib/effects.ts): a phone and a shared screen
// may want different ones.
export const Route = createFileRoute('/_app/profil')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/profil')
  },
  // Passkeys are listed with them off too, so old ones can still be removed.
  loader: async () => {
    const [enabled, passkeys] = await Promise.all([getPasskeysEnabledFn(), listMyPasskeysFn()])
    return { enabled, passkeys }
  },
  component: Profile,
})

const THEME_LABELS: Record<ThemePref, string> = {
  light: cs.profile.themeLight,
  dark: cs.profile.themeDark,
  auto: cs.profile.themeAuto,
}

function Profile() {
  const { user, features } = Route.useRouteContext()
  const router = useRouter()
  const [theme, setTheme] = useThemePref()
  const [effects, setEffects] = useEffectsSwitch()
  const [leaving, setLeaving] = useState(false)
  const { enabled, passkeys } = Route.useLoaderData()

  async function logout() {
    setLeaving(true)
    try {
      await logoutFn()
      keepFrameToken(window, undefined)
      await router.invalidate()
      await router.navigate({ to: '/login' })
    } catch {
      // Offline or server error: still signed in, so say so instead of doing nothing.
      toast.error(cs.login.failed)
    } finally {
      setLeaving(false)
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-md">
      <header className="flex items-center gap-2.5 px-4 pt-4 pb-2">
        <Link
          to={landingPath(user.role)}
          aria-label={cs.profile.back}
          className={buttonVariants({ variant: 'ghost', size: 'icon' })}
        >
          <ChevronLeft aria-hidden="true" />
        </Link>
        <h1 className="font-display text-title leading-tight font-bold">{cs.profile.title}</h1>
      </header>
      <main className="flex flex-col gap-3 px-4 pt-2 pb-5">
        <Card className="flex items-center gap-3">
          <Avatar userId={user.id} name={user.displayName} size="lg" />
          <div className="grid">
            <b className="font-display text-xl font-bold">{user.displayName}</b>
            <span className="text-meta font-bold text-muted">{cs.roles[user.role]}</span>
          </div>
        </Card>

        <SectionLabel id="theme-label">{cs.profile.appearance}</SectionLabel>
        <div
          role="group"
          aria-labelledby="theme-label"
          className="grid grid-cols-3 gap-1 rounded-[14px] bg-track p-1"
        >
          {THEME_PREFS.map((pref) => (
            <button
              key={pref}
              type="button"
              aria-pressed={theme === pref}
              onClick={() => {
                setTheme(pref)
              }}
              className={cn(
                'min-h-tap cursor-pointer rounded-[10px] text-[13px] font-extrabold text-ink',
                theme === pref ? 'bg-surface shadow-sticker' : 'opacity-75',
              )}
            >
              {THEME_LABELS[pref]}
            </button>
          ))}
        </div>

        <SectionLabel>{cs.profile.effects}</SectionLabel>
        {/* The whole row is the switch, so the tap target is the row, not just the knob. */}
        <Card className="p-0">
          <button
            type="button"
            role="switch"
            aria-checked={effects}
            aria-labelledby="effects-label"
            aria-describedby="effects-hint"
            onClick={() => {
              setEffects(!effects)
            }}
            className="flex min-h-tap w-full cursor-pointer items-center gap-3 rounded-card p-card text-left"
          >
            <span className="grid flex-1">
              <b id="effects-label" className="text-row font-extrabold">
                {cs.profile.effectsLabel}
              </b>
              <span id="effects-hint" className="text-meta font-bold text-muted">
                {cs.profile.effectsHint}
              </span>
            </span>
            <span
              aria-hidden="true"
              className={cn(
                'relative h-8 w-13 shrink-0 rounded-full transition-colors motion-reduce:transition-none',
                effects ? 'bg-ok' : 'bg-muted',
              )}
            >
              <span
                className={cn(
                  'absolute top-[3px] size-[26px] rounded-full bg-surface shadow-sticker transition-[left] motion-reduce:transition-none',
                  effects ? 'left-[23px]' : 'left-[3px]',
                )}
              />
            </span>
          </button>
        </Card>

        <ProfilePasskeys enabled={enabled} items={passkeys} />

        <ProfilePassword enabled={features.passwordChange} username={user.username} />

        <Button
          variant="no"
          className="mt-4 w-full"
          disabled={leaving}
          onClick={() => {
            void logout()
          }}
        >
          {cs.login.logout}
        </Button>
      </main>
    </div>
  )
}
