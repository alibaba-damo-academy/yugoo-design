import { PANEL_COMPONENT_CATALOG, COMPONENT_KINDS, GENERATED_COMPONENT_KINDS } from './panel-component-catalog.ts'

/** Exact catalog identity, not another vocabulary or a browser crypto dependency. */
export function panelAuthoringCatalogIdentity(): string {
  return JSON.stringify({ catalog: PANEL_COMPONENT_CATALOG, generated: GENERATED_COMPONENT_KINDS })
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** Query trusted packaged source references; never reads host paths or executes declarations. */
export function queryPanelAuthoringReference(material: unknown, name: string, reference: 'contract' | 'docs' | 'examples', type?: string): unknown {
  if (!Object.hasOwn(PANEL_COMPONENT_CATALOG, name)) throw Error('Unknown panel component')
  if (!['contract', 'docs', 'examples'].includes(reference) || (type !== undefined && reference !== 'contract')) throw Error('Invalid authoring reference query')
  if (!object(material) || material.format !== 'panel-authoring-reference/v1'
    || material.catalogIdentity !== panelAuthoringCatalogIdentity()
    || !object(material.components) || !object(material.contracts)
    || Object.keys(material.components).length !== COMPONENT_KINDS.length
    || !COMPONENT_KINDS.every(kind => Object.hasOwn(material.components as object, kind))) {
    throw Error('Authoring reference is missing or incompatible with the installed catalog')
  }
  const entry = material.components[name]
  if (!object(entry) || entry.component !== name) throw Error('Missing component authoring reference')
  // Installed callers follow query arguments, not the repository inspector's
  // --type CLI hints. This remains host-neutral pure data.
  const follow = (value: unknown) => {
    if (!object(value) || typeof value.name !== 'string' || !Object.hasOwn(material.contracts as object, value.name)) throw Error('Missing referenced local contract')
    return { ...value, read: { name, reference: 'contract', type: value.name } }
  }
  if (reference === 'docs') {
    if (!object(entry.documentation) || !Array.isArray(entry.documentation.sections) || !entry.documentation.sections.length) throw Error('Missing component documentation')
    return { component: name, documentation: { ...entry.documentation, read: { name, reference: 'docs' } }, limits: entry.limits, protocolStatus: entry.protocolStatus }
  }
  if (reference === 'examples') {
    if (!Array.isArray(entry.examples)) throw Error('Missing component examples')
    return { component: name, examples: entry.examples, coverage: entry.examples.length ? 'existing-structure-validated-usages' : 'no-existing-usage', limits: entry.limits }
  }
  if (type !== undefined) {
    if (!Object.hasOwn(material.contracts, type)) throw Error('Unknown local contract type or property')
    const declaration = material.contracts[type]
    if (!object(declaration) || declaration.name !== type || typeof declaration.declaration !== 'string' || !declaration.declaration.trim()) throw Error('Missing local contract declaration')
    if (!Array.isArray(declaration.references)) throw Error('Missing local contract references')
    return { component: name, contract: { ...declaration, references: declaration.references.map(follow) }, limits: entry.limits, protocolStatus: entry.protocolStatus }
  }
  if (!Array.isArray(entry.contracts) || !object(material.hostCallbackContract)) throw Error('Missing component contract references')
  return { ...entry, contracts: entry.contracts.map(follow), examples: undefined, documentation: undefined, hostCallbackContract: material.hostCallbackContract }
}
