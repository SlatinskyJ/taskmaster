// The page the service worker shows when a navigation fails because the device is offline.
// Built at build time from the Czech strings and baked into sw.js, so it needs no network.
// Self-contained: inline styles with the Pastelky tokens (UI doc §2.1), no scripts.

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
<title>${escapeHtml(appName)}</title>
<style>
:root{--bg:#FFF5EE;--ink:#2B1F2E;--muted:#6E6270;--accent:#D93A42;--on-accent:#FFFFFF}
@media (prefers-color-scheme: dark){:root{--bg:#1D1524;--ink:#FFF1E8;--muted:#B8AAB8;--accent:#FF6A70;--on-accent:#1D1524}}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--ink);font-family:system-ui,sans-serif;text-align:center}
main{padding:16px;max-width:360px}
h1{font-size:26px;margin:0 0 8px}
p{color:var(--muted);font-size:15px;margin:0 0 20px}
a{display:inline-block;padding:12px 20px;border-radius:12px;background:var(--accent);color:var(--on-accent);font-weight:700;text-decoration:none}
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
