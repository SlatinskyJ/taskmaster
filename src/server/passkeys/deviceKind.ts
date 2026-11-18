import type { DeviceKind } from '~/server/db/schema'

// Which kind of device registered a passkey, from its User-Agent, so the profile can say
// "iPhone" or "Windows". Order matters: iPhone and iPad UAs also say "Mac OS X", Android UAs say
// "Linux". An iPad in desktop mode reads as a Mac, which is fine for a label.
const RULES: readonly [RegExp, DeviceKind][] = [
  [/\biPad\b/, 'ipad'],
  [/\biPhone\b/, 'iphone'],
  [/\bAndroid\b/, 'android'],
  [/\bMacintosh\b/, 'mac'],
  [/\bWindows\b/, 'windows'],
  [/\bLinux\b/, 'linux'],
]

export function guessDeviceKind(userAgent: string | undefined): DeviceKind {
  if (!userAgent) return 'other'
  return RULES.find(([re]) => re.test(userAgent))?.[1] ?? 'other'
}
