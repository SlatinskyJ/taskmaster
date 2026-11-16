import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Home,
})

// Placeholder until the UI shell lands; real screens use the Czech strings module.
function Home() {
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <h1 className="text-3xl font-bold">Taskmaster</h1>
    </main>
  )
}
