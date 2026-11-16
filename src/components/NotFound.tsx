import { Link } from '@tanstack/react-router'

// Placeholder copy; moves to the Czech strings module with the UI shell.
export function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center gap-4 p-4">
      <p>Tahle stránka neexistuje.</p>
      <Link to="/" className="underline">
        Domů
      </Link>
    </main>
  )
}
