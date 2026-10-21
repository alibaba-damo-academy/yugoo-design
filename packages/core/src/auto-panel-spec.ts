/** Server-owned validation for generated Design File panels.
 * A generated layout never grants itself permission to edit Design Files. */
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { compileSchema, type SchemaSpec } from './schema.ts'
import { validatePanelManifest, type ComponentNode, type EditorField, type PanelManifest } from './panel-dsl.ts'
import { GENERATED_COMPONENT_KINDS } from './panel-component-catalog.ts'

const PROTOCOL = 'a2ui/v0.9'
const MAX_BYTES = 32_768
const GENERIC_CATALOG = 'urn:dsh:panel-catalog:design-files:v1'

/** These string fields are completely projected by the question component.
 * Other configuration may be partially projected (for example nested choices),
 * so keep a readable overview rather than silently hiding declared content. */
export function questionNeedsOverview(properties: Readonly<Record<string, SchemaSpec>>): boolean {
  const textFields = new Set(['prompt', 'answer', 'detail', 'note'])
  return Object.entries(properties).some(([key, spec]) => spec.knowledge?.role !== 'metadata'
    && !(textFields.has(key) && spec.type === 'string'))
}

type JsonObject = Record<string, unknown>

export interface AutoPanelContext {
  readonly kit: string
  readonly kitVersion: string
  readonly bundle: string
  readonly bundleVersion: string
  readonly schema: SchemaSpec
  readonly state: JsonObject
  /** Bundle-owned Design File artifacts, keyed by relative path and content digest. */
  readonly artifacts?: Readonly<Record<string, string>>
}

export interface AutoPanelSnapshot {
  readonly version: 2
  readonly protocol: typeof PROTOCOL
  readonly catalogId: string
  readonly kit: string
  readonly kitVersion: string
  readonly bundle: string
  readonly bundleVersion: string
  readonly schemaDigest: string
  readonly structureDigest: string
  /** Until generated prose has trusted dependency bindings, any fact change stales it. */
  readonly stateDigest: string
  readonly messages: readonly unknown[]
}

function record(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function keysExactly(value: JsonObject, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
}


/** The auto Panel's closed, host-neutral component catalog. New entries need
 * matching DSL validation, server binding checks, renderer, tokens and tests. */
export const AUTO_PANEL_COMPONENT_KINDS = GENERATED_COMPONENT_KINDS
const GENERIC_COMPONENTS = new Set<string>(AUTO_PANEL_COMPONENT_KINDS)
const EDIT_CONTROLS = new Set(['text', 'textarea', 'number', 'select', 'radio', 'toggle', 'list', 'rows'])

function schemaAtPath(schema: SchemaSpec, path: string): SchemaSpec | undefined {
  let current: SchemaSpec | undefined = schema
  for (const part of path.split('.')) {
    if (!/^[a-zA-Z][\w-]*$/u.test(part) || ['__proto__', 'constructor', 'prototype'].includes(part)) return undefined
    current = current?.type === 'object' ? current.properties?.[part] : undefined
  }
  return current
}

function compatibleControl(spec: SchemaSpec | undefined, field: EditorField): boolean {
  if (spec?.knowledge?.role === 'metadata' || spec?.knowledge?.role === 'reference') return false
  if (spec?.type === 'string') return field.control === 'text' || field.control === 'textarea'
  if (spec?.type === 'number') return field.control === 'number'
  if (spec?.type === 'boolean') return field.control === 'toggle'
  if (spec?.type === 'enum') return (field.control === 'select' || field.control === 'radio')
    && Array.isArray(field.options) && field.options.length === spec.values?.length
    && new Set(field.options.map(option => option.value)).size === field.options.length
    && field.options.every(option => spec.values?.includes(option.value))
  if (spec?.type === 'array' && spec.items?.type === 'string') return field.control === 'list'
  return false
}

function artifactRefsAtPattern(schema: SchemaSpec, state: JsonObject, pattern: string): string[] {
  const parts = pattern.split('.')
  if (parts.length < 2 || parts.length > 9 || parts.some(part => part !== '*'
    && (!/^[a-zA-Z][\w-]*$/u.test(part) || ['__proto__', 'constructor', 'prototype'].includes(part)))) {
    throw new Error('auto panel: invalid artifact reference pattern')
  }
  const visit = (spec: SchemaSpec | undefined, value: unknown, index: number): string[] => {
    if (index === parts.length) {
      if (spec?.type !== 'string') throw new Error('auto panel: artifact reference must bind a string schema field')
      if (value === undefined || value === null || value === '') return []
      if (typeof value !== 'string') throw new Error('auto panel: artifact reference is not a path')
      return [value]
    }
    const part = parts[index]
    if (value === undefined || value === null) return []
    if (part === '*') {
      if (spec?.type !== 'map' || !record(value)) throw new Error('auto panel: artifact wildcard must traverse a map')
      return Object.values(value).flatMap(entry => visit(spec.value, entry, index + 1))
    }
    if (spec?.type !== 'object' || spec.properties?.[part] === undefined || !record(value)) {
      throw new Error('auto panel: artifact reference pattern does not match Design JSON')
    }
    return visit(spec.properties[part], Object.hasOwn(value, part) ? value[part] : undefined, index + 1)
  }
  return visit(schema, state, 0)
}

/** A generated A2UI node carries only a declarative manifest from the fixed
 * shared component catalog. The server checks it against actual Bundle data. */
function genericPanelNode(components: unknown, context: AutoPanelContext): PanelManifest {
  if (!Array.isArray(components) || components.length !== 1 || !record(components[0])
    || !keysExactly(components[0], ['id', 'component', 'manifest'])
    || components[0].id !== 'root' || components[0].component !== 'DesignPanel'
    || !record(components[0].manifest)) throw new Error('auto panel: expected one DesignPanel component')
  const manifest = components[0].manifest as unknown as PanelManifest
  const errors = validatePanelManifest(manifest)
  if (errors.length > 0) throw new Error(`auto panel: invalid declarative view: ${errors.join('; ')}`)
  if (manifest.sections.length > 12 || manifest.fields.length > 80) throw new Error('auto panel: generated view exceeds catalog limits')
  const sections = new Map<string, SchemaSpec>()
  for (const section of manifest.sections) {
    const path = section.records_path ?? section.id
    const spec = schemaAtPath(context.schema, path)
    if (path.includes('.') || spec?.type !== 'map' || spec.value?.type !== 'object' || !record(context.state[path])) {
      throw new Error(`auto panel: section ${JSON.stringify(section.id)} is not a source record map`)
    }
    if (section.fields_path !== undefined || section.order !== undefined || section.add_mode === 'graph' || section.form !== undefined) {
      throw new Error('auto panel: unsupported generated section binding')
    }
    sections.set(section.id, spec.value)
  }
  for (const field of manifest.fields) {
    if (!EDIT_CONTROLS.has(field.control) || !Array.isArray(field.applies_to) || field.applies_to.length === 0
      || field.options_from_panel !== undefined || field.options_from_section !== undefined || field.hierarchy !== undefined
      || field.visible_when !== undefined || field.label_when !== undefined || field.required_in !== undefined || field.choice_layout !== undefined || field.custom_focus !== undefined || field.textarea_rows !== undefined
      || field.allow_clear !== undefined || field.token_add_mode !== undefined || field.token_add_description !== undefined || field.token_custom_icon !== undefined
      || field.options?.some(option => option.icon !== undefined || option.menu_description !== undefined || option.selected_description !== undefined)
      || field.key.includes('.')) throw new Error('auto panel: unsupported generated editor field')
    for (const section of field.applies_to) {
      if (!compatibleControl(sections.get(section)?.properties?.[field.key], field)) {
        throw new Error(`auto panel: field ${JSON.stringify(field.key)} does not match schema`)
      }
    }
  }
  const covered = new Set<string>()
  const seen = new Set<string>()
  const visit = (node: ComponentNode): void => {
    if (!GENERIC_COMPONENTS.has(node.component) || seen.has(node.id)) throw new Error('auto panel: untrusted or duplicate generated component')
    // Coverage must count only branches consumed by the shared interpreter.
    // Otherwise an ignored leaf child can falsely satisfy the overview guard.
    if (node.component === 'stack' || node.component === 'tabs') {
      if (node.slots !== undefined) throw new Error('auto panel: generated layout has unrendered slots')
    } else if (node.component === 'split') {
      if (node.children !== undefined || Object.keys(node.slots ?? {}).some(key => key !== 'sidebar' && key !== 'main')) {
        throw new Error('auto panel: generated split has unrendered branches')
      }
    } else if (node.children !== undefined || node.slots !== undefined) {
      throw new Error('auto panel: generated leaf has unrendered branches')
    }
    if (node.card_groups !== undefined) throw new Error('auto panel: authored card groups are not supported')
    if (node.sidebar_icon !== undefined) throw new Error('auto panel: authored sidebar icons are not supported')
    if (node.rounds_source !== undefined) throw new Error('auto panel: authored round context is not supported')
    if (node.record_table !== undefined) throw new Error('auto panel: authored record table is not supported')
    if (node.record_cards !== undefined || node.navigation_hierarchy !== undefined) throw new Error('auto panel: authored reading/navigation composition is not supported')
    if (node.inherit_from_graph !== undefined || node.graph?.hierarchy?.max_parents !== undefined) throw new Error('auto panel: authored hierarchy policy is not supported')
    if (node.question_policy?.allow_choice_actions !== undefined) throw new Error('auto panel: authored choice actions are not supported')
    seen.add(node.id)
    if (node.component === 'structured_data') {
      const sourceSpec = typeof node.source === 'string' ? schemaAtPath(context.schema, node.source) : undefined
      if (typeof node.source !== 'string' || sourceSpec === undefined || sourceSpec.knowledge?.role === 'metadata'
        || !Object.hasOwn(context.state, node.source.split('.')[0])) throw new Error('auto panel: structured view has invalid source')
      covered.add(node.source)
      covered.add(node.source.split('.')[0])
    } else if (node.component === 'schema_field') {
      if (typeof node.path !== 'string' || typeof node.control !== 'string'
        || !compatibleControl(schemaAtPath(context.schema, node.path), {
          key: node.path, control: node.control as EditorField['control'], applies_to: [], options: node.options,
        })) throw new Error('auto panel: scalar field does not match schema')
      covered.add(node.path)
      covered.add(node.path.split('.')[0])
    } else if (node.component === 'artifact_gallery') {
      if (!Array.isArray(node.paths) || node.paths.length === 0 || node.paths.length > 30
        || node.paths.some(path => typeof path !== 'string' || !Object.hasOwn(context.artifacts ?? {}, path))) {
        throw new Error('auto panel: artifact view has unowned path')
      }
      for (const path of node.paths) covered.add(`artifact:${path}`)
    } else if (node.component === 'related_artifacts') {
      if (!Array.isArray(node.paths_from) || node.paths_from.length === 0 || node.paths_from.length > 12) {
        throw new Error('auto panel: related artifacts need schema-bound paths')
      }
      let referenceCount = 0
      for (const pattern of node.paths_from) {
        for (const path of artifactRefsAtPattern(context.schema, context.state, pattern)) {
          if (++referenceCount > 100) throw new Error('auto panel: too many related artifact references')
          if (!Object.hasOwn(context.artifacts ?? {}, path)) throw new Error('auto panel: related artifact is not Bundle-owned')
          covered.add(`artifact:${path}`)
        }
      }
    } else if (node.component === 'nested_collection') {
      const spec = typeof node.source === 'string' ? context.schema.properties?.[node.source] : undefined
      const child = typeof node.children_field === 'string' ? spec?.value?.properties?.[node.children_field] : undefined
      if (spec?.type !== 'map' || spec.value?.type !== 'object' || !record(context.state[node.source ?? ''])
        || spec.value.properties?.[node.label_field ?? '']?.type !== 'string'
        || child?.type !== 'map' || child.value?.type !== 'object'
        || child.value.properties?.[node.child_label_field ?? '']?.type !== 'string') {
        throw new Error('auto panel: nested collection does not match two-level record schema')
      }
      covered.add(node.source as string)
    } else if (node.component === 'record_form' || node.component === 'grouped_records' || node.component === 'question_workspace') {
      const section = manifest.sections.find(entry => entry.id === node.source)
      if (section === undefined) throw new Error('auto panel: editor has invalid source')
      covered.add((section.records_path ?? section.id).split('.')[0])
      const declared = sections.get(section.id)?.properties ?? {}
      if (node.component === 'grouped_records'
        && (typeof node.group_by !== 'string' || !['string', 'enum'].includes(String(declared[node.group_by]?.type))
          || ['metadata', 'reference'].includes(String(declared[node.group_by]?.knowledge?.role)))) {
        throw new Error('auto panel: grouped records need a declared scalar grouping field')
      }
      if (node.component === 'question_workspace') {
        if (declared.prompt?.type !== 'string' || declared.answer?.type !== 'string'
          || declared.detail?.type !== 'string') throw new Error('auto panel: question component requires matching schema fields')
        if (questionNeedsOverview(declared) && !hasStructuredSource(manifest.ui, (section.records_path ?? section.id).split('.')[0])) {
          throw new Error('auto panel: question fields omitted without readable overview')
        }
        return
      }
      const shown = new Set(manifest.fields.filter(field => field.applies_to?.includes(section.id)).map(field => field.key))
      const omitted = Object.entries(declared).filter(([key, spec]) => spec.knowledge?.role !== 'metadata' && !shown.has(key))
      if (omitted.length > 0 && !hasStructuredSource(manifest.ui, (section.records_path ?? section.id).split('.')[0])) {
        throw new Error('auto panel: record fields omitted without readable overview')
      }
    }
    for (const child of node.children ?? []) visit(child)
    for (const child of Object.values(node.slots ?? {})) if (child !== undefined) visit(child)
  }
  visit(manifest.ui)
  for (const [key, spec] of Object.entries(context.schema.properties ?? {})) {
    const missingObjectField = spec.type === 'object' && !hasStructuredSource(manifest.ui, key)
      && Object.entries(spec.properties ?? {}).some(([field, fieldSpec]) => fieldSpec.knowledge?.role !== 'metadata'
        && !covered.has(`${key}.${field}`))
    if (spec.knowledge?.role !== 'metadata' && Object.hasOwn(context.state, key)
      && (!covered.has(key) || missingObjectField)) {
      throw new Error(`auto panel: Design File source ${JSON.stringify(key)} is not visible`)
    }
  }
  for (const path of Object.keys(context.artifacts ?? {})) {
    if (!covered.has(`artifact:${path}`)) throw new Error(`auto panel: artifact ${JSON.stringify(path)} is not visible`)
  }
  return manifest
}

function hasStructuredSource(node: ComponentNode, source: string): boolean {
  return node.component === 'structured_data' && node.source === source
    || (node.children ?? []).some(child => hasStructuredSource(child, source))
    || Object.values(node.slots ?? {}).some(child => child !== undefined && hasStructuredSource(child, source))
}

function hasQuestionSource(node: ComponentNode, source: string): boolean {
  return node.component === 'question_workspace' && node.source === source
    || (node.children ?? []).some(child => hasQuestionSource(child, source))
    || Object.values(node.slots ?? {}).some(child => child !== undefined && hasQuestionSource(child, source))
}

/** Identity, prompts and options affect layout; answer/detail values do not. */
export function autoPanelStructureDigest(context: AutoPanelContext): string {
  if (context.schema.type !== 'object') throw new Error('auto panel: expected object Design File schema')
  return digest([context.schema, Object.keys(context.state).sort(), context.artifacts ?? {}])
}

/** Construct server-owned metadata around an already generated A2UI layout. */
export function autoPanelSnapshot(context: AutoPanelContext, messages: readonly unknown[]): AutoPanelSnapshot {
  const snapshot: AutoPanelSnapshot = {
    version: 2,
    protocol: PROTOCOL,
    catalogId: GENERIC_CATALOG,
    kit: context.kit,
    kitVersion: context.kitVersion,
    bundle: context.bundle,
    bundleVersion: context.bundleVersion,
    schemaDigest: digest(context.schema),
    structureDigest: autoPanelStructureDigest(context),
    stateDigest: digest([context.state, context.artifacts ?? {}]),
    messages,
  }
  validateAutoPanelSnapshot(snapshot, context)
  return snapshot
}

/** Fail closed against stale facts, arbitrary actions, data duplication and unknown components. */
export function validateAutoPanelSnapshot(candidate: unknown, context: AutoPanelContext): asserts candidate is AutoPanelSnapshot {
  if (!record(candidate) || JSON.stringify(candidate).length > MAX_BYTES) throw new Error('auto panel: invalid or oversized snapshot')
  if (!keysExactly(candidate, ['version', 'protocol', 'catalogId', 'kit', 'kitVersion', 'bundle', 'bundleVersion', 'schemaDigest', 'structureDigest', 'stateDigest', 'messages'])
    || candidate.version !== 2 || candidate.protocol !== PROTOCOL
    || candidate.catalogId !== GENERIC_CATALOG
    || candidate.kit !== context.kit || candidate.kitVersion !== context.kitVersion
    || candidate.bundle !== context.bundle || candidate.bundleVersion !== context.bundleVersion) {
    throw new Error('auto panel: identity or protocol mismatch')
  }
  if (candidate.schemaDigest !== digest(context.schema) || candidate.structureDigest !== autoPanelStructureDigest(context)
    || candidate.stateDigest !== digest([context.state, context.artifacts ?? {}])) {
    throw new Error('auto panel: stale schema or Design File content')
  }
  if (!Array.isArray(candidate.messages) || candidate.messages.length !== 2) throw new Error('auto panel: expected one surface and one component update')
  const [create, update] = candidate.messages
  if (!record(create) || !keysExactly(create, ['version', 'createSurface']) || create.version !== 'v0.9'
    || !record(create.createSurface) || !keysExactly(create.createSurface, ['surfaceId', 'catalogId', 'sendDataModel'])
    || create.createSurface.surfaceId !== 'auto-panel' || create.createSurface.catalogId !== candidate.catalogId
    || create.createSurface.sendDataModel !== false) throw new Error('auto panel: invalid surface declaration')
  if (!record(update) || !keysExactly(update, ['version', 'updateComponents']) || update.version !== 'v0.9'
    || !record(update.updateComponents) || !keysExactly(update.updateComponents, ['surfaceId', 'components'])
    || update.updateComponents.surfaceId !== 'auto-panel') throw new Error('auto panel: invalid component update')
  genericPanelNode(update.updateComponents.components, context)
}

/** Use the shared Panel interpreter for the validated catalog component. */
export function autoPanelManifest(snapshot: AutoPanelSnapshot, context: AutoPanelContext): PanelManifest {
  validateAutoPanelSnapshot(snapshot, context)
  const update = snapshot.messages[1] as { updateComponents: { components: unknown } }
  return genericPanelNode(update.updateComponents.components, context)
}

/** Export the supported, fully validated A2UI surface as an ordinary Panel DSL
 * document (JSON is also valid YAML). This is definition conversion only:
 * it neither publishes a Kit nor grants the definition authority to save data.
 * Callers must retain generated-panel write checks when adopting this document.
 * Unknown protocols, stale snapshots and unsupported components fail closed.
 */
export function exportAutoPanelDsl(snapshot: AutoPanelSnapshot, context: AutoPanelContext): string {
  const manifest = autoPanelManifest(snapshot, context)
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (record(value)) return Object.fromEntries(Object.keys(value).sort()
      .map(key => [key, canonical(value[key])]))
    return value
  }
  return `${JSON.stringify(canonical(manifest), null, 2)}\n`
}

/** Persistent project-owned definition, separate from the disposable A2UI cache.
 * Source changes are reported, not silently regenerated. This envelope remains
 * generated-origin: promotion never removes the generated editor's restrictions.
 */
export interface SavedAutoPanelDefinition {
  readonly version: 1
  readonly origin: 'a2ui'
  readonly protocol: typeof PROTOCOL
  readonly catalogId: string
  readonly kit: string
  readonly kitVersion: string
  readonly bundle: string
  readonly bundleVersion: string
  readonly schemaDigest: string
  readonly sourceDigest: string
  readonly dsl: string
}

export function preserveAutoPanelDefinition(snapshot: AutoPanelSnapshot, context: AutoPanelContext): SavedAutoPanelDefinition {
  const dsl = exportAutoPanelDsl(snapshot, context)
  return { version: 1, origin: 'a2ui', protocol: PROTOCOL, catalogId: GENERIC_CATALOG,
    kit: context.kit, kitVersion: context.kitVersion, bundle: context.bundle, bundleVersion: context.bundleVersion,
    schemaDigest: digest(context.schema), sourceDigest: digest([context.state, context.artifacts ?? {}]), dsl }
}

/** Call with the current authoritative Bundle schema/data, not client-provided
 * context. sourceChanged must be exposed by the consumer: generated static prose
 * may describe old facts even though its data-bound components remain usable.
 */
export function readSavedAutoPanelDefinition(candidate: unknown, context: AutoPanelContext): {
  manifest: PanelManifest; sourceChanged: boolean
} {
  if (!record(candidate) || !keysExactly(candidate, ['version', 'origin', 'protocol', 'catalogId', 'kit', 'kitVersion',
    'bundle', 'bundleVersion', 'schemaDigest', 'sourceDigest', 'dsl'])
    || candidate.version !== 1 || candidate.origin !== 'a2ui' || candidate.protocol !== PROTOCOL
    || candidate.catalogId !== GENERIC_CATALOG || candidate.kit !== context.kit || candidate.kitVersion !== context.kitVersion
    || candidate.bundle !== context.bundle || candidate.bundleVersion !== context.bundleVersion
    || candidate.schemaDigest !== digest(context.schema)
    || typeof candidate.sourceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.sourceDigest)
    || typeof candidate.dsl !== 'string' || Buffer.byteLength(candidate.dsl, 'utf8') > MAX_BYTES) {
    throw new Error('saved panel: incompatible or invalid definition')
  }
  const manifest = genericPanelNode([{ id: 'root', component: 'DesignPanel', manifest: JSON.parse(candidate.dsl) }], context)
  return { manifest, sourceChanged: candidate.sourceDigest !== digest([context.state, context.artifacts ?? {}]) }
}

export function validateSavedAutoPanelEdit(candidate: unknown, context: AutoPanelContext, after: unknown): void {
  const { manifest } = readSavedAutoPanelDefinition(candidate, context)
  validateAutoPanelEdit(context.state, after, context, manifest)
}

/** Generic save permissions come from the current schema and validated
 * binding, not from model-authored actions or duplicated Design JSON. */
export function validateAutoPanelEdit(before: JsonObject, after: unknown, context: AutoPanelContext, manifest: PanelManifest): void {
  if (!record(after) || Object.keys(after).sort().join('\0') !== Object.keys(before).sort().join('\0')) {
    throw new Error('auto panel: top-level Design File structure changed')
  }
  const checked = genericPanelNode([{ id: 'root', component: 'DesignPanel', manifest }], context)
  const sections = new Map(checked.sections.map(section => [section.records_path ?? section.id, section]))
  const scalarPaths = new Set<string>()
  const collect = (node: ComponentNode): void => {
    if (node.component === 'schema_field' && typeof node.path === 'string') scalarPaths.add(node.path)
    for (const child of node.children ?? []) collect(child)
    for (const child of Object.values(node.slots ?? {})) if (child !== undefined) collect(child)
  }
  collect(checked.ui)
  const assertScalarChanges = (oldValue: unknown, newValue: unknown, path: string): void => {
    if (isDeepStrictEqual(oldValue, newValue) || scalarPaths.has(path)) return
    if (record(oldValue) && record(newValue)
      && Object.keys(oldValue).sort().join('\0') === Object.keys(newValue).sort().join('\0')) {
      for (const key of Object.keys(oldValue)) assertScalarChanges(oldValue[key], newValue[key], `${path}.${key}`)
      return
    }
    throw new Error(`auto panel: read-only source ${JSON.stringify(path)} changed`)
  }
  for (const [key, oldValue] of Object.entries(before)) {
    const section = sections.get(key)
    if (section === undefined) {
      assertScalarChanges(oldValue, after[key], key)
      continue
    }
    const nextValue = after[key]
    if (!record(oldValue) || !record(nextValue) || Object.keys(nextValue).length > 500) {
      throw new Error(`auto panel: invalid record collection ${JSON.stringify(key)}`)
    }
    const question = hasQuestionSource(checked.ui, section.id)
    const editable = question ? new Set(['answer', 'detail'])
      : new Set(checked.fields.filter(field => field.applies_to?.includes(section.id)).map(field => field.key))
    if ((question || section.add_mode === 'none') && Object.keys(nextValue).sort().join('\0') !== Object.keys(oldValue).sort().join('\0')) {
      throw new Error(`auto panel: record identities changed in ${JSON.stringify(key)}`)
    }
    for (const [id, candidate] of Object.entries(nextValue)) {
      if (!/^[^/\\]{1,120}$/u.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id) || !record(candidate)) {
        throw new Error(`auto panel: invalid record ${JSON.stringify(id)}`)
      }
      const previous = oldValue[id]
      if (previous !== undefined && !record(previous)) throw new Error('auto panel: invalid original record')
      for (const field of new Set([...Object.keys(previous ?? {}), ...Object.keys(candidate)])) {
        if (!editable.has(field) && !isDeepStrictEqual(candidate[field], previous?.[field])) {
          throw new Error(`auto panel: protected field ${JSON.stringify(field)} changed`)
        }
      }
      if (question && record(previous) && candidate.answer !== previous.answer
        && (previous.kind === 'single' || previous.kind === 'multiple')) {
        const allowed = new Set(Array.isArray(previous.choices)
          ? previous.choices.filter(record).map(choice => choice.value).filter((value): value is string => typeof value === 'string')
          : [])
        const answers = String(candidate.answer ?? '').split(',').map(value => value.trim()).filter(Boolean)
        if ((previous.kind === 'single' && answers.length > 1) || answers.some(value => !allowed.has(value))) {
          throw new Error(`auto panel: answer uses an undeclared choice for ${JSON.stringify(id)}`)
        }
      }
    }
  }
  const errors = compileSchema(context.schema)(after)
  if (errors.length > 0) throw new Error(`auto panel: schema-invalid edit: ${errors.join('; ')}`)
}
