/**
 * Design Kit content loader. Reads a pure-content kit directory (mindset.md plus
 * skills/<name>/SKILL.md and optional declarative manifests) into a DesignKit.
 * This is what makes a community design system a zero-code content package: the
 * loader is shared machinery, the kit is data.
 */
import { dataTableSchemaMatches } from './data-table.ts'
import { isAbsolute, relative, resolve } from 'node:path'
import { parse, stringify } from 'yaml'
import { DesignBundleVersion, DesignKitVersion, deriveDesignBundleAuthorityId, DesignResumeActionId, type DesignBilingualText, type DesignKit, type DesignExecutionPolicy, type DesignResumeAction, type DesignSkill } from './types.ts'
import { parseSchemaYaml, compileSchema, type SchemaSpec } from './schema.ts'
import { parseValidationYaml } from './validation-rules.ts'
import { parseDeclarativeRendererManifest, parseDeclarativeSummary, type DeclarativeRendererManifest } from './renderer.ts'
import { parsePanelManifest, type PanelManifest } from './panel-dsl.ts'
import { validatePanelTranslations } from './panel-i18n.ts'
import { DesignDriverId } from './runtime-drivers.ts'
import { DesignSemanticCapabilityId, semanticCapabilitiesOf } from './semantic-capabilities.ts'
import { parseReviewSupport } from './review-support.ts'
import { compileDesignRelationVocabulary } from './design-relation-vocabulary.ts'
import { compileDesignOntologyContract } from './design-ontology.ts'

/** Filesystem surface needed to read a kit directory. */
export interface KitFsLike {
  /** Byte-complete captures (including binary resources) for project-owned copies. */
  readBytes?(path: string): Promise<Uint8Array | undefined>
  readText(path: string): Promise<string | undefined>
  /** Optional attached-resource projection only; definition slots still use readText. */
  readResource?(path: string): Promise<KitResourceContent | undefined>
  listDir(path: string): Promise<string[]>
  /** Distinguish an empty directory from a leaf file during resource walks. */
  isDirectory?(path: string): Promise<boolean>
  /** Resolve symlinks for confinement checks when backed by a real filesystem. */
  realPath?(path: string): Promise<string>
}

/** Binary resources stay on disk/in transport, not in the model-facing text map. */
export type KitResourceContent =
  | { readonly kind: 'text'; readonly content: string }
  | { readonly kind: 'opaque'; readonly byteLength: number }

/** Resolved content paths for a package-backed Design Kit. */
export interface DesignKitLocation {
  /** Package or source directory retained as the kit's resource root. */
  rootDir: string
  /** Absolute path to the Mindset Markdown file. */
  mindsetPath: string
  /** Absolute path to the directory containing skill bundle directories. */
  skillsDir: string
  /** Optional Kit-level KAG relation extension declaration. */
  relationsPath?: string
  /** Structured membership declaration for independently stored Bundles. */
  manifestPath?: string
  /** Independent Bundle content root, outside the Kit-owned root. */
  bundlesDir?: string
}

/** Trusted loader inputs that are not authored by Kit content. */
export interface DesignKitLoadOptions {
  /** Current authoring/project sources resolve identity, not an old release version. */
  readonly current?: boolean
  /** Stable package- or absolute-directory identity supplied by host composition. */
  readonly sourceId: string
  readonly resolveBundle?: (pin: DesignBundlePin) => Promise<DesignBundleContent | undefined>
}

export interface DesignBundlePin { readonly name: string; readonly version: string }
export interface DesignBundleMount extends DesignBundlePin { readonly bindingKey: string }
export interface DesignBundleContent {
  /** Trusted installation provenance, not supplied by the Bundle manifest. */
  readonly sourceId?: string
  readonly skill: DesignSkill
  readonly resources: Readonly<Record<string, string>>
  readonly resourceRoot: string
}

/** Resolve the existing package entry without treating engineering files as content. */
export async function resolveDesignKitPackage(fs: KitFsLike, packageRoot: string): Promise<DesignKitLocation | undefined> {
  const text = await fs.readText(resolve(packageRoot, 'package.json'))
  if (text === undefined) return undefined
  const kit = JSON.parse(text)?.designSystem?.kit
  if (!kit || typeof kit.mindset !== 'string') return undefined
  const path = (value: unknown, field: string): string => {
    if (typeof value !== 'string' || isAbsolute(value)) throw new Error(`design kit: invalid package ${field}`)
    const result = resolve(packageRoot, value), rel = relative(packageRoot, result)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('design kit: package content path escapes package')
    return result
  }
  if (kit.manifest !== undefined || kit.bundles !== undefined || kit.root !== undefined) {
    return { rootDir: path(kit.root, 'root'), mindsetPath: path(kit.mindset, 'mindset'),
      manifestPath: path(kit.manifest, 'manifest'), bundlesDir: path(kit.bundles, 'bundles'),
      skillsDir: path(kit.bundles, 'bundles') }
  }
  return { rootDir: packageRoot, mindsetPath: path(kit.mindset, 'mindset'), skillsDir: path(kit.skills, 'skills') }
}

/** Exact resolution from trusted source roots, without latest fallback or copying. */
export function createDirectoryBundleResolver(fs: KitFsLike, roots: readonly { rootDir: string; sourceId: string }[]) {
  return async (pin: DesignBundlePin): Promise<DesignBundleContent | undefined> => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(pin.name)) throw new Error('design bundle: unsafe pin')
    DesignBundleVersion(pin.version)
    let found: DesignBundleContent | undefined
    for (const root of roots) {
      const base = resolve(root.rootDir, pin.name)
      const realRoot = fs.realPath === undefined ? undefined : await fs.realPath(root.rootDir)
      try { await assertRealPathInside(fs, realRoot, base) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      await assertRealPathInside(fs, realRoot, resolve(base, 'skill.yaml'))
      if (await fs.readText(resolve(base, 'skill.yaml')) === undefined) continue
      const bundle = await loadDesignBundle(fs, {rootDir: base, sourceId: root.sourceId})
      if ((bundle.skill.catalogName ?? bundle.skill.name) !== pin.name) throw new Error('design bundle: source directory identity mismatch')
      if (String(bundle.skill.version) !== pin.version) continue
      if (found) throw new Error(`design bundle: ambiguous exact source ${pin.name}@${pin.version}`)
      found = bundle
    }
    return found
  }
}

/** Parse the sole ordered membership authority, never version ranges or paths. */
export function parseKitMounts(text: string): readonly DesignBundleMount[] {
  const document = plainRecord(parse(text), 'kit.yaml')
  exactKeys(document, ['version', 'mounts'], 'kit.yaml')
  if (document.version !== 1 || !Array.isArray(document.mounts) || document.mounts.length === 0) {
    throw new Error('design kit: kit.yaml requires version 1 and nonempty mounts')
  }
  const keys = new Set<string>(), names = new Set<string>()
  return Object.freeze(document.mounts.map(value => {
    const mount = plainRecord(value, 'kit.yaml mount')
    exactKeys(mount, ['bindingKey', 'name', 'version'], 'kit.yaml mount')
    for (const field of ['bindingKey', 'name'] as const) {
      if (typeof mount[field] !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(mount[field] as string)) {
        throw new Error(`design kit: unsafe mount ${field}`)
      }
    }
    if (typeof mount.version !== 'string') throw new Error('design kit: mount needs an exact Bundle version')
    const version = DesignBundleVersion(mount.version)
    const name = mount.name as string, bindingKey = mount.bindingKey as string
    if (keys.has(bindingKey) || names.has(name)) throw new Error('design kit: duplicate mount identity or bindingKey')
    keys.add(bindingKey); names.add(name)
    return Object.freeze({ bindingKey, name, version: String(version) })
  }))
}

/**
 * Parse a `---`-delimited YAML frontmatter block.
 * @param text - complete source text that may begin with a frontmatter block.
 * @param path - source location used only in diagnostic messages.
 * @returns the parsed frontmatter object and the body following it.
 */
export function parseFrontmatter(text: string, path: string): { meta: Record<string, unknown>; body: string } {
  if (!text.startsWith('---')) return { meta: {}, body: text }
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (match === null) throw new Error(`design kit: ${path} has unterminated YAML frontmatter`)
  const raw = match[1] as string
  const body = text.slice(match[0].length)
  const value = parse(raw)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`design kit: ${path} frontmatter must contain a YAML object`)
  }
  return { meta: value as Record<string, unknown>, body }
}

const MINDSET_SKILL_CATALOG = /<design_skills>\s*([\s\S]*?)\s*<\/design_skills>/g
const MINDSET_SKILL_HEADING = /^##\s+(.+?)\s*$/gm

/**
 * Read the authoritative Bundle allowlist from a Mindset body.
 * @param body - Mindset Markdown without frontmatter.
 * @param mindsetName - Mindset id used in diagnostics.
 * @returns skill ids in authored catalog order.
 */
export function parseMindsetSkillNames(body: string, mindsetName: string): string[] {
  const catalogs = [...body.matchAll(MINDSET_SKILL_CATALOG)]
  if (catalogs.length !== 1) {
    if (catalogs.length > 1) {
      throw new Error(`design kit: Mindset ${JSON.stringify(mindsetName)} must contain exactly one <design_skills> catalog`)
    }
    throw new Error(`design kit: Mindset ${JSON.stringify(mindsetName)} must contain one <design_skills> catalog`)
  }
  const catalog = catalogs[0]?.[1] as string
  const headings = [...catalog.matchAll(MINDSET_SKILL_HEADING)].map((match) => match[1] as string)
  const malformed = headings.filter((heading) => !/^[a-z][a-z0-9_]*$/.test(heading))
  if (malformed.length > 0) {
    throw new Error(`design kit: Mindset ${JSON.stringify(mindsetName)} has malformed skill headings: ${malformed.join(', ')}`)
  }
  const names = headings
  if (names.length === 0) {
    throw new Error(`design kit: Mindset ${JSON.stringify(mindsetName)} has an empty <design_skills> catalog`)
  }
  const duplicates = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))].sort()
  if (duplicates.length > 0) {
    throw new Error(`design kit: Mindset ${JSON.stringify(mindsetName)} repeats skill names: ${duplicates.join(', ')}`)
  }
  return names
}

/** Parse one required skill.yaml manifest. */
function parseSkillManifest(text: string, path: string): Record<string, unknown> {
  const value = parse(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`design kit: ${path} must contain a YAML object`)
  }
  return value as Record<string, unknown>
}

/** Parse one present bilingual skill.yaml field into validated zh/en text. */
function parseBilingualManifestField(manifest: Record<string, unknown>, field: 'title' | 'label' | 'description', path: string): DesignBilingualText {
  const value = manifest[field]
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`design kit: ${path} ${field} must be a bilingual object`)
  }
  const record = value as Record<string, unknown>
  for (const language of ['zh', 'en'] as const) {
    const text = record[language]
    if (typeof text !== 'string' || text.trim() === '') {
      throw new Error(`design kit: ${path} ${field}.${language} must be a non-empty string`)
    }
  }
  return Object.freeze({ zh: record.zh as string, en: record.en as string })
}

function assertSkillRuntime(manifest: Record<string, unknown>, path: string): void {
  const presentation = manifest.presentation
  if (presentation !== undefined && (typeof presentation !== 'object' || presentation === null || Array.isArray(presentation))) {
    throw new Error(`design kit: ${path} presentation must be an object`)
  }
  let config = presentation as Record<string, unknown> | undefined
  if (config === undefined) {
    config = { mode: 'none' }
    manifest.presentation = config
  }
  if (config.mode !== 'native' && config.mode !== 'declarative' && config.mode !== 'auto' && config.mode !== 'none') {
    throw new Error(`design kit: ${path} presentation.mode must be "native", "declarative", "auto", or "none"`)
  }
  if (config?.renderer !== undefined && (typeof config.renderer !== 'string' || config.renderer.trim() === '')) {
    throw new Error(`design kit: ${path} presentation.renderer must be a non-empty string`)
  }
  if (config?.mode === 'native' && config.renderer === undefined) {
    throw new Error(`design kit: ${path} native presentation requires renderer`)
  }
  if (config?.mode === 'native' && typeof config.renderer === 'string') {
    config.renderer = DesignDriverId(config.renderer, `design kit: ${path} presentation.renderer`)
  }
  if (config?.mode === 'declarative') {
    if (config.renderer !== undefined && config.renderer !== 'pilot-design/v2') {
      throw new Error(`design kit: ${path} declarative presentation only supports renderer "pilot-design/v2"`)
    }
    // One shared interpreter, not an author-facing renderer/version choice.
    config.renderer = 'pilot-design/v2'
  }
  if ((config.mode === 'none' || config.mode === 'auto') && config.renderer !== undefined) {
    throw new Error(`design kit: ${path} presentation.mode ${JSON.stringify(config.mode)} cannot declare renderer`)
  }

  const runtime = manifest.runtime
  if (runtime !== undefined && (typeof runtime !== 'object' || runtime === null || Array.isArray(runtime))) {
    throw new Error(`design kit: ${path} runtime must be an object`)
  }
  const runtimeConfig = runtime as Record<string, unknown> | undefined
  if (runtimeConfig !== undefined) {
    const unsupported = Object.keys(runtimeConfig).filter((key) => key !== 'driver')
    if (unsupported.length > 0) throw new Error(`design kit: ${path} runtime contains unsupported key ${JSON.stringify(unsupported[0])}`)
    if (typeof runtimeConfig.driver !== 'string') throw new Error(`design kit: ${path} runtime.driver must be a string`)
    runtimeConfig.driver = DesignDriverId(runtimeConfig.driver, `design kit: ${path} runtime.driver`)
  }
  const capabilities = manifest.capabilities
  if (capabilities !== undefined) {
    if (!Array.isArray(capabilities) || capabilities.length === 0 || capabilities.some((value) => typeof value !== 'string')) {
      throw new Error(`design kit: ${path} capabilities must be a non-empty string list`)
    }
    const parsed = capabilities.map((value) => DesignDriverId(value as string, `design kit: ${path} capability`))
    if (new Set(parsed).size !== parsed.length) throw new Error(`design kit: ${path} capabilities must be unique`)
    manifest.capabilities = parsed
  }

  const semanticCapabilities = manifest.semantic_capabilities
  if (semanticCapabilities !== undefined) {
    if (!Array.isArray(semanticCapabilities) || semanticCapabilities.length === 0 || semanticCapabilities.some((value) => typeof value !== 'string')) {
      throw new Error(`design kit: ${path} semantic_capabilities must be a non-empty string list`)
    }
    const parsedSemantic = semanticCapabilities.map((value) => DesignSemanticCapabilityId(value as string, `design kit: ${path} semantic capability`))
    if (new Set(parsedSemantic).size !== parsedSemantic.length) throw new Error(`design kit: ${path} semantic_capabilities must be unique`)
    manifest.semantic_capabilities = parsedSemantic
  }

  if (manifest.review_support !== undefined) {
    manifest.review_support = parseReviewSupport(manifest.review_support, path)
  }

  // Compile once: the same frozen object is embedded in the manifest and
  // returned on DesignSkill.execution.
  manifest.execution = parseDesignExecutionPolicy(manifest.execution, path)
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry)
  return Object.freeze(value)
}

function plainRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`design kit: ${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(record: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new Error(`design kit: ${path} contains unsupported key ${JSON.stringify(key)}`)
  }
}

function bilingualText(value: unknown, path: string): { readonly zh: string; readonly en: string } {
  const record = plainRecord(value, path)
  exactKeys(record, ['zh', 'en'], path)
  const zh = record.zh
  const en = record.en
  if (typeof zh !== 'string' || zh.trim() === '') throw new Error(`design kit: ${path}.zh must be a non-empty string`)
  if (typeof en !== 'string' || en.trim() === '') throw new Error(`design kit: ${path}.en must be a non-empty string`)
  return Object.freeze({ zh: zh.trim(), en: en.trim() })
}

function bilingualAliases(value: unknown, path: string): { readonly zh: readonly string[]; readonly en: readonly string[] } {
  const record = plainRecord(value, path)
  exactKeys(record, ['zh', 'en'], path)
  const seen = new Set<string>()
  const parseList = (lang: 'zh' | 'en'): readonly string[] => {
    const list = record[lang]
    if (!Array.isArray(list)) throw new Error(`design kit: ${path}.${lang} must be a string list`)
    const trimmed = list.map((entry, index) => {
      if (typeof entry !== 'string' || entry.trim() === '') {
        throw new Error(`design kit: ${path}.${lang}[${index}] must be a non-empty string`)
      }
      return entry.trim()
    })
    for (const alias of trimmed) {
      if (seen.has(alias)) throw new Error(`design kit: ${path} alias ${JSON.stringify(alias)} is duplicated within or across languages`)
      seen.add(alias)
    }
    return Object.freeze(trimmed)
  }
  return Object.freeze({ zh: parseList('zh'), en: parseList('en') })
}

function parseResumeAction(value: unknown, path: string): DesignResumeAction {
  const record = plainRecord(value, `${path} resume_action`)
  exactKeys(record, ['route_id', 'label', 'aliases'], `${path} resume_action`)
  const routeId = record.route_id
  if (typeof routeId !== 'string') throw new Error(`design kit: ${path} resume_action.route_id must be a string`)
  const label = bilingualText(record.label, `${path} resume_action.label`)
  const aliases = record.aliases === undefined ? undefined : bilingualAliases(record.aliases, `${path} resume_action.aliases`)
  return Object.freeze({
    routeId: DesignResumeActionId(routeId),
    label,
    ...(aliases === undefined ? {} : { aliases }),
  })
}

/**
 * Compile placement and handoff independently. On-disk snake_case stays at
 * the YAML boundary; absence of placement retains independent Producer execution.
 * @param execution - raw `execution` manifest value.
 * @param path - manifest path for diagnostics.
 * @returns the compiled frozen policy.
 */
export function parseDesignExecutionPolicy(execution: unknown, path: string): DesignExecutionPolicy {
  const record = plainRecord(execution, `${path} execution`)
  exactKeys(record, ['handoff', 'resume_action', 'mode'], `${path} execution`)
  if (record.mode !== undefined && record.mode !== 'main' && record.mode !== 'subagent') {
    throw new Error(`design kit: ${path} execution.mode must be "main" or "subagent"`)
  }
  const mode = record.mode === undefined ? {} : { mode: record.mode as 'main' | 'subagent' }
  const handoff = record.handoff
  if (handoff !== 'none' && handoff !== 'must_edit' && handoff !== 'user_continue') {
    throw new Error(`design kit: ${path} execution.handoff must be "none", "must_edit", or "user_continue"`)
  }
  if (handoff !== 'user_continue') {
    if (record.resume_action !== undefined) throw new Error(`design kit: ${path} resume_action requires handoff "user_continue"`)
    return deepFreeze({ ...mode, handoff })
  }
  return deepFreeze({ ...mode, handoff, resumeAction: parseResumeAction(record.resume_action, path) })
}

function schemaAt(root: SchemaSpec, dottedPath: string): SchemaSpec | undefined {
  let current: SchemaSpec | undefined = root
  for (const segment of dottedPath.split('.')) {
    if (current?.type === 'object') current = current.properties?.[segment]
    else if (current?.type === 'map') current = current.value
    else return undefined
  }
  return current
}

function collectionRecordSpec(spec: SchemaSpec): SchemaSpec | undefined {
  if (spec.type === 'map') return spec.value
  if (spec.type === 'array') return spec.items
  if (spec.type === 'object') return spec
  return undefined
}

function controlAcceptsSchema(control: string, spec: SchemaSpec): boolean {
  if (control === 'record_map' || control === 'source_reference_map') return spec.type === 'map' && spec.value?.type === 'object'
  if (control === 'radio_custom') return spec.type === 'string'
  if (control === 'data_table') return dataTableSchemaMatches(spec)
  if (control === 'rows') return spec.type === 'array'
  if (control === 'list' || control === 'multi_select' || control === 'record_multi_select' || control === 'source_list' || control === 'token_list') {
    return spec.type === 'array' && (spec.items?.type === 'string'
      || (spec.items?.type === 'enum' && spec.items.values?.every((value) => typeof value === 'string') === true))
  }
  if (control === 'number') return spec.type === 'number'
  if (control === 'toggle') return spec.type === 'boolean'
  if (control === 'key_value') return spec.type === 'map' && spec.value?.type === 'string'
  return spec.type === 'string' || (spec.type === 'enum' && spec.values?.every((value) => typeof value === 'string') === true)
}

function assertOptionsMatchEnum(options: readonly { value: string }[] | undefined, spec: SchemaSpec, message: string): void {
  if (options === undefined || spec.type !== 'enum') return
  const allowed = new Set(spec.values as readonly string[])
  for (const option of options) {
    if (!allowed.has(option.value)) throw new Error(`${message} option ${JSON.stringify(option.value)} is absent from schema enum values`)
  }
}

function assertDeclarativeConsistency(
  schema: SchemaSpec,
  panel: PanelManifest,
  renderer: DeclarativeRendererManifest,
  path: string,
  summaryPath = `${path}/renderer.md`,
): void {
  if (schema.type !== 'object') throw new Error(`design kit: ${path}/schema.yaml declarative root must have type object`)
  const checkDefaults = (values: Record<string, unknown> | undefined, spec: SchemaSpec | undefined, context: string): void => {
    for (const [key, value] of Object.entries(values ?? {})) {
      const field = spec?.properties?.[key]
      if (!field || compileSchema(field)(value).length) throw new Error(`design kit: ${path}/panel.yaml invalid ${context} default ${key}`)
    }
  }
  checkDefaults(panel.initial_values, schema, 'initial_values')
  const checkDocument = (node: PanelManifest['ui'], nodePath: string): void => {
    if (node.component === 'record_workspace' && node.navigation_group_by !== undefined) {
      const graph = node.children?.find(child => child.component === 'relation_graph')?.graph
      for (const source of node.sources ?? []) {
        const section = panel.sections.find(section => section.id === source)
        if (!section || section.navigation === 'contextual' || graph?.edges === source) continue
        const collection = schemaAt(schema, section.records_path ?? section.id)
        const record = collection?.type === 'map' ? collectionRecordSpec(collection) : undefined
        const boundRecord = record && (section.fields_path ? schemaAt(record, section.fields_path) : record)
        const grouping = boundRecord?.properties?.[node.navigation_group_by]
        if (!grouping || !(grouping.type === 'string' || (grouping.type === 'enum'
          && grouping.values?.every(value => typeof value === 'string')))
          || ['metadata', 'reference'].includes(String(grouping.knowledge?.role))) {
          throw new Error(`design kit: ${path}/panel.yaml ${nodePath}.navigation_group_by: section ${source} needs a declared string or string-enum classification field in its bound record schema`)
        }
      }
    }
    if (node.rounds_source !== undefined) {
      const section = panel.sections.find(section => section.id === node.rounds_source)
      const collection = section && schemaAt(schema, section.records_path ?? section.id)
      const record = collection?.type === 'map' ? collectionRecordSpec(collection) : undefined
      if (!record || record.properties?.title?.type !== 'string' || record.properties?.description?.type !== 'string'
        || section?.fields_path !== undefined) {
        throw new Error(`design kit: ${path}/panel.yaml ${nodePath}.rounds_source must resolve to a map of title/description text records`)
      }
    }
    if (node.component === 'grouped_records') {
      const section = panel.sections.find(section => section.id === node.source)
      const collection = section && schemaAt(schema, section.records_path ?? section.id)
      // The renderer groups raw records, not their optional fields_path object.
      const record = collection?.type === 'map' ? collectionRecordSpec(collection) : undefined
      const grouping = record?.properties?.[node.group_by ?? '']
      if (!grouping || !['string', 'enum'].includes(String(grouping.type))
        || ['metadata', 'reference'].includes(String(grouping.knowledge?.role))) {
        throw new Error(`design kit: ${path}/panel.yaml ${nodePath}.group_by: grouped records need a declared scalar grouping field in the source record schema`)
      }
    }
    if (node.component === 'schema_field') {
      const field = node.path && schemaAt(schema, node.path)
      if (!field || !controlAcceptsSchema(node.control ?? '', field)) throw new Error(`design kit: ${path}/panel.yaml scalar binding ${node.path} is incompatible with schema.yaml`)
      assertOptionsMatchEnum(node.options, field, `design kit: ${path}/panel.yaml ${node.path}`)
    }
    if (node.component === 'preview_workspace' && node.live_preview) {
      const config = node.live_preview
      for (const binding of [config.file_path, config.title_path, config.description_path,
        ...(config.swatch_paths ?? []), ...config.tokens.flatMap(token => [token.path, token.fallback_path])]) {
        if (binding && !['string', 'enum'].includes(schemaAt(schema, binding)?.type ?? '')) throw new Error(`design kit: ${path}/panel.yaml preview binding ${binding} must be text`)
      }
      for (const binding of config.restore_paths ?? []) if (!schemaAt(schema, binding)) throw new Error(`design kit: ${path}/panel.yaml unknown restore binding ${binding}`)
      for (const preset of config.presets ?? []) for (const [binding, value] of Object.entries(preset.values)) {
        const spec = schemaAt(schema, binding)
        if (!spec || compileSchema(spec)(value).length) throw new Error(`design kit: ${path}/panel.yaml invalid preset binding ${binding}`)
      }
    }
    if (node.component === 'artifact_workspace' && node.artifacts) {
      const config = node.artifacts, collection = schemaAt(schema, config.records_path)
      const parent = collection?.type === 'map' ? collectionRecordSpec(collection) : undefined
      const children = parent && schemaAt(parent, config.children.records_field)
      const child = children?.type === 'map' ? collectionRecordSpec(children) : undefined
      if (!parent || !child) throw new Error(`design kit: ${path}/panel.yaml artifact workspace requires object collections`)
      for (const [record, keys] of [[parent, [config.title_field, config.file_field]], [child, [config.children.title_field, config.children.file_field]]] as const) {
        for (const key of keys) if (!['string', 'enum'].includes(schemaAt(record, key)?.type ?? '')) throw new Error(`design kit: ${path}/panel.yaml artifact text binding ${key} is not scalar text`)
      }
      for (const [record, key] of [[schema, config.order_path], [parent, config.children.order_field], [child, config.children.points_field], [child, config.children.links_field]] as const) {
        if (key && (schemaAt(record, key)?.type !== 'array' || schemaAt(record, key)?.items?.type !== 'string')) throw new Error(`design kit: ${path}/panel.yaml artifact list binding ${key} must be a string list`)
      }
      if (config.current_path && schemaAt(schema, config.current_path)?.type !== 'string') throw new Error(`design kit: ${path}/panel.yaml artifact current binding must be a string`)
    }
    if (node.component === 'document_workspace' && node.document) {
      const doc = node.document
      for (const key of [doc.path, doc.title_path].filter((value): value is string => value !== undefined)) {
        if (!['string', 'enum'].includes(schemaAt(schema, key)?.type ?? '')) throw new Error(`design kit: ${path}/panel.yaml document binding ${key} must be a string`)
      }
      if (doc.references_path) {
        const collection = schemaAt(schema, doc.references_path)
        if (!collection || !['map', 'array'].includes(collection.type ?? '') || collectionRecordSpec(collection)?.properties?.[doc.references_id_field!]?.type !== 'string') throw new Error(`design kit: ${path}/panel.yaml document references require records with a string id`)
      }
    }
    for (const [index, child] of (node.children ?? []).entries()) if (child) checkDocument(child, `${nodePath}.children[${index}]`)
    for (const [slot, child] of Object.entries(node.slots ?? {})) if (child) checkDocument(child, `${nodePath}.slots.${slot}`)
  }
  checkDocument(panel.ui, 'ui')
  const sections = new Map<string, { collection: SchemaSpec; fields: SchemaSpec | undefined }>()
  for (const section of panel.sections) {
    const recordsPath = section.records_path ?? section.id
    const collection = schemaAt(schema, recordsPath)
    if (collection === undefined) {
      throw new Error(`design kit: ${path}/panel.yaml section ${JSON.stringify(section.id)} records_path ${JSON.stringify(recordsPath)} is absent from schema.yaml`)
    }
    if (collection.type !== 'map' || collection.value?.type !== 'object') {
      throw new Error(`design kit: ${path}/panel.yaml section ${JSON.stringify(section.id)} records_path ${JSON.stringify(recordsPath)} must resolve to a map of objects`)
    }
    const record = collection.value
    const fields = section.fields_path === undefined || record === undefined
      ? record
      : schemaAt(record, section.fields_path)
    if (section.fields_path !== undefined && fields?.type !== 'object') {
      throw new Error(`design kit: ${path}/panel.yaml section ${JSON.stringify(section.id)} fields_path ${JSON.stringify(section.fields_path)} must resolve to an object inside each record`)
    }
    const orderSpec = section.order === undefined ? undefined : schemaAt(schema, section.order)
    if (section.order !== undefined && (orderSpec?.type !== 'array' || orderSpec.items?.type !== 'string')) {
      throw new Error(`design kit: ${path}/panel.yaml section ${JSON.stringify(section.id)} order ${JSON.stringify(section.order)} must resolve to a schema array of strings`)
    }
    sections.set(section.id, { collection, fields })
    const headerTitle = section.form?.header?.title
    if (headerTitle && 'field' in headerTitle && headerTitle.editable) {
      const titleSpec = fields?.properties?.[headerTitle.field]
      if (titleSpec?.type !== 'string' || ['metadata', 'reference'].includes(titleSpec.knowledge?.role ?? '')) {
        throw new Error(`design kit: ${path}/panel.yaml ${section.id} editable header title must bind an ordinary string fact`)
      }
    }
    checkDefaults(section.create?.defaults, fields, section.id)
    const initialLabel = section.create?.initial_label
    if (initialLabel && (initialLabel.field === (section.create?.id_field ?? 'id')
      || fields?.properties?.[initialLabel.field]?.type !== 'string')) {
      throw new Error(`design kit: ${path}/panel.yaml ${section.id} initial_label field must reference a non-id string schema field`)
    }
    for (const target of Object.keys(section.derived_fields ?? {})) {
      if (fields?.properties?.[target]?.type !== 'string') throw new Error(`design kit: ${path}/panel.yaml derived field ${target} must resolve to a string`)
    }
    if (section.create?.id_field !== undefined && fields?.properties?.[section.create.id_field]?.type !== 'string') {
      throw new Error(`design kit: ${path}/panel.yaml ${section.id} id_field must reference a string schema field`)
    }
  }
  for (const field of panel.fields) {
    for (const sectionId of field.applies_to ?? []) {
      const storage = sections.get(sectionId)?.fields
      const fieldSpec = storage?.type === 'object' ? storage.properties?.[field.key] : undefined
      if (fieldSpec === undefined) {
        throw new Error(`design kit: ${path}/panel.yaml field ${JSON.stringify(field.key)} is absent from schema for section ${JSON.stringify(sectionId)}`)
      }
      if (!controlAcceptsSchema(field.control, fieldSpec)) {
        throw new Error(`design kit: ${path}/panel.yaml control ${JSON.stringify(field.control)} is incompatible with schema type ${JSON.stringify(fieldSpec.type)} for field ${JSON.stringify(field.key)}`)
      }
      const optionSpec = fieldSpec.type === 'array' ? fieldSpec.items : fieldSpec
      if (field.clear_when_hidden === 'omit' && storage?.required?.includes(field.key)) throw new Error(`design kit: ${path}/panel.yaml cannot omit required field ${field.key}`)
      if (optionSpec !== undefined) {
        assertOptionsMatchEnum(field.options, optionSpec, `design kit: ${path}/panel.yaml field ${JSON.stringify(field.key)}`)
      }
      if (field.control === 'rows') {
        if (fieldSpec.type !== 'array' || fieldSpec.items?.type !== 'object') {
          throw new Error(`design kit: ${path}/panel.yaml rows field ${JSON.stringify(field.key)} must resolve to an array of schema objects`)
        }
        for (const column of field.columns ?? []) {
          const columnSpec = fieldSpec.items.properties?.[column.key]
          if (columnSpec === undefined) {
            throw new Error(`design kit: ${path}/panel.yaml rows column ${JSON.stringify(column.key)} is absent from schema for field ${JSON.stringify(field.key)}`)
          }
          if (!controlAcceptsSchema(column.control, columnSpec)) {
            throw new Error(`design kit: ${path}/panel.yaml rows control ${JSON.stringify(column.control)} is incompatible with schema type ${JSON.stringify(columnSpec.type)} for column ${JSON.stringify(column.key)}`)
          }
          assertOptionsMatchEnum(column.options, columnSpec, `design kit: ${path}/panel.yaml rows column ${JSON.stringify(column.key)}`)
        }
      }
      if (field.control === 'source_reference_map') {
        for (const key of ['file', 'revision']) {
          if (fieldSpec.value?.properties?.[key]?.type !== 'string') throw new Error(`design kit: ${path}/panel.yaml source reference ${field.key} requires ${key}`)
        }
        for (const key of ['pointer', 'note', 'subject_pointer']) {
          const spec = fieldSpec.value?.properties?.[key]
          if (spec && spec.type !== 'string') throw new Error(`design kit: ${path}/panel.yaml source reference ${field.key} invalid ${key}`)
        }
      }
      if (field.control === 'record_map') {
        const item = fieldSpec.value
        checkDefaults(field.item_defaults, item, `record_map ${field.key}`)
        const order = storage?.properties?.[field.order_field!]
        if ((field.id_field !== undefined && item?.properties?.[field.id_field]?.type !== 'string')
          || (field.order_field !== undefined && (order?.type !== 'array' || order.items?.type !== 'string'))) {
          throw new Error(`design kit: ${path}/panel.yaml record_map ${field.key} declared identity/order must be a string identity and sibling string order array`)
        }
        for (const column of field.columns ?? []) {
          const spec = item?.properties?.[column.key]
          if (!spec || !controlAcceptsSchema(column.control, spec)) throw new Error(`design kit: ${path}/panel.yaml record_map ${field.key} incompatible column ${column.key}`)
          assertOptionsMatchEnum(column.options, spec, `design kit: ${path}/panel.yaml record_map ${field.key}.${column.key}`)
        }
        for (const child of field.item_fields ?? []) {
          const spec = item?.properties?.[child.key]
          if (!spec || !controlAcceptsSchema(child.control, spec)) throw new Error(`design kit: ${path}/panel.yaml record_map ${field.key} incompatible child ${child.key}`)
          if (child.clear_when_hidden === 'omit' && item?.required?.includes(child.key)) throw new Error(`design kit: ${path}/panel.yaml cannot omit required child ${field.key}.${child.key}`)
          assertOptionsMatchEnum(child.options, spec.type === 'array' ? spec.items! : spec, `design kit: ${path}/panel.yaml record_map ${field.key}.${child.key}`)
        }
      }
    }
  }
  for (const field of renderer.fields ?? []) {
    const fieldSpec = schemaAt(schema, field.source)
    if (fieldSpec === undefined) {
      throw new Error(`design kit: ${summaryPath} field source ${JSON.stringify(field.source)} is absent from schema.yaml`)
    }
    if (!['string', 'number', 'boolean', 'enum'].includes(fieldSpec.type as string)) {
      throw new Error(`design kit: ${summaryPath} field source ${JSON.stringify(field.source)} must resolve to a scalar schema type`)
    }
  }
  for (const collection of renderer.collections ?? []) {
    const collectionSpec = schemaAt(schema, collection.source)
    if (collectionSpec?.type !== 'map' && collectionSpec?.type !== 'array') {
      throw new Error(`design kit: ${summaryPath} collection source ${JSON.stringify(collection.source)} must resolve to a schema map or array`)
    }
    if (collection.title_fields !== undefined || collection.fields !== undefined) {
      const record = collectionRecordSpec(collectionSpec)
      if (record?.type !== 'object') {
        throw new Error(`design kit: ${summaryPath} record fields require object records at ${JSON.stringify(collection.source)}`)
      }
      for (const titleField of collection.title_fields ?? []) {
        const titleSpec = schemaAt(record, titleField)
        if (titleSpec === undefined) {
          throw new Error(`design kit: ${summaryPath} title field ${JSON.stringify(titleField)} is absent from schema records at ${JSON.stringify(collection.source)}`)
        }
        if (!['string', 'number', 'boolean', 'enum'].includes(titleSpec.type as string)) {
          throw new Error(`design kit: ${summaryPath} title field ${JSON.stringify(titleField)} must resolve to a scalar schema type`)
        }
      }
      for (const field of collection.fields ?? []) {
        const fieldSpec = schemaAt(record, field)
        if (fieldSpec === undefined) {
          throw new Error(`design kit: ${summaryPath} record field ${JSON.stringify(field)} is absent from schema records at ${JSON.stringify(collection.source)}`)
        }
        if (!['string', 'number', 'boolean', 'enum'].includes(fieldSpec.type as string)) {
          throw new Error(`design kit: ${summaryPath} record field ${JSON.stringify(field)} must resolve to a scalar schema type`)
        }
      }
    }
    const orderSpec = collection.order === undefined ? undefined : schemaAt(schema, collection.order)
    if (collection.order !== undefined && (orderSpec?.type !== 'array' || orderSpec.items?.type !== 'string')) {
      throw new Error(`design kit: ${summaryPath} order source ${JSON.stringify(collection.order)} must resolve to a schema array of strings`)
    }
  }
}

function assertCrossPanelReferences(skills: readonly DesignSkill[]): void {
  const panels = new Map(skills.flatMap((skill) => {
    const panel = skill.metadata?.panelManifest
    return panel === undefined ? [] : [[skill.name, panel as PanelManifest] as const]
  }))
  for (const [skillName, panel] of panels) {
    const references = [
      ...panel.fields.flatMap((field) => field.options_from_panel === undefined ? [] : [field.options_from_panel]),
      ...panel.fields.flatMap((field) => (field.columns ?? []).flatMap((column) => column.options_from_panel === undefined ? [] : [column.options_from_panel])),
    ]
    for (const reference of references) {
      const target = panels.get(reference.panel_type)
      if (target === undefined) {
        throw new Error(`design kit: skill ${JSON.stringify(skillName)} references unknown panel ${JSON.stringify(reference.panel_type)}`)
      }
      if (!target.sections.some((section) => section.id === reference.section_id)) {
        throw new Error(`design kit: skill ${JSON.stringify(skillName)} references unknown section ${JSON.stringify(reference.section_id)} in panel ${JSON.stringify(reference.panel_type)}`)
      }
    }
  }
}

/** One semantic capability id binds at most one Bundle per Kit. */
function assertUniqueSemanticCapabilities(skills: readonly DesignSkill[]): void {
  const providers = new Map<string, string>()
  for (const skill of skills) {
    for (const capability of semanticCapabilitiesOf(skill)) {
      const existing = providers.get(capability)
      if (existing !== undefined) {
        throw new Error(`design kit: semantic capability ${JSON.stringify(capability)} is declared by both ${JSON.stringify(existing)} and ${JSON.stringify(skill.name)}`)
      }
      providers.set(capability, skill.name)
    }
  }
}

/**
 * Titles are the user-facing Ask option labels; the main Agent maps a chosen
 * title back to exactly one skill id, so each locale's titles must be unique.
 */
function assertUniqueSkillTitles(skills: readonly DesignSkill[]): void {
  for (const language of ['zh', 'en'] as const) {
    const owners = new Map<string, string>()
    for (const skill of skills) {
      const title = skill.title[language]
      const existing = owners.get(title)
      if (existing !== undefined) {
        throw new Error(`design kit: ${language} title ${JSON.stringify(title)} is declared by both ${JSON.stringify(existing)} and ${JSON.stringify(skill.name)}`)
      }
      owners.set(title, skill.name)
    }
  }
}

const COMMON_SKILL_SLOTS = [
  'SKILL.md', 'skill.yaml', 'schema.yaml', 'validation.yaml',
] as const

const DECLARATIVE_SKILL_SLOTS = [
  'panel.yaml', 'renderer.md',
] as const

const KNOWN_SKILL_SLOTS = [
  ...COMMON_SKILL_SLOTS, ...DECLARATIVE_SKILL_SLOTS,
] as const

/** Recompose an exact project closure using the same whole-Kit checks as installation. */
export function composeDesignKitBundles(kit: DesignKit, replacements: readonly DesignBundleContent[]): DesignKit {
  const byIdentity = new Map(replacements.map(bundle => [bundle.skill.catalogName ?? bundle.skill.name, bundle]))
  if (byIdentity.size !== replacements.length) throw new Error('design kit: duplicate replacement identity')
  const skills = kit.skills.map(previous => {
    const identity = previous.catalogName ?? previous.name
    const bundle = byIdentity.get(identity)
    if (!bundle) return previous
    byIdentity.delete(identity)
    if (bundle.skill.name !== previous.name) throw new Error('design kit: replacement changes runtime binding or data paths')
    if (bundle.skill.authority !== previous.authority) throw new Error('design kit: replacement changes trusted Bundle provenance')
    return bundle.skill
  })
  if (byIdentity.size) throw new Error('design kit: replacement identity is not mounted by this Kit')
  assertCrossPanelReferences(skills)
  assertUniqueSemanticCapabilities(skills)
  assertUniqueSkillTitles(skills)
  const resources = { ...kit.resources }
  for (const bundle of replacements) {
    const prefix = `${bundle.skill.name}/`
    for (const path of Object.keys(resources)) if (path.startsWith(prefix)) delete resources[path]
    for (const [path, content] of Object.entries(bundle.resources)) {
      if (!KNOWN_SKILL_SLOTS.includes(path as (typeof KNOWN_SKILL_SLOTS)[number])) resources[`${prefix}${path}`] = content
    }
  }
  return { ...kit, skills, resources: Object.freeze(resources),
    ontologyContract: compileDesignOntologyContract({ kit: kit.name, kitVersion: kit.version,
      relationVocabulary: kit.relationVocabulary ?? compileDesignRelationVocabulary(undefined, kit.name, kit.version),
      schemas: Object.fromEntries(skills.map(skill => [`${skill.name}/${skill.name}.json`, skill.metadata!.schemaDocument as SchemaSpec])),
      executionPolicies: Object.fromEntries(skills.map(skill => [skill.name, skill.execution])),
    }),
  }
}

function sourceLocation(location: string | DesignKitLocation): DesignKitLocation {
  if (typeof location !== 'string') return location
  return {
    rootDir: location,
    mindsetPath: `${location}/mindset.md`,
    skillsDir: `${location}/skills`,
    relationsPath: `${location}/relations.yaml`,
  }
}

function assertAbsoluteLocation(location: DesignKitLocation): void {
  for (const [field, path] of Object.entries(location).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) {
    if (!isAbsolute(path)) throw new Error(`design kit: ${field} must be an absolute path, got ${JSON.stringify(path)}`)
  }
}

async function assertRealPathInside(fs: KitFsLike, realRoot: string | undefined, path: string): Promise<void> {
  if (fs.realPath === undefined || realRoot === undefined) return
  const real = await fs.realPath(path)
  const fromRoot = relative(realRoot, real)
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) throw new Error(`design kit: path escapes Kit root: ${path}`)
}

interface ResourceBudget {
  nodes: number
  bytes: number
  readonly realRoot?: string
  readonly visited: Set<string>
}

const MAX_RESOURCE_NODES = 10_000
const MAX_RESOURCE_DEPTH = 32
const MAX_RESOURCE_BYTES = 16 * 1024 * 1024

async function collectResourceInputs(
  fs: KitFsLike,
  root: string,
  rel = '',
  budget?: ResourceBudget,
  confinementRoot?: string,
): Promise<{ path: string; content: string }[]> {
  const state = budget ?? {
    nodes: 0,
    bytes: 0,
    ...(fs.realPath === undefined ? {} : { realRoot: confinementRoot ?? await fs.realPath(root) }),
    visited: new Set<string>(),
  }
  state.nodes += 1
  if (state.nodes > MAX_RESOURCE_NODES) throw new Error(`design kit: Bundle resources exceed ${MAX_RESOURCE_NODES} files and directories`)
  if (rel.split('/').filter(Boolean).length > MAX_RESOURCE_DEPTH) throw new Error(`design kit: Bundle resources exceed depth ${MAX_RESOURCE_DEPTH}`)
  const path = rel === '' ? root : resolve(root, rel)
  if (fs.realPath !== undefined) {
    const real = await fs.realPath(path)
    const fromRoot = relative(state.realRoot as string, real)
    if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) throw new Error(`design kit: resource escapes Bundle root: ${path}`)
    if (state.visited.has(real)) throw new Error(`design kit: resource symlink cycle at ${path}`)
    state.visited.add(real)
  }
  const directory = fs.isDirectory === undefined ? undefined : await fs.isDirectory(path)
  let entries: string[] = []
  if (directory === true || directory === undefined) {
    try {
      entries = (await fs.listDir(path))
      .filter((entry) => !entry.startsWith('.') && (rel !== '' || !entry.startsWith('_')))
      .sort()
    } catch {
      if (directory === true) throw new Error(`design kit: cannot list Bundle resource directory ${path}`)
      // Legacy adapters without isDirectory identify leaf files by listDir failure.
    }
  }
  if (directory === true || entries.length > 0) {
    for (const entry of entries) {
      if (entry === '.' || entry === '..' || entry.includes('/') || entry.includes('\\') || entry.includes('\0')) {
        throw new Error(`design kit: invalid Bundle resource name ${JSON.stringify(entry)}`)
      }
    }
    const nested = await Promise.all(entries.map((entry) => collectResourceInputs(fs, root, rel === '' ? entry : `${rel}/${entry}`, state, confinementRoot)))
    return nested.flat()
  }
  const resource = fs.readResource === undefined
    ? await fs.readText(path).then(content => content === undefined ? undefined : { kind: 'text' as const, content })
    : await fs.readResource(path)
  if (resource === undefined) throw new Error(`design kit: cannot read Bundle resource ${path}`)
  const byteLength = resource.kind === 'opaque' ? resource.byteLength : Buffer.byteLength(resource.content, 'utf8')
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) throw new Error(`design kit: invalid Bundle resource byte length ${path}`)
  state.bytes += byteLength
  if (state.bytes > MAX_RESOURCE_BYTES) throw new Error(`design kit: Bundle resources exceed ${MAX_RESOURCE_BYTES} bytes`)
  return resource.kind === 'opaque' ? [] : [{ path: rel, content: resource.content.replace(/\r\n?/g, '\n') }]
}

/**
 * Load one Design Kit from a content directory.
 * @param fs - filesystem adapter.
 * @param location - source root or resolved package content paths.
 * @param options - deployment-owned source identity used to derive Bundle authority.
 * @returns the assembled kit.
 * @throws when `mindset.md` is missing, has no `name` or `version` frontmatter,
 * any Bundle skill.yaml lacks a valid top-level `version` or a complete
 * bilingual `title`/`label`, an authored description is not bilingual, or two
 * skills share one locale's title (fail loud).
 */
export async function loadDesignBundle(
  fs: KitFsLike,
  location: { readonly rootDir: string; readonly sourceId: string; readonly current?: boolean },
  expectedPin?: { readonly name: string; readonly version?: string },
): Promise<DesignBundleContent> {
  const base = location.rootDir
  if (!isAbsolute(base)) throw new Error('design bundle: root must be absolute')
  const realBundleRootConfinement = fs.realPath === undefined ? undefined : await fs.realPath(base)
  await assertRealPathInside(fs, realBundleRootConfinement, resolve(base, 'skill.yaml'))
  const manifestSource = await fs.readText(resolve(base, 'skill.yaml'))
  if (manifestSource === undefined) throw new Error('design bundle: missing skill.yaml')
  const entry = parseSkillManifest(manifestSource, base).name
  if (typeof entry !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(entry)) throw new Error('design bundle: unsafe name')
    const bundleEntries = await fs.listDir(base)
    for (const sourceEntry of bundleEntries) {
      if (sourceEntry === '.' || sourceEntry === '..' || sourceEntry.includes('/') || sourceEntry.includes('\\') || sourceEntry.includes('\0')) {
        throw new Error(`design kit: invalid Bundle entry name ${JSON.stringify(sourceEntry)}`)
      }
    }
    const bundleEntrySet = new Set(bundleEntries)
    const slots = Object.fromEntries(await Promise.all(COMMON_SKILL_SLOTS.map(async (slot) => {
      const path = resolve(base, slot)
      if (!bundleEntrySet.has(slot)) throw new Error(`design kit: missing required slot ${path}`)
      await assertRealPathInside(fs, realBundleRootConfinement, path)
      const text = await fs.readText(path)
      if (text === undefined || text.trim() === '') throw new Error(`design kit: missing required slot ${path}`)
      return [slot, text] as const
    }))) as Record<(typeof COMMON_SKILL_SLOTS)[number], string>
    const skillMd = slots['SKILL.md']
    const frontmatter = parseFrontmatter(skillMd, `${base}/SKILL.md`)
    if (frontmatter.meta.name !== undefined && frontmatter.meta.name !== entry) {
      throw new Error(`design kit: ${base}/SKILL.md name must equal directory ${JSON.stringify(entry)}`)
    }
    if (frontmatter.meta.description !== undefined && typeof frontmatter.meta.description !== 'string') {
      throw new Error(`design kit: ${base}/SKILL.md description must be a string`)
    }
    const manifest = parseSkillManifest(slots['skill.yaml'], `${base}/skill.yaml`)
    if (manifest.name !== entry) {
      throw new Error(`design kit: ${base}/skill.yaml name must equal directory ${JSON.stringify(entry)}`)
    }
    if (manifest.version === undefined && !location.current) {
      throw new Error(`design kit: ${base}/skill.yaml must declare a top-level version`)
    }
    if (manifest.version !== undefined && typeof manifest.version !== 'string') {
      throw new Error(`design kit: ${base}/skill.yaml version must be a string`)
    }
    const bundleVersion = DesignBundleVersion(manifest.version ?? '1.0')
    assertSkillRuntime(manifest, `${base}/skill.yaml`)
    const title = parseBilingualManifestField(manifest, 'title', `${base}/skill.yaml`)
    const label = parseBilingualManifestField(manifest, 'label', `${base}/skill.yaml`)
    let pickerDescription = manifest.description === undefined
      ? undefined
      : parseBilingualManifestField(manifest, 'description', `${base}/skill.yaml`)
    const schemaDocument = parseSchemaYaml(slots['schema.yaml'])
    const validation = parseValidationYaml(slots['validation.yaml'])
    if (validation.skill !== entry) {
      throw new Error(`design kit: ${base}/validation.yaml skill must equal directory ${JSON.stringify(entry)}`)
    }
    if (validation.rules.length === 0) {
      throw new Error(`design kit: ${base}/validation.yaml must declare at least one rule`)
    }
    const presentation = typeof manifest.presentation === 'object' && manifest.presentation !== null && !Array.isArray(manifest.presentation)
      ? manifest.presentation as Record<string, unknown>
      : undefined
    const presentationSlots = Object.fromEntries(await Promise.all(DECLARATIVE_SKILL_SLOTS.map(async (slot) => {
      if (!bundleEntrySet.has(slot)) return [slot, undefined] as const
      const path = resolve(base, slot)
      await assertRealPathInside(fs, realBundleRootConfinement, path)
      return [slot, await fs.readText(path)] as const
    }))) as Record<(typeof DECLARATIVE_SKILL_SLOTS)[number], string | undefined>
    const mode = presentation?.mode
    if (mode === 'declarative') {
      for (const slot of ['panel.yaml'] as const) {
        if (presentationSlots[slot] === undefined || presentationSlots[slot]?.trim() === '') {
          throw new Error(`design kit: missing required declarative slot ${resolve(base, slot)}`)
        }
      }
    } else {
      const unexpected = DECLARATIVE_SKILL_SLOTS.find((slot) => bundleEntrySet.has(slot))
      if (unexpected !== undefined) {
        throw new Error(`design kit: ${base}/skill.yaml does not declare declarative presentation but ${unexpected} is present`)
      }
    }
    let panelYaml = mode === 'declarative' ? presentationSlots['panel.yaml'] as string : undefined
    const rendererMd = mode === 'declarative' ? presentationSlots['renderer.md'] as string : undefined
    const panelDocument = panelYaml === undefined ? undefined : parsePanelManifest(panelYaml)
    if (panelDocument?.i18n) {
      const messages: Record<string, Record<string, string>> = {}
      const realBundleRoot = fs.realPath === undefined ? undefined : await fs.realPath(base)
      for (const [locale, resource] of Object.entries(panelDocument.i18n.locales)) {
        const resourcePath = resolve(base, resource)
        await assertRealPathInside(fs, realBundleRootConfinement, resourcePath)
        await assertRealPathInside(fs, realBundleRoot, resourcePath)
        const source = await fs.readText(resourcePath)
        if (source === undefined) throw new Error(`design kit: missing locale resource ${resourcePath}`)
        messages[locale] = JSON.parse(source)
      }
      panelDocument.i18n = { ...panelDocument.i18n, messages }
      if (Object.values(messages).some(locale => Object.hasOwn(locale, 'bundleDescription'))) {
        if (manifest.description !== undefined) {
          throw new Error(`design kit: ${base} declares duplicate Bundle display descriptions in skill.yaml and locales`)
        }
        pickerDescription = parseBilingualManifestField({ description: {
          zh: messages['zh-CN']?.bundleDescription,
          en: messages['en-US']?.bundleDescription,
        } }, 'description', `${base}/locales bundleDescription`)
        // Preserve the existing picker wire contract. Only locales author this
        // presentation copy; Agent routing continues to use SKILL.md unchanged.
        manifest.description = pickerDescription
      }
      const errors = validatePanelTranslations(panelDocument, true)
      if (errors.length) throw new Error(`design kit: ${base}: ${errors.join('; ')}`)
      // Carry resolved messages through the existing cross-host panel contract.
      // Locale files remain the authored source; changing them changes this payload's hash.
      panelYaml = stringify(panelDocument)
    }
    const hasSummary = Object.hasOwn(manifest, 'summary')
    if (hasSummary && mode !== 'declarative') throw new Error(`design kit: ${base}/skill.yaml summary requires declarative presentation`)
    if (hasSummary && rendererMd !== undefined) throw new Error(`design kit: ${base} declares both skill.yaml summary and legacy renderer.md`)
    const rendererManifest = hasSummary ? parseDeclarativeSummary(manifest.summary)
      : rendererMd === undefined ? undefined : parseDeclarativeRendererManifest(rendererMd)
    if (panelDocument !== undefined) {
      // Panel/schema validation remains mandatory even when no summary is authored.
      assertDeclarativeConsistency(schemaDocument, panelDocument, rendererManifest ?? { version: 1, renderer: 'pilot-design/v2' }, base,
        hasSummary ? `${base}/skill.yaml summary` : `${base}/renderer.md`)
    }
    const metadata: Record<string, unknown> = {
      skillYaml: slots['skill.yaml'],
      skillManifest: manifest,
      schemaYaml: slots['schema.yaml'],
      schemaDocument,
      validationYaml: slots['validation.yaml'],
      validationDocument: validation,
      ...(panelYaml === undefined ? {} : { panelYaml }),
      ...(panelDocument === undefined ? {} : { panelManifest: panelDocument }),
      ...(rendererMd === undefined ? {} : { rendererMd }),
      ...(rendererManifest === undefined ? {} : { rendererManifest }),
    }
    const catalogName = manifest.identity ?? entry
    if (typeof catalogName !== 'string' || !/^[a-z][a-z0-9_]*$/.test(catalogName)) {
      throw new Error('design bundle: invalid independent identity')
    }
    const authority = deriveDesignBundleAuthorityId(location.sourceId, catalogName)
    const bundleResources = await collectResourceInputs(fs, base, '', undefined, realBundleRootConfinement)
    const skill: DesignSkill = {
      resourceRoot: base, sourceId: location.sourceId, sourceFs: fs,
      ...(manifest.identity === undefined ? {} : {catalogName}),
      name: typeof frontmatter.meta.name === 'string' ? frontmatter.meta.name : entry,
      authority,
      version: bundleVersion,
      description: typeof frontmatter.meta.description === 'string' ? frontmatter.meta.description : '',
      ...(pickerDescription === undefined ? {} : { pickerDescription }),
      title,
      label,
      content: frontmatter.body,
      execution: manifest.execution as DesignExecutionPolicy,
      metadata,
    }
  if (expectedPin && ((skill.catalogName ?? skill.name) !== expectedPin.name || (expectedPin.version !== undefined && String(skill.version) !== expectedPin.version))) {
    throw new Error('design bundle: exact pin does not match content')
  }
  return Object.freeze({ skill: Object.freeze(skill), resourceRoot: base, sourceId: location.sourceId,
    resources: Object.freeze(Object.fromEntries(bundleResources.map(r => [r.path, r.content]))) })
}

export async function loadDesignKit(
  fs: KitFsLike, location: string | DesignKitLocation, options: DesignKitLoadOptions,
): Promise<DesignKit> {
  const paths = typeof location === 'string'
    ? await resolveDesignKitPackage(fs, location) ?? sourceLocation(location) : location
  assertAbsoluteLocation(paths)
  const realKitRoot = fs.realPath === undefined ? undefined : await fs.realPath(paths.rootDir)
  await assertRealPathInside(fs, realKitRoot, paths.mindsetPath)
  const mindsetText = await fs.readText(paths.mindsetPath)
  if (mindsetText === undefined) throw new Error(`design kit: missing mindset file ${paths.mindsetPath}`)
  const { meta, body } = parseFrontmatter(mindsetText, paths.mindsetPath)
  const name = meta.name
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error(`design kit: mindset file missing "name" frontmatter: ${paths.mindsetPath}`)
  }
  if (meta.version === undefined && !options.current) {
    throw new Error(`design kit: mindset file missing "version" frontmatter: ${paths.mindsetPath}`)
  }
  if (meta.version !== undefined && typeof meta.version !== 'string') {
    throw new Error(`design kit: mindset file "version" frontmatter must be a string: ${paths.mindsetPath}`)
  }
  const version = DesignKitVersion(meta.version ?? '1.0')
  const relationsPath = paths.relationsPath ?? resolve(paths.rootDir, 'relations.yaml')
  let relationsSource: string | undefined
  if (fs.realPath !== undefined && realKitRoot !== undefined) {
    try {
      // Resolve confinement before reading bytes so an optional symlink cannot
      // disclose a file outside the installed Kit root.
      await assertRealPathInside(fs, realKitRoot, relationsPath)
      relationsSource = await fs.readText(relationsPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  } else {
    relationsSource = await fs.readText(relationsPath)
  }
  const relationVocabulary = compileDesignRelationVocabulary(relationsSource, name, version)
  if (meta.description !== undefined && typeof meta.description !== 'string') {
    throw new Error(`design kit: mindset file "description" frontmatter must be a string: ${paths.mindsetPath}`)
  }
  const pickerDescription = meta.display_description === undefined ? undefined
    : parseBilingualManifestField({ description: meta.display_description }, 'description', `${paths.mindsetPath} display_description`)

  const manifestPath = paths.manifestPath ?? resolve(paths.rootDir, 'kit.yaml')
  let manifestText: string | undefined
  try {
    await assertRealPathInside(fs, realKitRoot, manifestPath)
    manifestText = await fs.readText(manifestPath)
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const mounts = manifestText === undefined ? undefined : parseKitMounts(manifestText)
  const catalog = parseMindsetSkillNames(body, name)
  if (mounts && JSON.stringify(catalog) !== JSON.stringify(mounts.map(m => m.bindingKey))) {
    throw new Error('design kit: Mindset catalog differs from authoritative mounts')
  }
  if (!mounts) {
    await assertRealPathInside(fs, realKitRoot, paths.skillsDir)
    const entries = await fs.listDir(paths.skillsDir)
    const unknown = catalog.filter(skill => !entries.includes(skill))
    if (unknown.length) throw new Error(`design kit: Mindset references unknown skills: ${unknown.join(', ')}`)
  }
  const skills: DesignSkill[] = []
  const resources: { path: string; content: string }[] = []
  for (const entry of mounts ?? catalog.map(name => ({name}))) {
    let bundle: DesignBundleContent | undefined
    if ('version' in entry) {
      const resolver = options.resolveBundle ?? (paths.bundlesDir === undefined ? undefined
        : createDirectoryBundleResolver(fs, [{rootDir: paths.bundlesDir, sourceId: options.sourceId}]))
      if (!resolver) throw new Error('design kit: independent mounts require a Bundle resolver')
      bundle = await resolver(entry)
      if (!bundle || (bundle.skill.catalogName ?? bundle.skill.name) !== entry.name || (!options.current && String(bundle.skill.version) !== entry.version)) {
        throw new Error(`design kit: unavailable exact Bundle ${entry.name}@${entry.version}`)
      }
      if (bundle.skill.name !== entry.bindingKey) {
        throw new Error('design kit: bindingKey must preserve the Bundle runtime name and data paths')
      }
    } else {
      const base = resolve(paths.skillsDir, entry.name)
      await assertRealPathInside(fs, realKitRoot, base)
      bundle = await loadDesignBundle(fs, {rootDir: base, sourceId: options.sourceId})
    }
    skills.push(bundle.skill)
    resources.push(...Object.entries(bundle.resources).map(([path, content]) => ({path: `${bundle.skill.name}/${path}`, content})))
  }
  if (skills.length === 0) throw new Error(`design kit: no public skills found in ${paths.skillsDir}`)
  assertCrossPanelReferences(skills)
  assertUniqueSemanticCapabilities(skills)
  assertUniqueSkillTitles(skills)
  const kitResources = resources.filter((resource) => {
    const parts = resource.path.split('/')
    return parts.length !== 2 || !KNOWN_SKILL_SLOTS.includes(parts[1] as (typeof KNOWN_SKILL_SLOTS)[number])
  })
  const ontologyContract = compileDesignOntologyContract({
    kit: name,
    kitVersion: version,
    relationVocabulary,
    schemas: Object.fromEntries(skills.map(skill => [
      `${skill.name}/${skill.name}.json`,
      skill.metadata!.schemaDocument as SchemaSpec,
    ])),
    executionPolicies: Object.fromEntries(skills.map(skill => [skill.name, skill.execution])),
  })
  return {
    sourceRoot: paths.rootDir, sourceLocation: paths, sourceId: options.sourceId, sourceFs: fs,
    name,
    version,
    ...(typeof meta.description === 'string' ? { description: meta.description } : {}),
    ...(pickerDescription === undefined ? {} : { pickerDescription }),
    mindsetSource: mindsetText,
    mindset: body,
    relationVocabulary,
    ontologyContract,
    skills,
    resources: Object.freeze(Object.fromEntries(kitResources.map((resource) => [resource.path, resource.content]))),
  }
}
