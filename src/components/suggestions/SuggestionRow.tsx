import { cs } from '~/lib/strings'

// The parts a suggestion row shows on both lists (#247): Moje návrhy on Profil and Návrhy on
// Správa. Text wraps, never cut; a sent one links to its issue in a new tab.

export function SuggestionText({
  title,
  description,
}: {
  title: string
  description: string | null
}) {
  return (
    <>
      <b className="text-row font-bold break-words">{title}</b>
      {description && (
        <p className="text-meta break-words whitespace-pre-line text-muted">{description}</p>
      )}
    </>
  )
}

export function IssueLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-tap w-fit items-center font-bold underline decoration-1 underline-offset-4"
    >
      {cs.suggestions.issueLink}
    </a>
  )
}
