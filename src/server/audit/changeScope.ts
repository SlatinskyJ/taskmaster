import { AsyncLocalStorage } from 'node:async_hooks'
import { createServerOnlyFn } from '@tanstack/react-start'
import type { AuditAction } from './actions'

// Where a change's first entry lives (#299, #304): one scope per server request, so two requests
// whose runs share a tick never share a change (README "Changes"). Outside a scope (the
// scheduler, scripts) `writeAudit` keeps its module-level fallback.

/** A change's first entry, by who it is: a rolled-back entry's id can be taken by another row. */
export interface FirstEntry {
  id: number
  action: AuditAction
  entityId: string
  at: string
}

export interface ChangeScope {
  first: FirstEntry | null
}

let storage: AsyncLocalStorage<ChangeScope> | undefined

/**
 * Built on first use, on the server only: this module reaches the browser bundle through shared
 * imports, where `node:async_hooks` is an empty stub, so nothing may run it at load.
 */
const scopes = createServerOnlyFn(() => (storage ??= new AsyncLocalStorage<ChangeScope>()))

/** Runs `run` in a fresh change scope (the request middleware does this per request). */
export function inChangeScope<T>(run: () => T): T {
  return scopes().run({ first: null }, run)
}

/** The current request's scope, or undefined outside one. */
export function currentScope(): ChangeScope | undefined {
  return scopes().getStore()
}
