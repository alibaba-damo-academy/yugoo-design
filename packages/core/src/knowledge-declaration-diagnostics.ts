/** Authoring advice over existing declarations; never changes schema or load validity. */
import type { DesignSkill } from './types.ts'
import type { PanelManifest } from './panel-dsl.ts'
import type { SchemaSpec } from './schema.ts'
import { pointerKey } from './design-graph-content.ts'

export interface KnowledgeDeclarationDiagnostic {
  readonly code: 'knowledge.reference_role' | 'knowledge.reference_target'
  readonly subject: string
  readonly schemaPointer: string
  readonly panelSection: string
  readonly field: string
  readonly expectedTarget: string
  readonly message: string
}

interface LocatedSchema { spec: SchemaSpec; pointer: string; metadata: boolean }
function locate(root: LocatedSchema | undefined, path: string): LocatedSchema | undefined {
  let current = root
  for (const key of path.split('.').filter(Boolean)) {
    if (!current) return
    const child = current.spec.properties?.[key]
    if (!child) return
    current = { spec: child, pointer: `${current.pointer}/properties/${pointerKey(key)}`,
      metadata: current.metadata || child.knowledge?.role === 'metadata' }
  }
  return current
}

/**
 * A direct single-collection selector already declares identifier semantics.
 * Compare it with the owning schema, not names, labels, sample values or graph size.
 * Multi-target selectors, native/absent panels, external/free-form references and
 * explicitly metadata-owned values are outside this bounded diagnostic.
 */
export function diagnoseKnowledgeDeclarations(skills: readonly DesignSkill[]): KnowledgeDeclarationDiagnostic[] {
  const definitions = new Map(skills.flatMap(skill => {
    const schema = skill.metadata?.schemaDocument as SchemaSpec | undefined
    const panel = skill.metadata?.panelManifest as PanelManifest | undefined
    return schema && panel ? [[skill.name, { schema, panel }] as const] : []
  }))
  const candidates = new Map<string, { subject: string; schema: LocatedSchema; section: string; field: string; targets: Set<string> }>()
  const multiTarget = new Set<string>()
  for (const [name, { schema, panel }] of definitions) {
    if (schema.knowledge?.source_kind === 'derived') continue
    const root = { spec: schema, pointer: '', metadata: schema.knowledge?.role === 'metadata' }
    for (const field of panel.fields) {
      if (!['record_select', 'record_multi_select'].includes(field.control)) continue
      const multiple = Array.isArray(field.options_from_sections) && field.options_from_sections.length > 1
      const owner = field.options_from_panel?.panel_type ?? name
      const target = definitions.get(owner)
      const sectionId = field.options_from_panel?.section_id ?? field.options_from_section
      const targetSection = target?.panel.sections.find(section => section.id === sectionId)
      const targetPath = targetSection && (targetSection.records_path ?? targetSection.id)
      const targetSchema = targetPath && target ? locate({ spec: target.schema, pointer: '', metadata: target.schema.knowledge?.role === 'metadata' }, targetPath) : undefined
      const expected = targetPath && targetSchema?.spec.type === 'map' && !targetSchema.metadata
        ? `${owner}/${owner}.json#/${targetPath.split('.').map(pointerKey).join('/')}` : undefined
      for (const section of panel.sections) {
        if (field.applies_to && !field.applies_to.includes(section.id)) continue
        const collection = locate(root, section.records_path ?? section.id)
        if (collection?.spec.type !== 'map' || !collection.spec.value) continue
        const value = collection.spec.value
        const record = { spec: value, pointer: `${collection.pointer}/value`, metadata: collection.metadata || value.knowledge?.role === 'metadata' }
        let leaf = locate(locate(record, section.fields_path ?? ''), field.key)
        if (field.control === 'record_multi_select' && leaf?.spec.type === 'array' && leaf.spec.items) {
          leaf = { spec: leaf.spec.items, pointer: `${leaf.pointer}/items`, metadata: leaf.metadata || leaf.spec.items.knowledge?.role === 'metadata' }
        }
        if (!leaf || leaf.spec.type !== 'string' || leaf.metadata) continue
        const key = JSON.stringify([name, leaf.pointer])
        if (multiple) { multiTarget.add(key); continue }
        if (!expected) continue
        const previous = candidates.get(key)
        if (previous) previous.targets.add(expected)
        else candidates.set(key, { subject: name, schema: leaf, section: section.id, field: field.key, targets: new Set([expected]) })
      }
    }
  }
  const diagnostics: KnowledgeDeclarationDiagnostic[] = []
  for (const [key, candidate] of candidates) {
    if (multiTarget.has(key) || candidate.targets.size !== 1) continue
    const expectedTarget = [...candidate.targets][0]
    const semantics = candidate.schema.spec.knowledge
    const declared = semantics?.target?.startsWith('#') ? `${candidate.subject}/${candidate.subject}.json${semantics.target}` : semantics?.target
    const code = semantics?.role !== 'reference' ? 'knowledge.reference_role'
      : declared !== expectedTarget ? 'knowledge.reference_target' : undefined
    if (!code) continue
    diagnostics.push({ code, subject: candidate.subject, schemaPointer: candidate.schema.pointer,
      panelSection: candidate.section, field: candidate.field, expectedTarget,
      message: `${candidate.subject}/schema.yaml#${candidate.schema.pointer}: panel.yaml section ${candidate.section} field ${candidate.field} selects records from ${expectedTarget}; ${code === 'knowledge.reference_role' ? 'the schema does not declare knowledge.role: reference' : `knowledge.target is ${JSON.stringify(semantics?.target ?? null)}`}. Review the owning declaration; no schema or Design Files were changed.` })
  }
  return diagnostics.sort((a, b) => a.subject.localeCompare(b.subject) || a.schemaPointer.localeCompare(b.schemaPointer))
}
