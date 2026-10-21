/** Knowledge models independent sources, not derived compilation/handoff documents. */
import type { SchemaSpec } from './schema.ts'

export const DESIGN_KNOWLEDGE_SOURCE_POLICY_VERSION = 'independent-sources-v1'

/** Unannotated Bundles remain independent; no filename or business-word guessing. */
export function isIndependentDesignSource(file: string, schemas: Record<string, SchemaSpec> = {}): boolean {
  const owner = file.replace(/^design_files\//u, '').split('/')[0]
  return schemas[`${owner}/${owner}.json`]?.knowledge?.source_kind !== 'derived'
}

/** Schema-only eligibility changes must invalidate semantic generation reuse. */
export function designKnowledgeSourcePolicyIdentity(schemas: Record<string, SchemaSpec> = {}): string {
  return JSON.stringify([DESIGN_KNOWLEDGE_SOURCE_POLICY_VERSION,
    Object.entries(schemas).filter(([, schema]) => schema.knowledge?.source_kind === 'derived').map(([file]) => file).sort()])
}
