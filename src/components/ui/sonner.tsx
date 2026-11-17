import type { ComponentProps } from 'react'
import { Toaster as Sonner } from 'sonner'
import { useResolvedTheme } from '~/lib/theme'

// UI doc §5: toasts for "saved", "sent", level reached. Ink on bg, like the mockups' toast.
export function Toaster(props: ComponentProps<typeof Sonner>) {
  const theme = useResolvedTheme()
  return (
    <Sonner
      theme={theme}
      position="top-center"
      toastOptions={{
        classNames: {
          toast:
            '!rounded-card !border-0 !bg-ink !font-display !text-[17px] !font-semibold !text-bg !shadow-sticker',
          description: '!text-bg/80',
        },
      }}
      {...props}
    />
  )
}
