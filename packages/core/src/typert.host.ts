/**
 * Host Typert contribution for the Design Panel Remote. The Harness Typert
 * loader imports this package subpath and registers the strict invocation
 * descriptors independently of the client namespace mount and SRC markers.
 */
import TYPERT_REMOTE from './typert.remote-client.ts'

/** Strict Host invocation definitions discovered through the `./typert` export. */
export const TYPERT = {
  package: TYPERT_REMOTE.package,
  face: 'host',
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: TYPERT_REMOTE.descriptors,
} as const

export default TYPERT
