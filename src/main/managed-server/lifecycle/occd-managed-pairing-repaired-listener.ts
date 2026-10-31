let listener: (environmentId: string) => void | Promise<void> = () => {}

export function setManagedOCCdPairingRepairedListener(
  next: (environmentId: string) => void | Promise<void>
): void {
  listener = next
}

export function notifyManagedOCCdPairingRepaired(environmentId: string): void | Promise<void> {
  return listener(environmentId)
}
