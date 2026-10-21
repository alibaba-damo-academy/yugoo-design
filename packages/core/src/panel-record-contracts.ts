import type { EditorField, PanelManifest, PanelSection } from './panel-dsl.ts'
import { isEditorField, isPanelSection, isSafeDottedPath, isStringList, validateScalarDefaults } from './panel-contract-primitives.ts'

/** Record-control contracts are independent of component rendering and Hosts. */
export function validateNestedRecordField(field: EditorField, manifest: PanelManifest, validateLeaf: (manifest: PanelManifest) => string[]): string[] {
  const errors: string[] = []
    if (field.item_fields !== undefined || field.item_defaults !== undefined || field.item_label_field !== undefined) {
      if (field.control !== 'record_map' || field.columns !== undefined || !Array.isArray(field.item_fields) || field.item_fields.length === 0) {
        errors.push(`field ${field.key}: typed record_map requires non-empty item_fields instead of columns`)
      } else {
        // Keep this leaf editor deliberately bounded. Reuse field validation
        // without permitting recursively nested forms or cross-record writes.
        const supported = ['text', 'textarea', 'number', 'toggle', 'select', 'radio', 'list', 'multi_select', 'token_list', 'radio_custom', 'color', 'record_select']
        const valid = field.item_fields.every(item => isEditorField(item) && isSafeDottedPath(item.key) && !item.key.includes('.')
          && item.key !== field.id_field && supported.includes(item.control) && item.applies_to === undefined
          && item.required_in === undefined
          && item.item_fields === undefined && item.item_defaults === undefined && item.item_label_field === undefined
          && item.columns === undefined && item.hierarchy === undefined && item.options_from_panel === undefined
          && (item.control === 'record_select'
            ? manifest.sections.some(section => section.id === item.options_from_section)
            : item.options_from_section === undefined))
        if (!valid) errors.push(`field ${field.key}: item_fields must be local non-recursive typed fields, excluding identity`)
        else {
          let local = 'nested-items'
          while (manifest.sections.some(section => section.id === local)) local += '-local'
          const child: PanelManifest = { version: 1, panel_kind: 'document',
            sections: [...manifest.sections.map(section => ({ id: section.id, title: section.title })), { id: local, title: 'Items' }],
            fields: field.item_fields.map(item => ({ ...item, applies_to: [local] })), ui: { id: 'item-editor', component: 'record_form', source: local },
            ...(manifest.i18n ? { i18n: manifest.i18n } : {}) }
          errors.push(...validateLeaf(child).map(error => `field ${field.key}.item_fields: ${error}`))
          if (field.item_label_field !== undefined && !field.item_fields.some(item => item.key === field.item_label_field && item.control === 'text')) errors.push(`field ${field.key}: item_label_field must name a text field`)
          if (field.item_defaults !== undefined) {
            errors.push(...validateScalarDefaults(field.item_defaults, `field ${field.key}.item_defaults`))
            if (field.item_defaults && typeof field.item_defaults === 'object') for (const key of Object.keys(field.item_defaults)) {
              if (!field.item_fields.some(item => item.key === key)) errors.push(`field ${field.key}: undeclared item default ${key}`)
            }
          }
        }
      }
    }
  return errors
}

export function validateIncidentDeletion(sections: readonly unknown[], fields: readonly unknown[]): string[] {
  const errors: string[] = [], sectionIds = new Set(sections.filter(isPanelSection).map(section => section.id))
  for (const section of sections) {
    if (!isPanelSection(section) || section.delete_relations === undefined) continue
    if (!Array.isArray(section.delete_relations)) { errors.push(`section ${section.id}: delete_relations must be a list`); continue }
    const seen = new Set<string>()
    for (const target of section.delete_relations) {
      if (!target || typeof target !== 'object' || typeof target.section !== 'string' || target.section === section.id
        || !sectionIds.has(target.section) || seen.has(target.section)
        || !isStringList(target.reference_fields) || target.reference_fields.length === 0
        || new Set(target.reference_fields).size !== target.reference_fields.length) { errors.push(`section ${section.id}: invalid delete_relations target`); continue }
      seen.add(target.section)
      for (const key of target.reference_fields) {
        const reference = fields.find((field): field is EditorField => isEditorField(field) && field.key === key && Array.isArray(field.applies_to) && field.applies_to.includes(target.section))
        if (reference?.control !== 'record_select' || reference.options_from_section !== section.id) errors.push(`section ${section.id}: delete_relations needs declared single endpoint references`)
      }
      const linked = sections.find((candidate): candidate is PanelSection => isPanelSection(candidate) && candidate.id === target.section)
      const ownerPath = section.records_path ?? section.id, linkPath = linked?.records_path ?? target.section
      if (typeof ownerPath === 'string' && typeof linkPath === 'string' && (ownerPath === linkPath || ownerPath.startsWith(`${linkPath}.`) || linkPath.startsWith(`${ownerPath}.`))) errors.push(`section ${section.id}: relation cleanup collections must not overlap`)
      if (linked?.delete_children?.length || linked?.delete_relations?.length) errors.push(`section ${section.id}: chained relation deletion is not supported`)
      if (Array.isArray(section.delete_children) && section.delete_children.some(child => child?.section === target.section)) errors.push(`section ${section.id}: relation cleanup cannot overlap child ownership`)
    }
  }
  return errors
}
