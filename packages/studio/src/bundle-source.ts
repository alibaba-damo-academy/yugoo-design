/**
 * Read-only inspection of real Bundle source files.
 *
 * The Bundle content authority is the Kit source directory on disk. The read
 * model exposes the physical file tree, byte-exact text content, and the
 * loader-compiled manifest/schema/validation summaries with Panel
 * classification. Identity is reconciled against the host's Core-compiled
 * catalog by exact Kit and Bundle name+version; an ambiguous physical source
 * or a catalog/source disagreement fails loud instead of guessing. The Studio
 * never writes: traversal, `.git`, directories, and binary content are
 * rejected, and no mutation port exists.
 */
import { join, resolve } from 'node:path'
import type { DesignSkill } from 'dsh-design-core'
import { loadStudioKit } from './load.ts'
import type { StudioCatalogSnapshotPort } from './snapshot.ts'
import { StudioBinaryContentError, type StudioDiagnostic, type StudioReadFs } from './types.ts'

/**
 * Read-only physical source operations the Bundle workspace needs from its
 * Agent Host. The members are structurally compatible with {@link StudioReadFs}
 * so the Design Core loader runs directly against the port. Path confinement
 * (traversal, `.git`, symlink escape, regular files only) is the adapter's
 * responsibility; the service independently rejects unsafe path shapes.
 */
export interface StudioBundleSourcePort {
  /** Resolve an exact independent source; never infer ownership from a Kit. */
  resolveBundleRoot?(pin: { name: string; version: string }): Promise<string | undefined>
  /** Every authored Kit source root; each holds `mindset.md` and `skills/`. */
  listKitRoots(): Promise<readonly string[]>
  /** Read one UTF-8 text file; `undefined` when absent. Throws {@link StudioBinaryContentError} for non-text content. */
  readText(path: string): Promise<string | undefined>
  /** List one directory's entry names; empty when absent. */
  listDir(path: string): Promise<string[]>
  /** Whether one path is a directory. */
  isDirectory(path: string): Promise<boolean>
  /** Every regular file below one directory, as sorted slash-separated relative paths. */
  listFiles(path: string): Promise<readonly string[]>
}

/** One readable UTF-8 file in a Bundle workspace file tree. */
export interface StudioBundleFileRefView {
  /** Slash-separated path relative to the Bundle root. */
  readonly path: string
  /** UTF-8 byte length of the file content. */
  readonly bytes: number
}

/** Panel classification of one Bundle's presentation declaration. */
export interface StudioBundlePanelView {
  /** `native` Panels are provider-owned code, read-only in the Studio; `declarative` Panels are Bundle-authored data. */
  readonly kind: 'native' | 'declarative'
  /** Declared renderer identity. */
  readonly renderer?: string
}

/** Validator summary derived from the compiled validation document. */
export interface StudioBundleValidationSummary {
  /** Number of declared validation rules. */
  readonly rules: number
  /** Sorted unique runtime validation driver identities referenced by rules; empty for driver-free rules. */
  readonly drivers: readonly string[]
}

/** Read model of one authored Bundle: physical files plus compiled summaries. */
export interface StudioBundleWorkspaceView {
  /** Bundle id (its `skills/<name>/` directory name). */
  readonly name: string
  /** Declared Bundle version, reconciled against the compiled catalog. */
  readonly version: string
  /** Kit name declaring this Bundle in its catalog. */
  readonly kit?: string
  /** One-line Bundle description. */
  readonly description: string
  readonly displayDescription?: Readonly<{ zh: string; en: string }>
  /** Every readable UTF-8 file below the Bundle root, sorted by path. */
  readonly files: readonly StudioBundleFileRefView[]
  /** Parsed skill.yaml manifest, JSON-projected. */
  readonly manifest?: Readonly<Record<string, unknown>>
  /** Parsed schema.yaml document, JSON-projected. */
  readonly schema?: Readonly<Record<string, unknown>>
  /** Validation rule and driver summary. */
  readonly validation?: StudioBundleValidationSummary
  /** Panel classification; absent when the Bundle declares no presentation. */
  readonly panel?: StudioBundlePanelView
}

/** The read result of one Bundle workspace. */
export interface StudioBundleWorkspaceResult {
  /** The workspace view; undefined when resolution or reconciliation fails. */
  readonly workspace?: StudioBundleWorkspaceView
  /** Resolution, reconciliation, or load diagnostics. */
  readonly diagnostics: readonly StudioDiagnostic[]
}

/** One complete Bundle file read byte-exactly as UTF-8 text. */
export interface StudioBundleFileView {
  /** Slash-separated path relative to the Bundle root. */
  readonly path: string
  /** Complete UTF-8 file content. */
  readonly content: string
}

/** The read result of one Bundle file. */
export interface StudioBundleFileResult {
  /** The file; undefined when it is missing, unsafe, or not text. */
  readonly file?: StudioBundleFileView
  /** Resolution diagnostics. */
  readonly diagnostics: readonly StudioDiagnostic[]
}

function diagnostic(code: string, message: string, subject?: string): readonly StudioDiagnostic[] {
  return Object.freeze([Object.freeze(subject === undefined ? { code, message } : { code, message, subject })])
}

function jsonProject(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return Object.freeze(JSON.parse(JSON.stringify(value)) as Record<string, unknown>)
}

function utf8ByteLength(content: string): number {
  return new TextEncoder().encode(content).length
}

/**
 * Split one relative file path into safe segments. Rejects absolute paths,
 * empty/`.`/`..`/`.git` segments, backslashes, and control characters.
 * @param path - candidate slash-separated relative path.
 * @returns the segments, or undefined when the shape is unsafe.
 */
function safeSegments(path: string): readonly string[] | undefined {
  if (path === '' || path.startsWith('/') || path.endsWith('/') || path.includes('\\') || /[\u0000-\u001f\u007f]/u.test(path)) {
    return undefined
  }
  const parts = path.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..' || part === '.git')) return undefined
  return parts
}

function panelOf(manifest: Readonly<Record<string, unknown>> | undefined): StudioBundlePanelView | undefined {
  const presentation = manifest?.presentation
  if (typeof presentation !== 'object' || presentation === null || Array.isArray(presentation)) return undefined
  const { mode, renderer } = presentation as { mode?: unknown; renderer?: unknown }
  if (mode === 'native') {
    return Object.freeze(typeof renderer === 'string' ? { kind: 'native' as const, renderer } : { kind: 'native' as const })
  }
  if (mode === 'declarative') return Object.freeze({ kind: 'declarative' as const })
  return undefined
}

function validationOf(skill: DesignSkill): StudioBundleValidationSummary | undefined {
  const document = skill.metadata?.validationDocument as { rules?: readonly { check?: { driver?: unknown } }[] } | undefined
  if (document === undefined || !Array.isArray(document.rules)) return undefined
  const drivers = new Set<string>()
  for (const rule of document.rules) {
    if (typeof rule.check?.driver === 'string') drivers.add(rule.check.driver)
  }
  return Object.freeze({ rules: document.rules.length, drivers: Object.freeze([...drivers].sort()) })
}

/** One Bundle physically resolved inside exactly one source root. */
interface ResolvedBundle {
  readonly kitRoot?: string
  readonly bundleRoot: string
  readonly skill?: DesignSkill
}

/**
 * Read-only Bundle inspection over real Kit source files, reconciled against
 * the host's Core-compiled catalog. The injected port owns the physical
 * filesystem; this service owns resolution, path safety, identity
 * reconciliation, and the JSON-only read models.
 */
export class StudioBundleSourceService {
  readonly #catalog: StudioCatalogSnapshotPort
  readonly #source: StudioBundleSourcePort

  /**
   * @param catalog - current authoritative installed Kit snapshot provider.
   * @param source - host-supplied read-only physical source operations.
   */
  constructor(catalog: StudioCatalogSnapshotPort, source: StudioBundleSourcePort) {
    this.#catalog = catalog
    this.#source = source
  }

  /**
   * Read one Bundle's workspace: physical file tree, loader-compiled
   * manifest/schema/validation summaries, and Panel classification.
   * @param name - the Bundle id.
   * @returns the workspace, or resolution/reconciliation diagnostics.
   */
  async readBundleWorkspace(name: string, version?: string): Promise<StudioBundleWorkspaceResult> {
    const resolved = await this.#resolve(name, version)
    if ('diagnostics' in resolved) return resolved
    const { kitRoot, bundleRoot } = resolved
    let skill: DesignSkill
    let kitName: string | undefined
    let kitVersion: string | undefined
    try {
      if (resolved.skill) {
        skill = resolved.skill
      } else {
        const kit = await loadStudioKit(this.#source, kitRoot as string)
        const found = kit.skills.find((candidate) => candidate.name === name)
        if (found === undefined) {
          return Object.freeze({
            diagnostics: diagnostic('bundle.not_in_catalog', `Bundle ${JSON.stringify(name)} is not referenced by the Mindset <design_skills> catalog`, name),
          })
        }
        skill = found
        kitName = kit.name
        kitVersion = String(kit.version)
      }
    } catch (error) {
      return Object.freeze({
        diagnostics: diagnostic('kit.load', error instanceof Error ? error.message : String(error), name),
      })
    }
    const bundleVersion = String(skill.version)
    const snapshot = await this.#catalog.snapshot()
    const catalogKit = snapshot.kits.find((kit) => kit.name === kitName && kit.version === kitVersion)
    if (!resolved.skill && catalogKit === undefined) {
      return Object.freeze({
        diagnostics: diagnostic(
          'studio.source_catalog_mismatch',
          `source Kit ${JSON.stringify(kitName)}@${JSON.stringify(kitVersion)} is not present in the compiled catalog`,
          name,
        ),
      })
    }
    if (!resolved.skill && !catalogKit?.bundles.some((bundle) => bundle.name === name && bundle.version === bundleVersion)) {
      return Object.freeze({
        diagnostics: diagnostic(
          'studio.source_catalog_mismatch',
          `source Bundle ${JSON.stringify(name)}@${JSON.stringify(bundleVersion)} disagrees with the compiled catalog`,
          name,
        ),
      })
    }
    const files: StudioBundleFileRefView[] = []
    for (const path of await this.#source.listFiles(bundleRoot)) {
      let content: string | undefined
      try {
        content = await this.#source.readText(join(bundleRoot, path))
      } catch (error) {
        // The tree lists readable UTF-8 files only; binary content stays
        // invisible here and is explicitly diagnosed on a direct file read.
        if (error instanceof StudioBinaryContentError) continue
        throw error
      }
      if (content === undefined) continue
      files.push(Object.freeze({ path, bytes: utf8ByteLength(content) }))
    }
    const manifest = jsonProject(skill.metadata?.skillManifest)
    const schema = jsonProject(skill.metadata?.schemaDocument)
    const validation = validationOf(skill)
    const panel = panelOf(manifest)
    return Object.freeze({
      workspace: Object.freeze({
        name,
        version: bundleVersion,
        ...(kitName === undefined ? {} : { kit: kitName }),
        description: skill.description,
        ...(skill.pickerDescription ? { displayDescription: Object.freeze({ ...skill.pickerDescription }) } : {}),
        files: Object.freeze(files),
        ...(manifest === undefined ? {} : { manifest }),
        ...(schema === undefined ? {} : { schema }),
        ...(validation === undefined ? {} : { validation }),
        ...(panel === undefined ? {} : { panel }),
      }),
      diagnostics: Object.freeze([]),
    })
  }

  /**
   * Read one complete Bundle file byte-exactly as UTF-8 text.
   * @param input - Bundle id and Bundle-relative path.
   * @returns the file content, or resolution diagnostics.
   */
  async readBundleFile(input: { name: string; path: string; version?: string }): Promise<StudioBundleFileResult> {
    const located = await this.#locate(input.name, input.path, input.version)
    if ('diagnostics' in located) return located
    let content: string | undefined
    try {
      content = await this.#source.readText(located.absolute)
    } catch (error) {
      if (error instanceof StudioBinaryContentError) {
        return Object.freeze({
          diagnostics: diagnostic('bundle_file.binary', `Bundle ${JSON.stringify(input.name)} file ${JSON.stringify(input.path)} is not UTF-8 text`, input.path),
        })
      }
      throw error
    }
    if (content === undefined) {
      return Object.freeze({
        diagnostics: diagnostic('bundle_file.missing', `Bundle ${JSON.stringify(input.name)} has no file ${JSON.stringify(input.path)}`, input.path),
      })
    }
    return Object.freeze({
      file: Object.freeze({ path: input.path, content }),
      diagnostics: Object.freeze([]),
    })
  }

  /** Resolve one Bundle id to exactly one physical root; same-name multi-root fails loud. */
  async #resolve(name: string, version?: string): Promise<ResolvedBundle | { diagnostics: readonly StudioDiagnostic[] }> {
    if (this.#source.resolveBundleRoot) {
      const snapshot = await this.#catalog.snapshot()
      const candidates = (snapshot.bundles ?? []).filter(bundle => bundle.name === name
        && (version === undefined || bundle.version === version))
      if (candidates.length !== 1) return { diagnostics: diagnostic(
        candidates.length ? 'studio.ambiguous_version' : 'bundle.missing',
        `Select one registered exact version of Bundle ${JSON.stringify(name)}`, name) }
      const selected = candidates[0]!
      const root = await this.#source.resolveBundleRoot({ name, version: selected.version })
      if (!root) return { diagnostics: diagnostic('bundle.missing', `Missing retained source for ${name}@${selected.version}`, name) }
      if ((selected.definition.catalogName ?? selected.definition.name) !== name || String(selected.definition.version) !== selected.version) {
        return { diagnostics: diagnostic('studio.source_catalog_mismatch', 'Independent Bundle definition disagrees with its exact pin', name) }
      }
      return { bundleRoot: root, skill: selected.definition }
    }
    const matches: ResolvedBundle[] = []
    for (const kitRoot of await this.#source.listKitRoots()) {
      const root = resolve(kitRoot)
      const bundleRoot = join(root, 'skills', name)
      if (await this.#source.isDirectory(bundleRoot)) matches.push({ kitRoot: root, bundleRoot })
    }
    if (matches.length === 0) {
      return { diagnostics: diagnostic('bundle.missing', `no source Bundle named ${JSON.stringify(name)}`, name) }
    }
    if (matches.length > 1) {
      return {
        diagnostics: diagnostic(
          'studio.duplicate_source',
          `Bundle ${JSON.stringify(name)} exists in ${matches.length} configured Kit sources: ${matches.map((match) => JSON.stringify(match.bundleRoot)).join(', ')}`,
          name,
        ),
      }
    }
    const match = matches[0] as ResolvedBundle
    if (version !== undefined) {
      try {
        const kit = await loadStudioKit(this.#source, match.kitRoot as string)
        const skill = kit.skills.find(candidate => candidate.name === name)
        if (skill === undefined || String(skill.version) !== version) return { diagnostics: diagnostic(
          'bundle.version_missing', `Source does not provide Bundle ${JSON.stringify(name)}@${JSON.stringify(version)}`, version) }
        const snapshot = await this.#catalog.snapshot()
        const installed = snapshot.kits.find(candidate => candidate.name === kit.name && candidate.version === String(kit.version))
        if (!installed?.bundles.some(bundle => bundle.name === name && bundle.version === version)) return { diagnostics: diagnostic(
          'studio.source_catalog_mismatch', 'Legacy source does not match the registered exact Bundle version', name) }
      } catch (error) {
        return { diagnostics: diagnostic('kit.load', error instanceof Error ? error.message : String(error), name) }
      }
    }
    return match
  }

  /** Resolve and path-check one Bundle file target against the physical file tree. */
  async #locate(
    name: string,
    path: string,
    version?: string,
  ): Promise<{ absolute: string } | { diagnostics: readonly StudioDiagnostic[] }> {
    const resolved = await this.#resolve(name, version)
    if ('diagnostics' in resolved) return resolved
    if (safeSegments(path) === undefined) {
      return { diagnostics: diagnostic('bundle_file.path_forbidden', `path must stay inside the Bundle directory: ${JSON.stringify(path)}`, path) }
    }
    if (!(await this.#source.listFiles(resolved.bundleRoot)).includes(path)) {
      return { diagnostics: diagnostic('bundle_file.missing', `Bundle ${JSON.stringify(name)} has no regular file ${JSON.stringify(path)}`, path) }
    }
    return { absolute: join(resolved.bundleRoot, path) }
  }
}
