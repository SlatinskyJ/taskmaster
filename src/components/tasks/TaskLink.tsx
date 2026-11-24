import { Link } from '@tanstack/react-router'

/**
 * A row's task name as a link to its page (#212): how a brother or a parent reaches a free task
 * to reopen its bidding, or a round to answer it.
 */
export function TaskLink({ id, title }: { id: number; title: string }) {
  return (
    <Link
      to="/ukol/$taskId"
      params={{ taskId: String(id) }}
      className="underline decoration-1 underline-offset-4"
    >
      {title}
    </Link>
  )
}
