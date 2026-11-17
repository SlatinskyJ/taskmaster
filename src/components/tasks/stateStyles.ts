import type { ItemStateKey } from '~/lib/strings'

// One place that maps an item state to its theme colours (UI doc §2.2), so the chip, the row
// stripe and point colours always agree. Full class names, so Tailwind finds them.

export const STATE_DOT: Record<ItemStateKey, string> = {
  proposed: 'bg-state-proposed',
  negotiating: 'bg-state-negotiating',
  open: 'bg-state-open',
  reserved: 'bg-state-reserved',
  pending: 'bg-state-pending',
  confirmed: 'bg-state-confirmed',
  expired: 'bg-state-expired',
  cancelled: 'bg-state-cancelled',
  rejected: 'bg-state-rejected',
  disputed: 'bg-state-disputed',
}

export const STATE_TEXT: Record<ItemStateKey, string> = {
  proposed: 'text-state-proposed-text',
  negotiating: 'text-state-negotiating-text',
  open: 'text-state-open-text',
  reserved: 'text-state-reserved-text',
  pending: 'text-state-pending-text',
  confirmed: 'text-state-confirmed-text',
  expired: 'text-state-expired-text',
  cancelled: 'text-state-cancelled-text',
  rejected: 'text-state-rejected-text',
  disputed: 'text-state-disputed-text',
}

/** Chip background: 15 % of the dot colour over the surface (UI doc §2.2). */
export const STATE_CHIP_BG: Record<ItemStateKey, string> = {
  proposed: 'bg-state-proposed/15',
  negotiating: 'bg-state-negotiating/15',
  open: 'bg-state-open/15',
  reserved: 'bg-state-reserved/15',
  pending: 'bg-state-pending/15',
  confirmed: 'bg-state-confirmed/15',
  expired: 'bg-state-expired/15',
  cancelled: 'bg-state-cancelled/15',
  rejected: 'bg-state-rejected/15',
  disputed: 'bg-state-disputed/15',
}

/** The 4 px left stripe of a row (UI doc §2.2). */
export const STATE_STRIPE: Record<ItemStateKey, string> = {
  proposed: 'border-l-state-proposed',
  negotiating: 'border-l-state-negotiating',
  open: 'border-l-state-open',
  reserved: 'border-l-state-reserved',
  pending: 'border-l-state-pending',
  confirmed: 'border-l-state-confirmed',
  expired: 'border-l-state-expired',
  cancelled: 'border-l-state-cancelled',
  rejected: 'border-l-state-rejected',
  disputed: 'border-l-state-disputed',
}
