/** Data-only admission for explicitly trusted Provider packages, never a code loader. */
import { isValidVersionedId } from './design-driver-id.ts'
import type { DesignBundleContribution } from './runtime-drivers.ts'

export const COMPONENT_PACKAGE_FORMAT = 'yugoo-component-package/v1'
export interface ComponentPackagePin { readonly name: string; readonly version: string; readonly integrity: string }
export interface ComponentPackageManifest {
  readonly format: typeof COMPONENT_PACKAGE_FORMAT
  readonly name: string
  readonly version: string
  readonly namespace: string
  readonly summary: string
  readonly compatibility: { readonly nativePanelApi: 1; readonly reactMajor: 18; readonly reactSource: 'host' }
  readonly license: { readonly spdx: string; readonly file: string }
  readonly entry: { readonly server: string; readonly client: string }
  readonly files: readonly { readonly path: string; readonly sha256: string }[]
  readonly dependencies: readonly ComponentPackagePin[]
  readonly components: readonly { readonly id: string; readonly kind: 'native-panel'; readonly summary: string }[]
}
export interface ComponentPackageSource {
  /** Exact UTF-8 bytes of component-package.json; not an already-parsed approximation. */
  readonly manifest: Uint8Array
  /** Complete regular-file inventory except component-package.json. No files are executed. */
  readonly files: ReadonlyMap<string, Uint8Array>
}
export interface ComponentPackageHost {
  readonly nativePanelApi: number
  readonly reactVersion: string
  readonly reactDOMVersion: string
}
export interface ValidatedComponentPackage extends ComponentPackagePin {
  readonly manifest: ComponentPackageManifest
  readonly host: ComponentPackageHost
}
export class ComponentPackageError extends Error {
  readonly code: string
  readonly path: string
  constructor(code: string, path: string, message: string) {
    super(`${code} at ${path}: ${message}`); this.name = 'ComponentPackageError'; this.code = code; this.path = path
  }
}
const admitted = new WeakSet<object>()
const sha = /^[a-f0-9]{64}$/u
const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u
const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u
const fail = (code: string, path: string, message: string): never => { throw new ComponentPackageError(code, path, message) }
function object(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('package.object', path, 'Expected an object.')
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) fail('package.fields', path, 'Unknown or missing fields.')
  return record
}
function text(value: unknown, path: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024 || /[\u0000-\u001f\u007f]/u.test(value) || pattern && !pattern.test(value)) fail('package.value', path, 'Invalid declaration.')
  return value as string
}
function list(value: unknown, path: string, min = 0): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > 128) fail('package.list', path, 'Expected a bounded list.')
  return value as unknown[]
}
function pathValue(value: unknown, path: string): string {
  const result = text(value, path)
  if (result !== result.normalize('NFC') || result.split('/').length > 32 || /[\\:*?"<>|]/u.test(result) || result.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/u.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) fail('package.path', path, 'Expected a confined portable relative file path.')
  return result
}
function pin(value: unknown, path: string): ComponentPackagePin {
  const p = object(value, ['name', 'version', 'integrity'], path)
  return Object.freeze({ name: text(p.name, `${path}.name`, packageName), version: exactVersion(p.version, `${path}.version`), integrity: text(p.integrity, `${path}.integrity`, sha) })
}
function exactVersion(value: unknown, path: string): string {
  const result = text(value, path, version), suffix = result.indexOf('-')
  if (suffix >= 0 && result.slice(suffix + 1).split('.').some(part => /^0\d+$/u.test(part))) fail('package.value', path, 'Numeric prerelease identifiers cannot have leading zeroes.')
  return result
}
/** Parse the single supported contribution type; unknown DSL/code declarations fail closed. */
export function parseComponentPackageManifest(value: unknown): ComponentPackageManifest {
  const p = object(value, ['format', 'name', 'version', 'namespace', 'summary', 'compatibility', 'license', 'entry', 'files', 'dependencies', 'components'], '$')
  if (p.format !== COMPONENT_PACKAGE_FORMAT) fail('package.format', '$.format', 'Unsupported component package format.')
  const compatibility = object(p.compatibility, ['nativePanelApi', 'reactMajor', 'reactSource'], '$.compatibility')
  if (compatibility.nativePanelApi !== 1 || compatibility.reactMajor !== 18 || compatibility.reactSource !== 'host') fail('package.compatibility', '$.compatibility', 'Only native-panel API 1 and host React 18 are supported.')
  const license = object(p.license, ['spdx', 'file'], '$.license'), entry = object(p.entry, ['server', 'client'], '$.entry')
  const namespace = text(p.namespace, '$.namespace', /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u)
  const files = list(p.files, '$.files', 1).map((raw, index) => {
    const path = `$.files[${index}]`, f = object(raw, ['path', 'sha256'], path)
    return Object.freeze({ path: pathValue(f.path, `${path}.path`), sha256: text(f.sha256, `${path}.sha256`, sha) })
  })
  const paths = new Set<string>()
  const segments = new Map<string, string>()
  for (const [index, file] of files.entries()) {
    const folded = file.path.toLowerCase()
    if (folded === 'component-package.json' || paths.has(folded)) fail('package.file_conflict', `$.files[${index}].path`, 'Duplicate, case-conflicting or reserved manifest path.')
    paths.add(folded)
    const parts = file.path.split('/')
    for (let n = 1; n <= parts.length; n++) {
      const prefix = parts.slice(0, n).join('/'), key = prefix.toLowerCase()
      if (segments.has(key) && segments.get(key) !== prefix) fail('package.file_conflict', `$.files[${index}].path`, 'Case-conflicting path segments.')
      segments.set(key, prefix)
    }
  }
  for (const [index, file] of files.entries()) {
    if (file.path.split('/').slice(0, -1).some((_, n) => paths.has(file.path.split('/').slice(0, n + 1).join('/').toLowerCase()))) fail('package.file_conflict', `$.files[${index}].path`, 'A file cannot also be a directory.')
  }
  const components = list(p.components, '$.components', 1).map((raw, index) => {
    const path = `$.components[${index}]`, c = object(raw, ['id', 'kind', 'summary'], path)
    if (c.kind !== 'native-panel') fail('package.contribution_type', `${path}.kind`, 'Only trusted native-panel contributions are supported; DSL kinds are unchanged.')
    const id = text(c.id, `${path}.id`)
    if (!isValidVersionedId(id) || !id.startsWith(namespace + '.')) fail('package.namespace', `${path}.id`, 'Contribution must be a versioned identifier inside the package namespace.')
    return Object.freeze({ id, kind: 'native-panel' as const, summary: text(c.summary, `${path}.summary`) })
  })
  if (new Set(components.map(c => c.id)).size !== components.length) fail('package.component_conflict', '$.components', 'Repeated component identifier.')
  const dependencies = list(p.dependencies, '$.dependencies').map((raw, index) => pin(raw, `$.dependencies[${index}]`))
  if (new Set(dependencies.map(d => d.name)).size !== dependencies.length) fail('package.dependency_conflict', '$.dependencies', 'One exact pin per dependency name is required.')
  const result: ComponentPackageManifest = Object.freeze({
    format: COMPONENT_PACKAGE_FORMAT, name: text(p.name, '$.name', packageName), version: exactVersion(p.version, '$.version'), namespace, summary: text(p.summary, '$.summary'),
    compatibility: Object.freeze({ nativePanelApi: 1, reactMajor: 18, reactSource: 'host' }),
    license: Object.freeze({ spdx: text(license.spdx, '$.license.spdx'), file: pathValue(license.file, '$.license.file') }),
    entry: Object.freeze({ server: pathValue(entry.server, '$.entry.server'), client: pathValue(entry.client, '$.entry.client') }),
    files: Object.freeze(files), dependencies: Object.freeze(dependencies), components: Object.freeze(components),
  })
  for (const [label, required] of [['$.entry.server', result.entry.server], ['$.entry.client', result.entry.client], ['$.license.file', result.license.file], ['$.files', 'package.json']] as const) {
    if (!files.some(file => file.path === required)) fail('package.missing_file', label, `Missing inventoried file ${required}.`)
  }
  for (const [key, entryPath] of Object.entries(result.entry)) if (!/\.(?:mjs|js)$/u.test(entryPath)) fail('package.entry', `$.entry.${key}`, 'A compiled JavaScript Provider entry is required.')
  return result
}
async function hash(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) fail('package.crypto', '$host', 'SHA-256 requires Web Crypto in this host context.')
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))].map(x => x.toString(16).padStart(2, '0')).join('')
}
function json(bytes: Uint8Array, path: string): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { return fail('package.json', path, 'Invalid UTF-8 JSON.') }
}
function reactPeer(range: unknown, installed: string, path: string): void {
  // C1 deliberately accepts only exact or caret full versions, not a guessed npm range parser.
  const match = typeof range === 'string' ? /^(\^?)(18)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(range) : null
  const actual = /^18\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(installed)
  if (!match || !actual || (match[1] ? Number(actual[1]) < Number(match[3]) || Number(actual[1]) === Number(match[3]) && Number(actual[2]) < Number(match[4]) : installed !== range)) fail('package.react_peer', path, 'Requires a satisfied exact/caret React 18 peer supplied by the host.')
}
/** Verify the supplied bytes and exact dependency closure without executing package files. */
export async function validateComponentPackageClosure(sources: readonly ComponentPackageSource[], root: ComponentPackagePin, host: ComponentPackageHost): Promise<readonly ValidatedComponentPackage[]> {
  root = pin(root, '$root')
  host = Object.freeze({ nativePanelApi: host.nativePanelApi, reactVersion: host.reactVersion, reactDOMVersion: host.reactDOMVersion })
  if (host.nativePanelApi !== 1 || !/^18\.\d+\.\d+$/u.test(host.reactVersion) || !/^18\.\d+\.\d+$/u.test(host.reactDOMVersion)) fail('package.host', '$host', 'Requires native-panel API 1 and host React/ReactDOM 18.')
  if (!sources.length || sources.length > 128) fail('package.closure', '$sources', 'Expected 1–128 packages.')
  let total = 0
  const snapshots = sources.map((source, index) => {
    if (!(source?.manifest instanceof Uint8Array) || !(source.files instanceof Map) || source.files.size > 128) fail('package.source', `$sources[${index}]`, 'Expected manifest bytes and a regular-file byte map.')
    const buffers = [...source.files.values()]
    if (buffers.some(bytes => !(bytes instanceof Uint8Array))) fail('package.source', `$sources[${index}].files`, 'Expected file bytes.')
    const size = buffers.reduce((n, bytes) => n + bytes.length, source.manifest.length)
    total += size
    if (source.manifest.length > 128 * 1024 || size > 8 * 1024 * 1024 || total > 32 * 1024 * 1024) fail('package.budget', `$sources[${index}]`, 'Package/closure exceeds byte limits.')
    return { manifest: Uint8Array.from(source.manifest), files: new Map([...source.files].map(([path, bytes]) => [path, Uint8Array.from(bytes)])) }
  })
  const packages = new Map<string, ValidatedComponentPackage>(), namespaces = new Set<string>(), ids = new Set<string>()
  for (const [index, source] of snapshots.entries()) {
    const manifestBytes = source.manifest, files = source.files
    const manifest = parseComponentPackageManifest(json(manifestBytes, `$sources[${index}].manifest`))
    if (files.size !== manifest.files.length || [...files.keys()].some(path => !manifest.files.some(file => file.path === path))) fail('package.inventory', `$sources[${index}].files`, 'Inventory must contain every file exactly once.')
    const hashes = []
    for (const [fileIndex, file] of manifest.files.entries()) {
      const bytes = files.get(file.path)
      if (!bytes) fail('package.missing_file', `$.files[${fileIndex}].path`, file.path)
      const digest = await hash(bytes!)
      if (digest !== file.sha256) fail('package.digest', `$.files[${fileIndex}].sha256`, `Byte digest mismatch for ${file.path}.`)
      hashes.push([file.path, digest])
    }
    if (!files.get(manifest.license.file)!.length) fail('package.license', '$.license.file', 'License file is empty.')
    const npm = json(files.get('package.json')!, 'package.json') as Record<string, unknown>
    if (!npm || npm.name !== manifest.name || npm.version !== manifest.version || npm.license !== manifest.license.spdx) fail('package.identity', 'package.json', 'Package identity/version/license differs from the manifest.')
    const exports = npm.exports as Record<string, unknown> | undefined
    if (exports?.['.'] !== './' + manifest.entry.server || exports?.['./client'] !== './' + manifest.entry.client) fail('package.entry', 'package.json.exports', 'Package exports must select the inventoried Provider entries.')
    const peers = npm.peerDependencies as Record<string, unknown> | undefined
    if (!peers || typeof peers !== 'object' || Array.isArray(peers) || Object.keys(peers).some(name => !['react', 'react-dom'].includes(name))) fail('package.dependencies', 'package.json.peerDependencies', 'Only explicit Host React/ReactDOM peers are supported.')
    reactPeer(peers?.react, host.reactVersion, 'package.json.peerDependencies.react')
    reactPeer(peers?.['react-dom'], host.reactDOMVersion, 'package.json.peerDependencies.react-dom')
    const dependencies = npm.dependencies ?? {}
    if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) fail('package.dependencies', 'package.json.dependencies', 'Expected exact dependencies.')
    if (Object.keys(dependencies).length !== manifest.dependencies.length || manifest.dependencies.some(dep => (dependencies as Record<string, unknown>)[dep.name] !== dep.version)) fail('package.dependencies', 'package.json.dependencies', 'npm dependencies must equal the exact declared package closure; React is host-only.')
    if (npm.optionalDependencies || npm.bundleDependencies || npm.bundledDependencies) fail('package.dependencies', 'package.json', 'Optional/bundled dependencies are unsupported in this bounded package format.')
    const integrity = await hash(new TextEncoder().encode(JSON.stringify({ manifest: await hash(manifestBytes), files: hashes.sort(([a], [b]) => a! < b! ? -1 : a! > b! ? 1 : 0) })))
    const value: ValidatedComponentPackage = Object.freeze({ name: manifest.name, version: manifest.version, integrity, manifest, host: Object.freeze({ ...host }) })
    if (packages.has(value.name)) fail('package.identity_conflict', '$sources', 'One version per package name is supported in one closure.')
    if (namespaces.has(manifest.namespace)) fail('package.namespace_conflict', '$.namespace', 'Package namespaces must be unique.')
    for (const component of manifest.components) { if (ids.has(component.id)) fail('package.component_conflict', '$.components', component.id); ids.add(component.id) }
    packages.set(value.name, value); namespaces.add(manifest.namespace)
  }
  const result: ValidatedComponentPackage[] = [], visiting = new Set<string>(), visited = new Set<string>()
  const visit = (expected: ComponentPackagePin, path: string) => {
    if (visiting.has(expected.name)) fail('package.dependency_cycle', path, 'Cyclic component package dependencies.')
    const value = packages.get(expected.name)
    if (!value || value.version !== expected.version || value.integrity !== expected.integrity) fail('package.dependency_pin', path, 'Missing package or exact version/integrity mismatch.')
    if (visited.has(value!.name)) return
    visiting.add(value!.name)
    value!.manifest.dependencies.forEach((dep, index) => visit(dep, `${value!.name}.dependencies[${index}]`))
    visiting.delete(value!.name); visited.add(value!.name); result.push(value!)
  }
  visit(root, '$root')
  if (visited.size !== packages.size) fail('package.closure', '$sources', 'Unreferenced packages are not part of the exact closure.')
  for (const value of result) admitted.add(value)
  return Object.freeze(result)
}
/** Reject descriptor lookalikes: only the byte/closure validator issues admission records. */
export function requireValidatedComponentPackage(value: ValidatedComponentPackage): void {
  if (!admitted.has(value)) fail('package.unvalidated', '$package', 'Validate package bytes and the complete closure before registration.')
}

/** Install only the declared presentation claims through the existing authority registry. */
export function registerComponentPackageContributions(
  registry: { registerBundleContribution(contribution: DesignBundleContribution): () => void },
  value: ValidatedComponentPackage,
  contributions: readonly DesignBundleContribution[],
): () => void {
  requireValidatedComponentPackage(value)
  const expected = new Set(value.manifest.components.map(component => component.id))
  if (contributions.length !== expected.size || contributions.some(contribution => {
    if (!contribution || typeof contribution.authority !== 'string' || !contribution.authority.trim() || Object.keys(contribution).some(key => !['authority', 'presentation'].includes(key)) || !contribution.presentation || !expected.delete(contribution.presentation)) return true
    return false
  }) || expected.size) fail('package.contributions', '$contributions', 'Supply each declared native presentation once, with its existing Bundle authority; other contribution types are unsupported.')
  const disposers: (() => void)[] = []
  try { for (const contribution of contributions) disposers.push(registry.registerBundleContribution(contribution)) }
  catch (error) { for (const dispose of disposers.reverse()) dispose(); throw error }
  return () => { for (const dispose of [...disposers].reverse()) dispose() }
}
