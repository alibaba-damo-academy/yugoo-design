/** Compile against production package exports, never source aliases. */
import {
  createStudioDraftPorts, createStudioInstanceAdapters, createStudioInstances, createStudioAuthoring,
  type StudioInstanceTrustedCaptures, type StudioAuthoringOptions,
} from 'dsh-design-studio/node'
import type { StudioInstanceChangeRequest } from 'dsh-design-studio'

export async function consume(stateRoot: string, trusted: StudioInstanceTrustedCaptures, scope: StudioAuthoringOptions['scope']) {
  const adapters = createStudioInstanceAdapters(trusted)
  const instances = await createStudioInstances({ stateRoot, ...adapters })
  const storage = await createStudioDraftPorts({ stateRoot }, 'instance')
  await storage.repository.transaction(async transaction => (await transaction.read(scope.id)).revision)
  const authoring = createStudioAuthoring({ scope, instances, readComponents: () => ({ components: [{ name: 'record_form' }] }) })
  const view = await authoring.read({ paths: ['panel.yaml'] })
  for (const file of view.files) if (file.exists) file.content satisfies string
  const prepared = await authoring.prepare({ changes: [{ path: 'panel.yaml', content: 'full replacement' }] })
  prepared.request satisfies StudioInstanceChangeRequest
  await instances.saveChanges({ ...prepared.request, mode: 'validated', digest: prepared.candidate.digest })
  // Meaningful negative capability/type checks in a strict emitted-dts consumer.
  // @ts-expect-error Native authoring capability never exposes save.
  authoring.saveChanges(prepared.request)
  // @ts-expect-error Deletion is excluded from this authoring capability.
  await authoring.prepare({ changes: [{ path: 'panel.yaml', content: null }] })
  // @ts-expect-error Identity cannot be overridden by a model read request.
  await authoring.read({ id: 'foreign', paths: ['panel.yaml'] })
  // @ts-expect-error File reads require an actual string instance identity.
  await instances.readFile({ id: 42, path: 'panel.yaml' })
  // @ts-expect-error Validated save requires the prepared candidate digest.
  await instances.saveChanges({ id: scope.id, expectedRevision: scope.expectedRevision, changes: [], mode: 'validated' })
}
