// The page the service worker shows when a navigation fails because the device is offline.
// Built at build time from the Czech strings and baked into sw.js, so it needs no network.
// Self-contained: inline styles with the Pastelky tokens (UI doc §2.1), and one inline script,
// the app's theme boot script, so a theme forced in Profil applies here too (#124).
// Imported by vite.config.ts through ./vite-plugin: relative imports only.

import { THEME_COLORS, themeBootScript } from '../lib/themeColor'

/**
 * The Pastelky tokens the page uses, named as in src/styles/theme.css (light `:root` and the
 * system-dark block). A copy, because the page must work without the app's stylesheet;
 * offline.test.ts keeps it equal to theme.css.
 */
export const OFFLINE_TOKENS = {
  light: {
    bg: '#fff5ee',
    ink: '#2b1f2e',
    muted: '#6e6270',
    'accent-strong': '#d93a42',
    'on-accent-strong': '#ffffff',
  },
  dark: {
    bg: '#1d1524',
    ink: '#fff1e8',
    muted: '#b8aab8',
    'accent-strong': '#ff6a70',
    'on-accent-strong': '#1d1524',
  },
} as const

function cssVars(tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .map(([name, value]) => `--${name}:${value}`)
    .join(';')
}

export interface OfflineText {
  title: string
  message: string
  retry: string
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function offlinePage(appName: string, text: OfflineText): string {
  const title = escapeHtml(text.title)
  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="${THEME_COLORS.light}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${THEME_COLORS.dark}" media="(prefers-color-scheme: dark)">
<script>${themeBootScript}</script>
<title>${escapeHtml(appName)}</title>
<style>
:root{${cssVars(OFFLINE_TOKENS.light)}}
@media (prefers-color-scheme: dark){:root:not([data-theme=light]){${cssVars(OFFLINE_TOKENS.dark)}}}
:root[data-theme=dark]{${cssVars(OFFLINE_TOKENS.dark)}}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--ink);font-family:ui-rounded,system-ui,sans-serif;text-align:center}
main{padding:16px;max-width:360px}
h1{font-size:26px;margin:0 0 8px}
p{color:var(--muted);font-size:15px;margin:0 0 20px}
a{display:inline-block;box-sizing:border-box;min-height:44px;padding:12px 20px;line-height:20px;border-radius:12px;background:var(--accent-strong);color:var(--on-accent-strong);font-weight:700;text-decoration:none}
</style>
</head>
<body>
<main>
<h1>${title}</h1>
<p>${escapeHtml(text.message)}</p>
<a href="">${escapeHtml(text.retry)}</a>
</main>
</body>
</html>
`
}
