export type BpmnRuntimeModule = typeof import('./bpmn-runtime.ts')

/** Async initialization shared by renderer consumers. DSH single-file factories
 * may inline the capsule; this API does not promise network code splitting. */
export function loadBpmnRuntime(): Promise<BpmnRuntimeModule> {
  return import('./bpmn-runtime.ts')
}
