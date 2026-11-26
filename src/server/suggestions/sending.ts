// Sends in flight, by suggestion id (ruling 4). One process serves the app, so a claim here stops
// a second send, and a done or dismiss, of the same suggestion while GitHub answers.
const inFlight = new Set<number>()

/** Claims the id for one send; false when a send of it is already running. */
export function claimSend(id: number): boolean {
  if (inFlight.has(id)) return false
  inFlight.add(id)
  return true
}

export function releaseSend(id: number): void {
  inFlight.delete(id)
}

export function isSending(id: number): boolean {
  return inFlight.has(id)
}
