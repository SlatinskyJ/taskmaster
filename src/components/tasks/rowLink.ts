/** Where a row opens (#205): a task or a chore's copy, or a recurring chore. */
export type RowLink =
  | { to: '/ukol/$taskId'; params: { taskId: string } }
  | { to: '/sablona/$templateId'; params: { templateId: string } }

export function taskLink(id: number): RowLink {
  return { to: '/ukol/$taskId', params: { taskId: String(id) } }
}

export function templateLink(id: number): RowLink {
  return { to: '/sablona/$templateId', params: { templateId: String(id) } }
}
