import type { Live, LiveSub } from '~/server/live/functions'

// A loader's subscriptions (#299): each data function returns `{ data, live }`; the loader
// takes the data and returns every subscription as `live`, for the client's stream.
//
//   const live = liveSubs()
//   const list = live.take(await listTasksFn())
//   return { list, live: live.all() }

export interface LiveSubs {
  /** The data; keeps the subscription, in call order. */
  take: <T>(r: Live<T>) => T
  /** Every subscription taken so far, in call order, without the nulls. */
  all: () => LiveSub[]
}

export function liveSubs(): LiveSubs {
  const subs: LiveSub[] = []
  return {
    take: (r) => {
      if (r.live) subs.push(r.live)
      return r.data
    },
    all: () => [...subs],
  }
}
