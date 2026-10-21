import type { RenderOptions } from './interpreter.ts'
import type { NavigationMapBinding } from './navigation-map-state.ts'
import { projectArtifactExecution, projectArtifactFile } from './artifact-execution.ts'
import { confinedEditableArtifact } from './text-artifact-edit.ts'

/** A path in canonical JSON is a reference, not proof of a published artifact. */
export function navigationNodeExecution(id: string, record: Record<string, unknown>, binding: NavigationMapBinding, options?: RenderOptions) {
  if (!binding.nodes.artifact) return undefined
  const raw = record[binding.nodes.artifact]
  const candidate = typeof raw === 'string' && raw !== '' ? raw : binding.nodes.artifact_kind
    ? projectArtifactFile(id, options?.executionAttempts ?? [], binding.nodes.artifact_kind, options?.artifactFiles ?? {}, undefined, options?.artifactActivities) : undefined
  const path = typeof candidate === 'string' && options?.skill && confinedEditableArtifact(candidate, options.skill)
    ? candidate : undefined
  // Invalid explicit references must not erase the path constraint and fall
  // back to another attempt with the same record ID.
  if (typeof raw === 'string' && raw !== '' && path === undefined) return { status: 'pending' as const }
  return projectArtifactExecution(id, options?.executionAttempts, binding.nodes.artifact_kind,
    path !== undefined && options?.artifactFiles?.[path] !== undefined, 'pending', path, options?.artifactActivities)
}
