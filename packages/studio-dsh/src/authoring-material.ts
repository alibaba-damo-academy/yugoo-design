/** Package-owned creator methods; model arguments select map keys, never files. */
import { open } from 'node:fs/promises'
import { PANEL_COMPONENT_CATALOG, queryPanelAuthoringReference } from 'dsh-design-core/dsl'

const MAX_MATERIAL_BYTES = 16 * 1024 * 1024
const MAX_RESOURCE_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_BYTES = 4 * 1024 * 1024
// Keep rendered tool pages below the Host's result spill threshold. This Agent
// reads indexed resources, so a spilled filesystem path is not a usable continuation.
const PAGE_BYTES = 16 * 1024
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

function textPage(bytes: Buffer, offset: unknown = 0) {
  if (!Number.isSafeInteger(offset) || typeof offset !== 'number' || offset < 0 || offset > bytes.length
    || (offset < bytes.length && (bytes[offset] & 0xc0) === 0x80)) throw new Error('Invalid authoring resource UTF-8 byte offset')
  let end = Math.min(bytes.length, offset + PAGE_BYTES)
  while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--
  return { offset, content: bytes.subarray(offset, end).toString('utf8'), bytes: end - offset, totalBytes: bytes.length,
    ...(end < bytes.length ? { nextOffset: end } : {}) }
}

export interface StudioAuthoringMaterialRequest {
  readonly resource?: string
  /** UTF-8 byte offset returned by the preceding page, starting at zero. */
  readonly offset?: number
}

export function createStudioAuthoringMaterialReader(value: unknown) {
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.skills) || !value.skills.length
    || !record(value.resources)) throw new Error('Packaged Studio authoring methods are unavailable')
  const entries = Object.entries(value.resources)
  if (!entries.length || entries.length > 128) throw new Error('Studio authoring material exceeds its resource budget')
  const resources = new Map<string, Buffer>()
  let total = 0
  for (const [path, entry] of entries) {
    if (!path || path.length > 1024 || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')
      || !record(entry) || typeof entry.content !== 'string') throw new Error('Invalid packaged Studio authoring resource')
    const bytes = Buffer.from(entry.content, 'utf8')
    if (bytes.length !== entry.bytes || bytes.length > MAX_RESOURCE_BYTES || (total += bytes.length) > MAX_TOTAL_BYTES) {
      throw new Error('Studio authoring material exceeds its text budget')
    }
    resources.set(path, bytes)
  }
  if (!resources.has('index.md') || value.skills.some(skill => !record(skill) || typeof skill.name !== 'string'
    || typeof skill.description !== 'string' || typeof skill.method !== 'string' || !resources.has(skill.method))) {
    throw new Error('Packaged Studio authoring method index is incomplete')
  }
  const skills = value.skills.map(skill => ({ name: skill.name as string, description: skill.description as string, method: skill.method as string }))
  return (input: unknown = {}) => {
    if (!record(input) || Reflect.ownKeys(input).some(key => key !== 'resource' && key !== 'offset')) {
      throw new Error('Authoring methods accept only an indexed resource and byte offset')
    }
    const resource = input.resource === undefined ? 'index.md' : input.resource, offset = input.offset === undefined ? 0 : input.offset
    if (typeof resource !== 'string' || !resources.has(resource)) throw new Error('Unknown indexed Studio authoring resource')
    const bytes = resources.get(resource)!
    return { resource, ...textPage(bytes, offset), ...(resource === 'index.md' ? { skills: structuredClone(skills) } : {}) }
  }
}

let packaged: Promise<ReturnType<typeof createStudioAuthoringMaterialReader>> | undefined
async function readPackageJson(path: 'studio-creators/material.json' | 'panel-components.json', maxBytes: number) {
  const handle = await open(new URL('../lib/authoring/' + path, import.meta.url), 'r')
  try {
    const bytes = Buffer.alloc(maxBytes + 1)
    let size = 0
    while (size < bytes.length) {
      const result = await handle.read(bytes, size, bytes.length - size, size)
      if (!result.bytesRead) break
      size += result.bytesRead
    }
    if (size > maxBytes) throw new Error('Packaged Studio authoring material exceeds its budget')
    return JSON.parse(bytes.subarray(0, size).toString('utf8')) as unknown
  } finally { await handle.close() }
}
export async function readStudioAuthoringMaterial(input: unknown = {}) {
  // Both src/ and lib/ point to the same build-owned package resource. It is
  // assembled from the existing authoring source by the normal build only.
  packaged ??= readPackageJson('studio-creators/material.json', MAX_MATERIAL_BYTES).then(createStudioAuthoringMaterialReader)
  return (await packaged)(input)
}

let panelMaterial: Promise<unknown> | undefined
/** Same Core query and build-generated source references as the Companion tool. */
export async function readStudioPanelComponents(input: unknown = {}) {
  if (!record(input) || Reflect.ownKeys(input).some(key => !['name', 'reference', 'type', 'offset'].includes(String(key)))) throw new Error('Invalid component reference request')
  const { name, reference, type, offset } = input
  if (name !== undefined && (typeof name !== 'string' || !name || name.length > 128 || !Object.hasOwn(PANEL_COMPONENT_CATALOG, name))) throw new Error('Unknown panel component; read components:{} for the installed vocabulary')
  if (reference !== undefined || type !== undefined) {
    if (typeof name !== 'string' || !['contract', 'docs', 'examples'].includes(reference as string)
      || (type !== undefined && (reference !== 'contract' || typeof type !== 'string' || !type || type.length > 256))) throw new Error('Component references require an exact name and contract/docs/examples; type is valid only for contract')
    panelMaterial ??= readPackageJson('panel-components.json', 6_000_000)
    const result = queryPanelAuthoringReference(await panelMaterial, name, reference as 'contract' | 'docs' | 'examples', type as string | undefined)
    const bytes = Buffer.from(JSON.stringify(result), 'utf8')
    if (bytes.length > 256 * 1024) throw new Error('Component authoring response exceeds its 256 KiB budget; follow an exact contract type')
    return bytes.length > PAGE_BYTES || offset !== undefined
      ? { component: name, reference, format: 'json', ...textPage(bytes, offset) } : result
  }
  if (offset !== undefined) throw new Error('Component offsets require an exact reference')
  return { components: Object.entries(PANEL_COMPONENT_CATALOG).filter(([kind]) => name === undefined || kind === name).map(([kind, entry]) => ({
    name: kind, ...entry, generated: 'autoOrder' in entry && entry.autoOrder !== undefined,
  })), contract: 'Runtime vocabulary and composition guidance only; not a complete parameter schema or standard A2UI specification.' }
}

export const STUDIO_AUTHORING_METHOD_GUIDANCE = 'Before proposing Kit/Bundle source changes, read the packaged creator method index and the applicable complete methods and linked resources. Follow every nextOffset until each required resource is complete; index summaries do not replace methods. Read the exact working copy and its own method/output contract too. Preserve its existing catalog identity, runtime name and version in their respective source files; display titles do not rename those identities. For Panel changes, read authoring:{resource:"source/docs/dsl-spec.md"} for the complete manifest, including required root fields; a component contract describes only part of that manifest. Discover components:{} and read the selected exact component with components:{name,reference:"contract"}, then its docs/examples and referenced type declarations before choosing parameters. Large component references return JSON text pages: keep the same selectors and follow nextOffset with components.offset until complete. Follow the returned selectors for allowed values instead of guessing from component names. When repairing diagnostics, retain already-correct changes and replace only the diagnosed assumptions. If a method or component contract is unavailable, report the gap instead of inventing it.'
