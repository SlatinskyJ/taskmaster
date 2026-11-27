import { useMatches, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Features } from '~/lib/features'
import { frameHeader } from '~/lib/frame'
import {
  BANNER_START,
  bannerReduce,
  bannerText,
  dismissGuard,
  subsKey,
  subsOf,
} from '~/lib/liveBanner'
import type { BannerEvent, BannerState } from '~/lib/liveBanner'
import { connectLive } from '~/lib/liveConnect'
import type { ConnectDeps } from '~/lib/liveConnect'
import { tabId } from '~/lib/tab'
import { LIVE_TOAST_ID, LiveToast } from './LiveToast'

// The live change banner (#299, design "The banner"): one per tab, in the `_app` layout. It
// collects the `live` subscriptions every active route's loader returns, keeps one stream open
// for them, counts what arrives and shows one Sonner toast with a fixed id. Refresh reruns the
// loaders (`router.invalidate()`), whose new subscriptions start a new stream and a new count.
// Rules: src/server/live/README.md "The banner (client)".

/** The browser's side of the stream client. */
function browserDeps(): ConnectDeps {
  return {
    fetch: (input, init) => window.fetch(input, init),
    setTimeout: (run, ms) => window.setTimeout(run, ms),
    clearTimeout: (h) => {
      window.clearTimeout(h as number)
    },
    isVisible: () => document.visibilityState === 'visible',
    onInHand: (run) => {
      const visible = () => {
        if (document.visibilityState === 'visible') run()
      }
      document.addEventListener('visibilitychange', visible)
      window.addEventListener('focus', run)
      window.addEventListener('online', run)
      return () => {
        document.removeEventListener('visibilitychange', visible)
        window.removeEventListener('focus', run)
        window.removeEventListener('online', run)
      }
    },
    headers: frameHeader(window),
  }
}

/** The banner state of one subscription key; another key starts again. */
interface Keyed {
  key: string
  s: BannerState
}

const forKey = (st: Keyed, key: string): BannerState => (st.key === key ? st.s : BANNER_START)

export function LiveBanner({ features }: { features: Pick<Features, 'liveChanges'> }) {
  const router = useRouter()
  const subs = subsOf(useMatches())
  const key = features.liveChanges ? subsKey(subs) : ''
  const [st, setSt] = useState<Keyed>({ key, s: BANNER_START })
  const [busy, setBusy] = useState(false)
  const keyRef = useRef(key)
  const subsRef = useRef(subs)
  const guardRef = useRef<ReturnType<typeof dismissGuard> | null>(null)

  useEffect(() => {
    keyRef.current = key
    subsRef.current = subs
  })

  /** An event for the state of `k`; one for a key that is no longer current never shows. */
  const dispatch = useCallback((k: string, e: BannerEvent) => {
    setSt((prev) => ({ key: k, s: bannerReduce(forKey(prev, k), e) }))
  }, [])

  // One stream per subscription key: navigation, a refresh or one's own action's reload closes
  // the old one (an event of it already in flight is dropped) and opens the new one.
  useEffect(() => {
    if (key === '') return
    const conn = connectLive(
      subsRef.current,
      tabId(),
      {
        change: (event) => {
          if (keyRef.current === key) dispatch(key, { type: 'change', event })
        },
        overflow: () => {
          if (keyRef.current === key) dispatch(key, { type: 'overflow' })
        },
      },
      browserDeps(),
    )
    return () => {
      conn.close()
    }
  }, [key, dispatch])

  // The loaders run again and sign new subscriptions: a new key, a new stream, a new count. If
  // nothing was written since they last ran, the tokens and the key stay the same, and the count
  // starts again here.
  const refresh = useCallback(async () => {
    const before = keyRef.current
    setBusy(true)
    try {
      await router.invalidate()
    } finally {
      setBusy(false)
    }
    setSt((prev) => (prev.key === before ? { key: before, s: BANNER_START } : prev))
  }, [router])

  const text = key === '' ? null : bannerText(forKey(st, key))

  useEffect(() => {
    if (text === null) {
      // Sonner calls onDismiss again after this: the dropped guard swallows it.
      guardRef.current?.drop()
      guardRef.current = null
      toast.dismiss(LIVE_TOAST_ID)
      return
    }
    guardRef.current ??= dismissGuard(
      key,
      () => keyRef.current,
      () => {
        dispatch(key, { type: 'dismiss' })
      },
    )
    const guard = guardRef.current
    toast.custom(
      () => (
        <LiveToast
          text={text}
          busy={busy}
          onRefresh={() => void refresh()}
          onClose={() => {
            guard.close()
          }}
        />
      ),
      {
        id: LIVE_TOAST_ID,
        duration: Infinity,
        onDismiss: () => {
          guard.onDismiss()
        },
      },
    )
  }, [text, busy, key, dispatch, refresh])

  useEffect(
    () => () => {
      guardRef.current?.drop()
      toast.dismiss(LIVE_TOAST_ID)
    },
    [],
  )

  return null
}
