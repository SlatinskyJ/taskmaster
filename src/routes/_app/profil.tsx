import { createFileRoute, useRouter } from '@tanstack/react-router'
import { LogOut, Moon, Sun, SunMoon } from 'lucide-react'
import { useState } from 'react'
import { Avatar } from '~/components/shell/Avatar'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { useEffectsSwitch } from '~/lib/effects'
import { guardScreen } from '~/lib/routeGuard'
import { cs } from '~/lib/strings'
import { THEME_PREFS, useThemePref, type ThemePref } from '~/lib/theme'
import { cn } from '~/lib/utils'
import { logoutFn } from '~/server/auth/functions'

// Profile (UI doc §7.4): light / dark / auto, effects on/off, log out. Everyone has one;
// the avatar in the top bar opens it. Theme and effects are kept on this device.
export const Route = createFileRoute('/_app/profil')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/profil')
  },
  component: Profile,
})

const THEME_ICONS = { auto: SunMoon, light: Sun, dark: Moon } satisfies Record<ThemePref, unknown>

function Profile() {
  const { user } = Route.useRouteContext()
  const router = useRouter()
  const [theme, setTheme] = useThemePref()
  const [effects, setEffects] = useEffectsSwitch()
  const [leaving, setLeaving] = useState(false)

  return (
    <div className="grid gap-4">
      <h1 className="text-title font-bold">{cs.profile.title}</h1>

      <Card className="flex items-center gap-3">
        <Avatar name={user.displayName} className="size-12 text-2xl" />
        <div className="grid">
          <span className="text-row font-bold">{user.displayName}</span>
          <span className="text-meta text-muted">{cs.roles[user.role]}</span>
        </div>
      </Card>

      <Card className="grid gap-4">
        <div className="grid gap-2">
          <h2 id="theme-label" className="text-lg font-semibold">
            {cs.profile.appearance}
          </h2>
          <div
            role="radiogroup"
            aria-labelledby="theme-label"
            className="grid grid-cols-3 gap-1 rounded-full bg-track p-1"
          >
            {THEME_PREFS.map((p) => {
              const Icon = THEME_ICONS[p]
              const checked = theme === p
              return (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => {
                    setTheme(p)
                  }}
                  className={cn(
                    'flex min-h-tap cursor-pointer items-center justify-center gap-1.5 rounded-full px-2 font-display text-meta font-semibold text-muted transition-colors',
                    checked && 'bg-surface text-ink shadow-sticker',
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {cs.profile.theme[p]}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="grid">
            <span id="effects-label" className="font-display text-lg font-semibold">
              {cs.profile.effects}
            </span>
            <span className="text-meta text-muted">{cs.profile.effectsHint}</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={effects}
            aria-labelledby="effects-label"
            onClick={() => {
              setEffects(!effects)
            }}
            className={cn(
              'relative h-8 w-14 shrink-0 cursor-pointer rounded-full transition-colors motion-reduce:transition-none',
              effects ? 'bg-ok' : 'bg-track',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'absolute top-1 left-1 size-6 rounded-full bg-surface shadow-sticker transition-transform motion-reduce:transition-none',
                effects && 'translate-x-6',
              )}
            />
          </button>
        </div>

        <p className="text-meta text-muted">{cs.profile.deviceNote}</p>
      </Card>

      <Button
        variant="no"
        disabled={leaving}
        onClick={() => {
          setLeaving(true)
          void logoutFn()
            .then(() => router.navigate({ to: '/login' }))
            .finally(() => {
              setLeaving(false)
            })
        }}
      >
        <LogOut aria-hidden />
        {cs.login.logout}
      </Button>
    </div>
  )
}
