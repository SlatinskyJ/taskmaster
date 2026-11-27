import { createMiddleware } from '@tanstack/react-start'
import { isDemo } from '~/server/env/demo'

// The public demo removes links from everything a visitor sends
// (docs/superpowers/specs/2026-11-27-demo-environment-design.md): anyone may write there, and
// the demo must not become a place to post links. Removed: each run starting with `http://`,
// `https://` or `www.` (any case) up to the next whitespace. A plain `name.cz` stays. Silent:
// the visitor just sees the text without the link. No exemptions: login names and passwords
// hold no links in practice, and every password-setting function is locked on the demo
// (./lock.ts). Spaces left behind stay; each server function's own validator trims.

const LINK = /(?:https?:\/\/|www\.)\S*/gi

export function stripLinks(text: string): string {
  return text.replace(LINK, '')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}

/**
 * Every string inside `value` stripped: arrays mapped, plain objects rebuilt with
 * `Object.fromEntries` (so a `__proto__` key stays a plain own key), anything else as is.
 */
export function stripLinksDeep(value: unknown): unknown {
  if (typeof value === 'string') return stripLinks(value)
  if (Array.isArray(value)) return value.map(stripLinksDeep)
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripLinksDeep(v)]))
  }
  return value
}

/** A server function's input, links removed on the demo; elsewhere the same value. */
export function demoLinkInput(input: unknown, env: NodeJS.ProcessEnv): unknown {
  return isDemo(env) ? stripLinksDeep(input) : input
}

/**
 * Registered first in src/start.ts `functionMiddleware`. A middleware validator runs on the
 * server only, before each server function's own validator, so every function gets clean input.
 * Typed as identity, so it changes no server function's input type.
 */
export const demoLinkMiddleware = createMiddleware({ type: 'function' }).validator(
  <T>(input: T): T => demoLinkInput(input, process.env) as T,
)
