import { createFileRoute, notFound } from '@tanstack/react-router'
import { useState } from 'react'
import { Moon, Plus, Sun, SunMoon } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState } from '~/components/EmptyState'
import { burstConfetti } from '~/components/effects/confetti'
import { FloatingPoints } from '~/components/effects/FloatingPoints'
import { PointsBar } from '~/components/points/PointsBar'
import { StateChip } from '~/components/tasks/StateChip'
import { TaskRow } from '~/components/tasks/TaskRow'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '~/components/ui/drawer'
import { Input } from '~/components/ui/input'
import { Progress } from '~/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Textarea } from '~/components/ui/textarea'
import { cs, type ItemStateKey } from '~/lib/strings'
import { useEffectsSwitch } from '~/lib/effects'
import { THEME_PREFS, useThemePref, type ThemePref } from '~/lib/theme'
import { getDevPagesAllowed } from '~/server/env/functions'

// Dev-only showcase of the theme and components (#30). Not a family screen, so its own
// labels are English; Czech samples come from the strings module.
export const Route = createFileRoute('/dev/ui')({
  beforeLoad: async () => {
    // TanStack Router's notFound() is thrown by design; it is not an Error.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (!(await getDevPagesAllowed())) throw notFound()
  },
  component: UiShowcase,
})

const BASE_TOKENS = [
  'bg',
  'surface',
  'ink',
  'muted',
  'accent',
  'accent-strong',
  'accent2',
  'ok',
  'track',
  'shadow',
  'tint',
] as const

/** Sample data (not UI labels), to check Czech diacritics in both fonts. */
const SAMPLE = {
  title: 'Vyndat myčku',
  row: 'Vysát obývák a předsíň',
  meta: 'do neděle 18:00 · Příliš žluťoučký kůň',
  rows: ['Vyndat myčku', 'Vysát obývák a předsíň', 'Vynést koš', 'Zalít kytky', 'Uklidit pokoj'],
}

/** Simulates the Hotovo → approve flow on one task: +N floats, confetti, level toast. */
function EffectsDemo() {
  const [effectsOn, setEffectsOn] = useEffectsSwitch()
  const [score, setScore] = useState({ confirmed: 40, pending: 0 })
  const [rowState, setRowState] = useState<'reserved' | 'pending'>('reserved')
  const [float, setFloat] = useState<{ id: number; tone: 'pending' | 'confirmed' } | null>(null)
  const POINTS = 15

  return (
    <div className="grid gap-3">
      <Card>
        <PointsBar
          celebrate
          subject="demo"
          confirmed={score.confirmed}
          pending={score.pending}
          lower={50}
          upper={100}
        />
      </Card>
      <Card>
        <PointsBar confirmed={70} pending={10} lower={85} upper={100} />
      </Card>
      <TaskRow
        name={SAMPLE.title}
        state={rowState}
        points={POINTS}
        action={
          <>
            {float ? <FloatingPoints key={float.id} points={POINTS} tone={float.tone} /> : null}
            {rowState === 'reserved' ? (
              <Button
                variant="ok"
                onClick={(e) => {
                  burstConfetti(e.currentTarget)
                  setFloat({ id: Date.now(), tone: 'pending' })
                  setRowState('pending')
                  setScore((s) => ({ ...s, pending: s.pending + POINTS }))
                }}
              >
                done
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={() => {
                  setFloat({ id: Date.now(), tone: 'confirmed' })
                  setRowState('reserved')
                  setScore((s) => ({
                    confirmed: s.confirmed + POINTS,
                    pending: s.pending - POINTS,
                  }))
                }}
              >
                approve
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-wrap gap-3">
        <Button
          variant="ghost"
          onClick={() => {
            setScore({ confirmed: 40, pending: 0 })
            setRowState('reserved')
          }}
        >
          reset
        </Button>
        <Button
          variant={effectsOn ? 'primary' : 'ghost'}
          aria-pressed={effectsOn}
          onClick={() => {
            setEffectsOn(!effectsOn)
          }}
        >
          effects {effectsOn ? 'on' : 'off'}
        </Button>
      </div>
    </div>
  )
}

const STATES = Object.keys(cs.state) as ItemStateKey[]

const THEME_ICONS = { auto: SunMoon, light: Sun, dark: Moon } satisfies Record<ThemePref, unknown>

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function UiShowcase() {
  const [pref, setPref] = useThemePref()

  return (
    <main className="mx-auto grid max-w-[480px] gap-8 px-gutter py-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-title font-bold">UI showcase</h1>
        <div className="flex gap-1 rounded-full bg-track p-1" role="group" aria-label="Theme">
          {THEME_PREFS.map((p) => {
            const Icon = THEME_ICONS[p]
            return (
              <Button
                key={p}
                size="icon"
                variant={pref === p ? 'primary' : 'ghost'}
                aria-pressed={pref === p}
                aria-label={p}
                title={p}
                onClick={() => {
                  setPref(p)
                }}
              >
                <Icon />
              </Button>
            )
          })}
        </div>
      </header>

      <Section title="Base tokens">
        <div className="grid grid-cols-3 gap-2">
          {BASE_TOKENS.map((t) => (
            <div key={t} className="grid gap-1 text-meta">
              <div
                className="h-12 rounded-button border-2 border-track"
                style={{ background: `var(--${t})` }}
              />
              <code>{t}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section title="State chips and task rows (#32)">
        <Card className="flex flex-wrap gap-2">
          {STATES.map((s) => (
            <StateChip key={s} state={s} />
          ))}
        </Card>
        <div className="grid gap-3">
          {STATES.map((s, i) => (
            <TaskRow
              key={s}
              name={SAMPLE.rows[i % SAMPLE.rows.length]}
              state={s}
              points={(i + 1) * 5}
              meta={i % 2 === 0 ? SAMPLE.meta : undefined}
            />
          ))}
        </div>
      </Section>

      <Section title="Points bar and effects (#32)">
        <EffectsDemo />
      </Section>

      <Section title="Empty state (#32)">
        <Card>
          <EmptyState action={<Button variant="ghost">action</Button>}>
            Nothing here yet. One friendly line.
          </EmptyState>
        </Card>
      </Section>

      <Section title="Type">
        <Card className="grid gap-2">
          <p className="font-display text-title font-bold">{SAMPLE.title}</p>
          <p className="text-row font-semibold">{SAMPLE.row}</p>
          <p className="text-meta text-muted">{SAMPLE.meta}</p>
          <p className="num text-points font-bold text-state-confirmed-text">45</p>
          <p className="num text-xl">
            45 {cs.points.confirmed} + 15 {cs.points.pending} · {cs.points.lowerLevel} 50 ·{' '}
            {cs.points.upperLevel} 100
          </p>
        </Card>
      </Section>

      <Section title="Buttons">
        <div className="grid grid-cols-2 gap-3">
          <Button>primary</Button>
          <Button variant="ok">ok</Button>
          <Button variant="no">no</Button>
          <Button variant="ghost">ghost</Button>
          <Button size="lg">lg</Button>
          <Button disabled>disabled</Button>
        </div>
        <div className="flex gap-3">
          <Button size="icon" aria-label="add">
            <Plus />
          </Button>
          <Button size="icon" variant="ghost" aria-label="add">
            <Plus />
          </Button>
        </div>
      </Section>

      <Section title="Card, badge, progress">
        <Card>
          <CardHeader>
            <CardTitle>Card title</CardTitle>
            <CardDescription>Card description in muted text.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Badge>badge</Badge>
              <Badge className="bg-tint text-accent-strong">tint</Badge>
            </div>
            <Progress value={45} aria-label="progress" />
          </CardContent>
        </Card>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="a">
          <TabsList>
            <TabsTrigger value="a">This week</TabsTrigger>
            <TabsTrigger value="b">History</TabsTrigger>
          </TabsList>
          <TabsContent value="a">
            <Card>First tab</Card>
          </TabsContent>
          <TabsContent value="b">
            <Card>Second tab</Card>
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Forms">
        <Input placeholder="Input" aria-label="input" />
        <Input placeholder="Invalid input" aria-label="invalid input" aria-invalid />
        <Textarea placeholder="Textarea" aria-label="textarea" />
        <Select>
          <SelectTrigger aria-label="select">
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">One</SelectItem>
            <SelectItem value="2">Two</SelectItem>
            <SelectItem value="3">Three</SelectItem>
          </SelectContent>
        </Select>
      </Section>

      <Section title="Overlays">
        <div className="grid grid-cols-3 gap-3">
          <Drawer>
            <DrawerTrigger asChild>
              <Button variant="ghost">Drawer</Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>Drawer title</DrawerTitle>
                <DrawerDescription>Bottom sheet for task actions.</DrawerDescription>
              </DrawerHeader>
              <Textarea placeholder="Reason" aria-label="reason" />
              <DrawerFooter className="grid-cols-2">
                <DrawerClose asChild>
                  <Button variant="ghost">close</Button>
                </DrawerClose>
                <DrawerClose asChild>
                  <Button variant="ok">ok</Button>
                </DrawerClose>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>

          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost">Dialog</Button>
            </DialogTrigger>
            <DialogContent closeLabel="close">
              <DialogHeader>
                <DialogTitle>Dialog title</DialogTitle>
                <DialogDescription>Only for actions that can't be undone.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">close</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button variant="no">no</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Button
            variant="ghost"
            onClick={() => {
              toast('Saved')
            }}
          >
            Toast
          </Button>
        </div>
      </Section>
    </main>
  )
}
