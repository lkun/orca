/** Managed launches alone enable idle exit and name the activation fence that keeps updates/rollbacks alive.
 * Dependency-free so the occd launcher can read it. */
export const OCCD_MANAGED_ACTIVATION_ROOT_ENV = 'OCC_OCCD_MANAGED_ACTIVATION_ROOT'

/** Host login env naming a machine's own managed-server data on a shared home; clones copy /etc/machine-id. */
export const OCC_MACHINE_NAME_ENV = 'OCC_MACHINE_NAME'
