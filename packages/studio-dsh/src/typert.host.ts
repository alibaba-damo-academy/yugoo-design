/** Strict Host Typert contribution for Studio management. */
import TYPERT_REMOTE from './typert.remote-client.ts'

/** Host invocation definitions discovered through the package `./typert` export. */
export const TYPERT = {
  package: TYPERT_REMOTE.package,
  face: 'host',
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: TYPERT_REMOTE.descriptors,
} as const

export default TYPERT
