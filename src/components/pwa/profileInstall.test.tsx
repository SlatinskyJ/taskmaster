import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cs } from '~/lib/strings'
import { InstallSection, ProfileInstall } from './ProfileInstall'

// Profil → Aplikace (#302). The prompt, the iOS sheet and hiding after use are in
// e2e/install.spec.ts.

const noop = () => undefined

describe('InstallSection', () => {
  it('hidden: renders nothing', () => {
    expect(renderToStaticMarkup(<InstallSection mode="hidden" onInstall={noop} />)).toBe('')
  })

  it('prompt: the section and its button', () => {
    const html = renderToStaticMarkup(<InstallSection mode="prompt" onInstall={noop} />)
    expect(html).toContain(cs.profile.installSection)
    expect(html).toMatch(new RegExp(`<button[^>]*>.*${cs.profile.installButton}`))
    expect(html).toContain(cs.profile.installHint)
  })

  it('ios: the same button', () => {
    const html = renderToStaticMarkup(<InstallSection mode="ios" onInstall={noop} />)
    expect(html).toContain(cs.profile.installSection)
    expect(html).toMatch(new RegExp(`<button[^>]*>.*${cs.profile.installButton}`))
  })

  it('busy: the button is disabled', () => {
    const html = renderToStaticMarkup(<InstallSection mode="prompt" busy onInstall={noop} />)
    expect(html).toMatch(/<button[^>]*disabled/)
  })
})

describe('ProfileInstall', () => {
  it('server render is hidden, so hydration never mismatches', () => {
    expect(renderToStaticMarkup(<ProfileInstall />)).toBe('')
  })
})
