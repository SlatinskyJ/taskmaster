import { createFileRoute, notFound } from '@tanstack/react-router'
import { Plus, RotateCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { EmptyState } from '~/components/EmptyState'
import { AddDevice } from '~/components/dev/AddDevice'
import { DeviceFrame, type OpenFrame } from '~/components/dev/DeviceFrame'
import { Button } from '~/components/ui/button'
import {
  type DemoLogin,
  type Device,
  type SizeKey,
  frameName,
  frameSrc,
  needsLogin,
  newDeviceId,
  parseLayout,
  safePath,
  serializeLayout,
  tokenFromName,
} from '~/lib/multiLayout'
import { type FrameStatus, logInDevice } from '~/lib/multiLogin'
import { cs } from '~/lib/strings'
import { frameLoginFn } from '~/server/auth/functions'
import { getDevPagesAllowed } from '~/server/env/functions'

// The multi-user viewer (#265, spec "Multi-user viewer"): a row of frames, each the real app
// with its own session, like phones on a desk. The page never reloads a frame by itself: only
// Obnovit, Obnovit vše, a new user or an address does. Dev and PR previews only.
export const Route = createFileRoute('/dev/multi')({
  // The layout lives in this browser's localStorage, so the page renders in the browser only.
  ssr: false,
  beforeLoad: async () => {
    // TanStack Router's notFound() is thrown by design; it is not an Error.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (!(await getDevPagesAllowed())) throw notFound()
  },
  component: MultiViewer,
})

const t = cs.devMulti
const STORAGE_KEY = 'tm.devMulti.v1'

function loadLayout(): Device[] {
  try {
    return parseLayout(localStorage.getItem(STORAGE_KEY))
  } catch {
    return parseLayout(null)
  }
}

function saveLayout(devices: readonly Device[]) {
  try {
    localStorage.setItem(STORAGE_KEY, serializeLayout(devices))
  } catch {
    // Private window or blocked storage: the layout is simply not remembered.
  }
}

/** Where the frame is now and who is signed in there, or null when it cannot be read. */
function readFrame(
  iframe: HTMLIFrameElement | undefined,
): { path: string; token: string | null } | null {
  try {
    const win = iframe?.contentWindow
    if (win?.location.origin !== window.location.origin) return null
    const path = safePath(win.location.pathname + win.location.search + win.location.hash)
    const named = tokenFromName(win.name)
    if (path === null || named === null) return null
    return { path, token: named.token }
  } catch {
    return null
  }
}

const openFrame = (device: Device, previous: OpenFrame | undefined): OpenFrame => ({
  reloadKey: (previous?.reloadKey ?? 0) + 1,
  src: frameSrc(device),
  name: frameName(device.token),
})

function initialState() {
  const devices = loadLayout()
  const status: Record<string, FrameStatus> = {}
  const frames: Record<string, OpenFrame> = {}
  for (const d of devices) {
    if (needsLogin(d)) status[d.id] = { kind: 'loggingIn' }
    else {
      status[d.id] = { kind: 'ready' }
      frames[d.id] = openFrame(d, undefined)
    }
  }
  return { devices, status, frames }
}

const loginKey = (d: Device) => `${d.id}:${d.user}`

function MultiViewer() {
  const [initial] = useState(initialState)
  const [devices, setDevices] = useState(initial.devices)
  const [status, setStatus] = useState(initial.status)
  const [frames, setFrames] = useState(initial.frames)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const iframes = useRef(new Map<string, HTMLIFrameElement>())
  const devicesRef = useRef(devices)
  const inFlight = useRef(new Set<string>())

  useEffect(() => {
    devicesRef.current = devices
    saveLayout(devices)
  }, [devices])

  const update = (id: string, change: (d: Device) => Device) => {
    setDevices((ds) => ds.map((d) => (d.id === id ? change(d) : d)))
  }

  // Log in every frame that is waiting for it; the result lands only if the frame still wants
  // that user (it may have been removed or given another user meanwhile).
  useEffect(() => {
    for (const d of devices) {
      if (status[d.id]?.kind !== 'loggingIn' || !needsLogin(d)) continue
      const key = loginKey(d)
      if (inFlight.current.has(key)) continue
      inFlight.current.add(key)
      void logInDevice(d, (username) => frameLoginFn({ data: { username } })).then((result) => {
        inFlight.current.delete(key)
        const now = devicesRef.current.find((x) => x.id === d.id)
        if (now?.user !== d.user || !needsLogin(now)) return
        const next = { ...now, token: result.device.token }
        update(d.id, () => next)
        setStatus((s) => ({ ...s, [d.id]: result.status }))
        if (result.status.kind === 'ready') {
          setFrames((f) => ({ ...f, [d.id]: openFrame(next, f[d.id]) }))
        }
      })
    }
  }, [devices, status])

  /** Reads the frame's address and session back into the layout; never reloads it. */
  const sync = (id: string) => {
    const read = readFrame(iframes.current.get(id))
    if (!read) return
    update(id, (d) => (d.path === read.path && d.token === read.token ? d : { ...d, ...read }))
  }

  /** Reopens the frame where it is now, as whoever is signed in there now. */
  const reopen = (id: string, path?: string) => {
    const current = devicesRef.current.find((d) => d.id === id)
    if (!current || needsLogin(current)) return
    const read = readFrame(iframes.current.get(id))
    const next = { ...current, ...read, ...(path === undefined ? {} : { path }) }
    update(id, () => next)
    setFrames((f) => ({ ...f, [id]: openFrame(next, f[id]) }))
  }

  const logInAgain = (id: string, change: (d: Device) => Device) => {
    update(id, (d) => ({ ...change(d), token: undefined }))
    setStatus((s) => ({ ...s, [id]: { kind: 'loggingIn' } }))
  }

  // Focus moving into a frame blurs this window: that frame is the one "in hand". Leaving or
  // entering a frame also reads every frame's address back, so the address fields follow.
  useEffect(() => {
    const syncAll = () => {
      for (const id of iframes.current.keys()) sync(id)
    }
    const onBlur = () => {
      setTimeout(() => {
        for (const [id, el] of iframes.current) if (document.activeElement === el) setActiveId(id)
        syncAll()
      }, 0)
    }
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', syncAll)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', syncAll)
    }
    // sync only reads refs and calls a state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const add = (user: DemoLogin, size: SizeKey) => {
    const id = newDeviceId(devicesRef.current)
    setDevices((ds) => [...ds, { id, user, size, path: '/', token: undefined }])
    setStatus((s) => ({ ...s, [id]: { kind: 'loggingIn' } }))
    setAdding(false)
  }

  const remove = (id: string) => {
    setDevices((ds) => ds.filter((d) => d.id !== id))
    iframes.current.delete(id)
    if (activeId === id) setActiveId(null)
  }

  const addButton = (
    <Button
      onClick={() => {
        setAdding(true)
      }}
    >
      <Plus />
      {t.add}
    </Button>
  )

  return (
    <main className="grid min-h-dvh content-start gap-4 bg-bg py-4">
      <header className="grid gap-3 px-gutter">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-title font-bold">{t.title}</h1>
          {addButton}
          <Button
            variant="ghost"
            onClick={() => {
              for (const d of devicesRef.current) if (status[d.id]?.kind === 'ready') reopen(d.id)
            }}
          >
            <RotateCw />
            {t.reloadAll}
          </Button>
        </div>
        <p className="text-sm text-muted">{t.remembered}</p>
        {adding && (
          <AddDevice
            onAdd={add}
            onCancel={() => {
              setAdding(false)
            }}
          />
        )}
      </header>
      {devices.length === 0 ? (
        !adding && <EmptyState action={addButton}>{t.empty}</EmptyState>
      ) : (
        <div className="flex items-start gap-6 overflow-x-auto px-gutter pt-3 pb-4">
          {devices.map((d) => (
            <DeviceFrame
              key={d.id}
              device={d}
              status={status[d.id] ?? { kind: 'loggingIn' }}
              frame={frames[d.id]}
              active={activeId === d.id}
              iframeRef={(el) => {
                if (el) iframes.current.set(d.id, el)
                else iframes.current.delete(d.id)
              }}
              onLoad={() => {
                sync(d.id)
              }}
              onUser={(user) => {
                logInAgain(d.id, (x) => ({ ...x, user }))
              }}
              onSize={(size) => {
                update(d.id, (x) => ({ ...x, size }))
              }}
              onReload={() => {
                reopen(d.id)
              }}
              onRemove={() => {
                remove(d.id)
              }}
              onAddress={(path) => {
                reopen(d.id, path)
              }}
              onRetry={() => {
                setStatus((s) => ({ ...s, [d.id]: { kind: 'loggingIn' } }))
              }}
            />
          ))}
        </div>
      )}
    </main>
  )
}
