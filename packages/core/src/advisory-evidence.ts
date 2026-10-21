/** Bounded immutable evidence for reviewers; no filesystem or execution capability. */
import { createHash } from 'node:crypto'
import { GitBlobSizeLimitError, type GitVersioning } from './git.ts'
import { parseDesignProjectJson, type DesignProjectKitPin } from './design-project.ts'
import type { DesignKit } from './types.ts'
import type { DesignBundleContent } from './kit-loader.ts'
import { pageDesignSkillResource, type DesignSkillResourcePage } from './dsh-producer-design-tools.ts'

const MAX_FILE_BYTES = 1_048_576
const MAX_TOTAL_BYTES = 8_388_608
const MAX_FILES = 2048
const MAX_READS = 256
const MAX_DISCOVERY_BYTES = 131_072

// Small input eligibility; preparation shares the ordinary read/byte budgets.
const SMALL_SNAPSHOT_FILES = 4
const SMALL_SNAPSHOT_RAW_BYTES = 32_768
const SMALL_SNAPSHOT_SERIALIZED_BYTES = 32_768

/** Only a decoder invoked for optional text preparation may emit this result. */
class UnsupportedSnapshotText extends Error {}

function decodeFactText(bytes: Uint8Array, forSnapshot = false): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch (error) {
    if (forSnapshot && error instanceof TypeError) {
      throw new UnsupportedSnapshotText('advisory evidence: snapshot requires UTF-8 text', { cause: error })
    }
    throw error
  }
}

/** Exact original facts, complete across every path in the immutable manifest. */
export interface AdvisoryFactSnapshot {
  readonly project: string
  readonly checkpoint: string
  readonly complete: true
  readonly files: readonly Readonly<DesignSkillResourcePage & { checkpoint: string; path: string }>[]
}

export interface AdvisoryEvidence {
  readonly manifest: Readonly<Record<string, unknown>>
  /** Page the same pinned discovery index; never substitutes live Kit resources. */
  discover?(options: { kind: 'files' | 'bundles' | 'resources'; bundle?: string; prefix?: string; offset?: number; limit?: number }, signal: AbortSignal): unknown
  /** Optional owner preparation; an ineligible snapshot leaves bound reads intact. */
  readSmallSnapshot?(signal: AbortSignal): Promise<AdvisoryFactSnapshot | undefined>
  list(prefix: string): readonly string[]
  read(path: string, offset: number, maxChars: number, signal: AbortSignal): Promise<unknown>
  search(text: string, signal: AbortSignal): Promise<unknown>
  resource(bundle: string, path: string, offset: number, maxChars: number, signal: AbortSignal): unknown
}

function path(value: string): string {
  if (!value || value.length > 1024 || value.includes('\\') || /[\u0000-\u001f]/.test(value) || value.startsWith('/')
    || value.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) {
    throw new Error('advisory evidence: expected a confined logical path')
  }
  return value
}

/** Resolve the commit's own content pin through the existing immutable catalog. */
export async function createAdvisoryEvidence(input: {
  git: Pick<GitVersioning, 'listPathsAt' | 'readBytesAt'>
  commit: string
  projectId: string
  resolveKit(pin: DesignProjectKitPin): DesignKit | undefined
  resolveBundle(pin: { name: string; version: string }): DesignBundleContent | undefined
  signal: AbortSignal
}): Promise<AdvisoryEvidence> {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.commit)) throw new Error('advisory evidence: full commit OID required')
  const metadataBytes = await input.git.readBytesAt(input.commit, 'project.json', input.signal, MAX_FILE_BYTES)
  if (!metadataBytes) throw new Error('advisory evidence: committed project.json is unavailable')
  const metadata = parseDesignProjectJson(Buffer.from(metadataBytes).toString('utf8'))
  if (metadata.id !== input.projectId || !metadata.kit) throw new Error('advisory evidence: committed project identity/Kit pin mismatch')
  const kit = input.resolveKit(metadata.kit)
  if (!kit || kit.name !== metadata.kit.name || kit.version !== metadata.kit.version) {
    throw new Error('advisory evidence: exact committed Kit is unavailable')
  }
  const paths = (await input.git.listPathsAt(input.commit, input.signal)).filter(p =>
    p === 'project.json' || (p.startsWith('design_files/') && !p.startsWith('design_files/_experiences/')))
  if (paths.length > MAX_FILES) throw new Error('advisory evidence: snapshot exceeds file limit')
  const allowed = new Set(paths.map(path))
  const cache = new Map<string, string>([['project.json', Buffer.from(metadataBytes).toString('utf8')]])
  let total = metadataBytes.length, reads = 0
  let reading: Promise<unknown> = Promise.resolve()
  const charge = () => { if (++reads > MAX_READS) throw new Error('advisory evidence: read budget exhausted') }
  const textAt = async (name: string, signal: AbortSignal, snapshotMaxBytes?: number) => {
    signal.throwIfAborted()
    if (!allowed.has(path(name))) throw new Error('advisory evidence: path is outside the pinned snapshot')
    if (cache.has(name)) return cache.get(name)!
    const operation = reading.then(async () => {
      signal.throwIfAborted()
      if (cache.has(name)) return cache.get(name)!
      const remaining = MAX_TOTAL_BYTES - total
      if (remaining <= 0) throw new Error('advisory evidence: byte budget exhausted')
      const bytes = await input.git.readBytesAt(input.commit, name, signal, Math.min(MAX_FILE_BYTES, remaining, snapshotMaxBytes ?? MAX_FILE_BYTES))
      signal.throwIfAborted()
      if (!bytes) throw new Error('advisory evidence: committed file is unavailable')
      total += bytes.length
      const text = decodeFactText(bytes, snapshotMaxBytes !== undefined)
      cache.set(name, text)
      return text
    })
    reading = operation.catch(() => {})
    return operation
  }
  const resources = new Map<string, Readonly<{ text: string; representation: string; name: string; version: string; sha256: string }>>()
  const bundles = kit.skills.map(skill => {
    const identity = skill.catalogName ?? skill.name
    const content = input.resolveBundle({ name: identity, version: String(skill.version) })
    if (metadata.kit!.bundles?.[identity] !== undefined && !content) {
      throw new Error('advisory evidence: exact overridden Bundle is unavailable')
    }
    if (content && (content.skill.name !== skill.name || content.skill.version !== skill.version
      || (content.skill.catalogName ?? content.skill.name) !== identity)) {
      throw new Error('advisory evidence: Bundle binding/version mismatch')
    }
    const values: Record<string, { text: string; representation: string }> = {}
    for (const [key, value] of Object.entries(content?.resources ?? {})) {
      values[path(key)] = { text: value, representation: 'loaded-resource' }
    }
    // Legacy embedded Bundles already have parsed methods/schema in the same
    // loader. Label these projections; never invent raw definition-file bytes.
    if (!values['SKILL.md'] && skill.content.trim()) values['SKILL.md'] = { text: skill.content, representation: 'loaded-method-body-projection' }
    if (!values['schema.yaml'] && typeof skill.metadata?.schemaYaml === 'string') values['schema.yaml'] = {
      text: skill.metadata.schemaYaml, representation: 'loaded-schema-projection',
    }
    if (!values['validation.yaml'] && typeof skill.metadata?.validationYaml === 'string') values['validation.yaml'] = {
      text: skill.metadata.validationYaml, representation: 'loaded-validation-projection',
    }
    if (!values['schema.yaml'] && skill.metadata?.schemaDocument) values['schema.yaml'] = {
      text: JSON.stringify(skill.metadata.schemaDocument, null, 2), representation: 'loaded-schema-projection',
    }
    for (const [key, value] of Object.entries(kit.resources)) {
      if (key.startsWith(`${skill.name}/`)) values[path(key.slice(skill.name.length + 1))] ??= { text: value, representation: 'loaded-resource' }
    }
    const entries = Object.entries(values).map(([key, value]) => {
      const sha256 = createHash('sha256').update(value.text).digest('hex')
      resources.set(`${skill.name}/${key}`, Object.freeze({ ...value, name: identity, version: String(skill.version), sha256 }))
      return { path: key, representation: value.representation,
        sha256 }
    })
    return { bindingKey: skill.name, name: identity, version: skill.version, resources: entries }
  })
  const fullManifest = { project: input.projectId, checkpoint: input.commit, kit: metadata.kit,
    paths, bundles, authority: 'Project facts: committed Design Files. Bundle resources: method/schema only, never new project facts.' }
  const serializedManifest = JSON.stringify(fullManifest)
  const manifestRevision = createHash('sha256').update(serializedManifest).digest('hex')
  // The response bound applies to each discovery page, not the size of an
  // installed Kit's complete index. Keep small callers byte-compatible. Large
  // Kits discover every original entry with the existing list capability.
  const manifest = Object.freeze(Buffer.byteLength(serializedManifest) <= MAX_DISCOVERY_BYTES ? fullManifest : {
    project: input.projectId, checkpoint: input.commit, kit: metadata.kit, authority: fullManifest.authority,
    discovery: { complete: false, manifestRevision, tool: 'list', kinds: ['files', 'bundles', 'resources'],
      files: paths.length, bundles: bundles.length, resources: resources.size,
      instruction: 'Use list with kind=files or bundles, then kind=resources and the exact bindingKey. Follow nextOffset until complete=true. Resource pages retain original paths, representations and SHA256; read_skill_resource reads their exact bytes.' },
  })
  if (Buffer.byteLength(JSON.stringify(manifest)) > MAX_DISCOVERY_BYTES) throw new Error('advisory evidence: discovery identity exceeds limit')
  return Object.freeze({
    manifest,
    discover(options: Parameters<NonNullable<AdvisoryEvidence['discover']>>[0], signal: AbortSignal) {
      signal.throwIfAborted(); charge()
      const { kind, bundle, prefix = '', offset = 0, limit = 30 } = options
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new Error('advisory evidence: invalid discovery page')
      }
      if (prefix !== '') path(prefix.replace(/\/$/, ''))
      let entries: readonly unknown[]
      if (kind === 'files' && bundle === undefined) entries = paths.filter(name => name.startsWith(prefix))
      else if (kind === 'bundles' && bundle === undefined && prefix === '') entries = bundles.map(({ resources, ...pin }) => ({ ...pin, resourceCount: resources.length }))
      else if (kind === 'resources' && typeof bundle === 'string') {
        const selected = bundles.find(item => item.bindingKey === bundle)
        if (!selected) throw new Error('advisory evidence: exact pinned Bundle resource is unavailable')
        entries = selected.resources.filter(item => item.path.startsWith(prefix))
      } else throw new Error('advisory evidence: invalid discovery kind or Bundle')
      if (offset > entries.length) throw new Error('advisory evidence: discovery offset exceeds index')
      const page: unknown[] = []
      const result = () => ({ project: input.projectId, checkpoint: input.commit, manifestRevision, kind,
        ...(bundle === undefined ? {} : { bundle }), offset, total: entries.length, entries: page,
        complete: offset + page.length === entries.length,
        nextOffset: offset + page.length === entries.length ? null : offset + page.length })
      for (const entry of entries.slice(offset, offset + limit)) {
        page.push(entry)
        if (Buffer.byteLength(JSON.stringify(result())) > MAX_DISCOVERY_BYTES) { page.pop(); break }
      }
      if (offset < entries.length && page.length === 0) throw new Error('advisory evidence: discovery entry exceeds limit')
      signal.throwIfAborted()
      return result()
    },
    async readSmallSnapshot(signal: AbortSignal): Promise<AdvisoryFactSnapshot | undefined> {
      signal.throwIfAborted()
      if (paths.length > SMALL_SNAPSHOT_FILES) return undefined
      // Metadata uses the existing parser/cache. Validate its original bytes
      // before describing every cached file as exact UTF-8 evidence.
      if (metadataBytes.length > SMALL_SNAPSHOT_RAW_BYTES) return undefined
      try { decodeFactText(metadataBytes, true) }
      catch (error) {
        signal.throwIfAborted()
        if (error instanceof UnsupportedSnapshotText) return undefined
        throw error
      }
      const files: AdvisoryFactSnapshot['files'][number][] = []
      let rawBytes = 0
      for (const name of paths) {
        charge()
        let text: string
        try {
          // Git checks blob size before capturing its body. Paging alone would
          // still load up to the ordinary 1 MiB limit to discover a large file.
          text = await textAt(name, signal, SMALL_SNAPSHOT_RAW_BYTES - rawBytes)
        } catch (error) {
          signal.throwIfAborted()
          if (error instanceof GitBlobSizeLimitError || error instanceof UnsupportedSnapshotText) return undefined
          throw error
        }
        signal.throwIfAborted()
        rawBytes += Buffer.byteLength(text, 'utf8')
        if (rawBytes > SMALL_SNAPSHOT_RAW_BYTES) return undefined
        const page = pageDesignSkillResource(text)
        if (!page.complete) return undefined
        files.push(Object.freeze({ checkpoint: input.commit, path: name, ...page }))
      }
      const snapshot: AdvisoryFactSnapshot = Object.freeze({ project: input.projectId, checkpoint: input.commit,
        complete: true, files: Object.freeze(files) })
      if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > SMALL_SNAPSHOT_SERIALIZED_BYTES) return undefined
      signal.throwIfAborted()
      return snapshot
    },
    list(prefix: string) {
      charge()
      if (prefix !== '') path(prefix.replace(/\/$/, ''))
      return paths.filter(p => p.startsWith(prefix)).slice(0, MAX_FILES)
    },
    async read(name: string, offset: number, maxChars: number, signal: AbortSignal) {
      charge()
      return { checkpoint: input.commit, path: name, ...pageDesignSkillResource(await textAt(name, signal), offset, maxChars) }
    },
    async search(text: string, signal: AbortSignal) {
      charge()
      if (!text || text.length > 256) throw new Error('advisory evidence: search requires 1..256 literal characters')
      const matches: { path: string; line: number; text: string }[] = []
      for (const name of paths) {
        const lines = (await textAt(name, signal)).split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (lines[i]!.includes(text)) matches.push({ path: name, line: i + 1, text: lines[i]!.slice(0, 500) })
          if (matches.length === 100) return { checkpoint: input.commit, matches, truncated: true }
        }
      }
      return { checkpoint: input.commit, matches, truncated: false }
    },
    resource(bundle: string, name: string, offset: number, maxChars: number, signal: AbortSignal) {
      signal.throwIfAborted(); charge()
      if (!bundles.some(item => item.bindingKey === bundle)) throw new Error('advisory evidence: exact pinned Bundle resource is unavailable')
      const value = resources.get(`${path(bundle)}/${path(name)}`)
      if (!value) throw new Error('advisory evidence: exact pinned Bundle resource is unavailable')
      return { bundle, name: value.name, version: value.version, sha256: value.sha256, path: name,
        representation: value.representation, ...pageDesignSkillResource(value.text, offset, maxChars) }
    },
  })
}
