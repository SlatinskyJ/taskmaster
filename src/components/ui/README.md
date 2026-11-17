# UI components (shadcn/ui, restyled)

These are shadcn/ui components copied in and restyled to the Hřiště theme (UI design doc §5).
They are our code now: edit them here, don't regenerate them.

## Colours come from the theme only

Use the theme's utilities (`src/styles/theme.css`), never Tailwind's default palette
(`bg-zinc-100`, `text-gray-500`). Both themes then follow automatically; no `dark:` classes needed.

| Want                            | Use                                                                      |
| ------------------------------- | ------------------------------------------------------------------------ |
| page / card                     | `bg-bg` / `bg-surface`                                                   |
| text / secondary text           | `text-ink` / `text-muted`                                                |
| coral, violet                   | `bg-accent`, `text-accent2` (large text or decoration only: below 4.5:1) |
| primary / approve button        | `bg-accent-strong text-on-accent-strong` / `bg-ok text-on-ok`            |
| a state                         | `bg-state-<state>` (dot), `text-state-<state>-text` (text)               |
| track, chip background, borders | `bg-track`, `border-track`                                               |
| sticker shadow, radius          | `shadow-sticker`, `rounded-card`, `rounded-button`                       |
| numbers                         | `num` (Fredoka, tabular figures)                                         |

## Copying in another shadcn component

The shadcn variable names that don't clash are mapped (`background`, `foreground`, `card`,
`popover`, `primary`, `secondary`, `muted-foreground`, `destructive`, `border`, `input`, `ring`).
Two names mean something else here, so rewrite them:

- shadcn `bg-muted` / `bg-accent` (a quiet grey fill) → `bg-track`
- shadcn `text-accent-foreground` → `text-ink`

Keep the 44 px tap target (`min-h-tap`, `size-tap`) on anything a finger presses.
