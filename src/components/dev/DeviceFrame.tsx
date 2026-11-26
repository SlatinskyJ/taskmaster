import { RotateCw, X } from 'lucide-react'
import type { KeyboardEvent, Ref } from 'react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { DEMO_LOGINS, SIZES, safePath } from '~/lib/multiLayout'
import type { DemoLogin, Device, SizeKey } from '~/lib/multiLayout'
import type { FrameStatus } from '~/lib/multiLogin'
import { cs } from '~/lib/strings'
import { cn } from '~/lib/utils'

// One device on the multi-user viewer's desk (/dev/multi): its header (user, size, Obnovit,
// Odebrat, address) exactly as wide as its frame, then the frame or its login state.

const t = cs.devMulti

export interface OpenFrame {
  /** Bumped by every reopen; the iframe is keyed by it, so only a bump reloads it. */
  reloadKey: number
  src: string
  name: string
}

export const SIZE_KEYS = Object.keys(SIZES) as SizeKey[]

export function UserSelect({
  value,
  onChange,
}: {
  value: DemoLogin
  onChange: (user: DemoLogin) => void
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        onChange(v as DemoLogin)
      }}
    >
      <SelectTrigger aria-label={t.user} className="w-auto min-w-0 flex-1">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DEMO_LOGINS.map((u) => (
          <SelectItem key={u} value={u}>
            {t.users[u]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function SizeSelect({
  value,
  onChange,
}: {
  value: SizeKey
  onChange: (size: SizeKey) => void
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        onChange(v as SizeKey)
      }}
    >
      <SelectTrigger aria-label={t.size} className="w-auto min-w-0 flex-1">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SIZE_KEYS.map((s) => (
          <SelectItem key={s} value={s}>
            {t.sizes[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function DeviceFrame({
  device,
  status,
  frame,
  active,
  iframeRef,
  onLoad,
  onUser,
  onSize,
  onReload,
  onRemove,
  onAddress,
  onRetry,
}: {
  device: Device
  status: FrameStatus
  frame: OpenFrame | undefined
  active: boolean
  iframeRef: Ref<HTMLIFrameElement>
  onLoad: () => void
  onUser: (user: DemoLogin) => void
  onSize: (size: SizeKey) => void
  onReload: () => void
  onRemove: () => void
  onAddress: (path: string) => void
  onRetry: () => void
}) {
  const size = SIZES[device.size]
  const width = size.w * size.scale
  const height = size.h * size.scale

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    const path = safePath(e.currentTarget.value)
    // Anything but a path on this site leaves the frame where it is.
    e.currentTarget.value = path ?? device.path
    if (path !== null) onAddress(path)
  }

  return (
    <section
      data-device={device.id}
      className="grid shrink-0 content-start gap-2"
      style={{ width }}
    >
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <UserSelect value={device.user} onChange={onUser} />
          <SizeSelect value={device.size} onChange={onSize} />
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t.reload}
              title={t.reload}
              onClick={onReload}
            >
              <RotateCw />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t.remove}
              title={t.remove}
              onClick={onRemove}
            >
              <X />
            </Button>
          </div>
        </div>
        <Input
          key={device.path}
          aria-label={t.address}
          defaultValue={device.path}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
          className="text-ellipsis"
        />
      </div>
      <div className="relative">
        {active && (
          <span className="absolute -top-2 right-3 z-10 rounded-full bg-accent-strong px-2 text-sm font-semibold text-on-accent-strong">
            {t.inHand}
          </span>
        )}
        <div
          className={cn(
            'overflow-hidden rounded-card bg-surface outline-3 outline-offset-2 transition-[outline-color] motion-reduce:transition-none',
            active ? 'outline-accent-strong' : 'outline-transparent',
          )}
          style={{ width, height }}
        >
          {status.kind === 'ready' && frame ? (
            <iframe
              key={frame.reloadKey}
              ref={iframeRef}
              name={frame.name}
              src={frame.src}
              title={t.users[device.user]}
              onLoad={onLoad}
              className="block border-0"
              style={{
                width: size.w,
                height: size.h,
                transform: size.scale === 1 ? undefined : `scale(${String(size.scale)})`,
                transformOrigin: 'top left',
              }}
            />
          ) : (
            <div className="grid h-full place-content-center justify-items-center gap-3 p-4 text-center text-muted">
              {status.kind === 'failed' ? (
                <>
                  <p>{t.loginFailed}</p>
                  <Button variant="ghost" onClick={onRetry}>
                    {t.retry}
                  </Button>
                </>
              ) : (
                <p role="status">{t.loggingIn}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
