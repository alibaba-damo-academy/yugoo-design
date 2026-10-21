/** Host-neutral read-only Studio workspace and Kit inspection service. */
import type { DesignBundleVersionPin, StudioDiagnostic } from './types.ts'
import type { StudioCatalogSnapshotPort } from './snapshot.ts'
import { buildStudioCompositionCatalog, searchStudioBundles } from './composition.ts'

/** One browser-safe published Kit pin. */
export interface StudioKitView {
  /** Published Kit identity. */
  readonly name: string
  /** Exact declared Kit version. */
  readonly version: string
  /** Optional display copy, projected from the exact Kit definition. */
  readonly description?: string
  readonly displayDescription?: Readonly<{ zh: string; en: string }>
}

/** One browser-safe Bundle catalog entry with exact reverse dependencies. */
export interface StudioBundleView extends DesignBundleVersionPin {
  readonly title?: Readonly<{ zh: string; en: string }>
  readonly displayDescription?: Readonly<{ zh: string; en: string }>
  /** Human routing description. */
  readonly description: string
  /** Exact published Kit versions selecting this Bundle version. */
  readonly usedBy: readonly StudioKitView[]
}

/** Complete JSON-only view model for the Studio management surface. */
export interface StudioWorkspaceView {
  /** Trimmed catalog query applied to {@link bundles}. */
  readonly query: string
  /** Published Kit version pins. */
  readonly kits: readonly StudioKitView[]
  /** Flat Bundle version results, including reverse Kit dependencies. */
  readonly bundles: readonly StudioBundleView[]
}

/** Structured management failure safe to serialize through any host transport. */
export interface StudioManagementFailure {
  /** Stable failure category rendered by shared Studio clients. */
  readonly code: 'request_failed'
  /** User-facing diagnostic. */
  readonly message: string
}

/** One read-only Bundle mount with exact reverse Kit references. */
export interface StudioBundleMountView {
  readonly title?: Readonly<{ zh: string; en: string }>
  readonly displayDescription?: Readonly<{ zh: string; en: string }>
  /** Mounted Bundle name. */
  readonly name: string
  /** Exact mounted Bundle version. */
  readonly version: string
  /** One-line Bundle description. */
  readonly description: string
  /** Every installed Kit version mounting this exact Bundle version. */
  readonly mountedBy: readonly StudioKitView[]
}

/** One Core-loader-compiled auxiliary resource of a Kit version, by exact path. */
export interface StudioResourceRefView {
  /** Exact compiled resource path (loader authority; never guessed). */
  readonly path: string
  /** UTF-8 byte length of the compiled resource content. */
  readonly bytes: number
}

/** One validated Kit relation extension exposed for initial Studio inspection. */
export interface StudioRelationView {
  readonly type: string
  readonly meaning: string
  readonly direction: 'forward' | 'symmetric'
  readonly label: { readonly zh: string; readonly en: string }
  readonly description: { readonly zh: string; readonly en: string }
  readonly domain?: readonly string[]
  readonly range?: readonly string[]
  readonly inverse?: string
  readonly cardinality?: Readonly<{ from: 'one' | 'many'; to: 'one' | 'many' }>
  readonly reasoning?: Readonly<{ impact?: boolean; causal?: boolean; transitive?: boolean }>
  readonly evidence?: Readonly<{ minimum: 'explicit' | 'inferred' }>
}

/** Exact version-pinned relation extension summary compiled by Design Core. */
export interface StudioRelationVocabularyView {
  readonly schemaVersion: 1
  readonly pin: string
  readonly relations: readonly StudioRelationView[]
}

/** Read-only installed-Kit workspace: exact source plus catalog facts. */
export interface StudioKitWorkspaceView {
  /** Kit identity. */
  readonly name: string
  /** Exact installed Kit version. */
  readonly version: string
  /** Human description from the mindset frontmatter; empty when absent. */
  readonly description: string
  readonly displayDescription?: Readonly<{ zh: string; en: string }>
  /** Complete raw mindset.md source, including frontmatter, byte-identical to the installation. */
  readonly mindsetSource: string
  /** Mounted Bundles in catalog order with reverse Kit references. */
  readonly mounts: readonly StudioBundleMountView[]
  /** Loader-compiled auxiliary resources, sorted by path. */
  readonly resources: readonly StudioResourceRefView[]
  /** Optional extension entry. Editing remains disabled until Studio gains versioned drafts. */
  readonly relationVocabulary: StudioRelationVocabularyView
}

/** Read result for one installed Kit workspace: a view or actionable diagnostics. */
export interface StudioKitWorkspaceResult {
  /** Frozen workspace view; present exactly when diagnostics are empty. */
  readonly workspace?: StudioKitWorkspaceView
  /** Frozen resolution diagnostics. */
  readonly diagnostics: readonly StudioDiagnostic[]
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/**
 * JSON-facing read-only Kit catalog and workspace inspection over the
 * authoritative Core-compiled catalog. The Studio never mutates installed
 * content: source files and the Design Core loader remain the only authorities.
 */
export class StudioManagementService {
  readonly #catalog: StudioCatalogSnapshotPort

  /** @param catalog - current authoritative installed Kit snapshot provider. */
  constructor(catalog: StudioCatalogSnapshotPort) {
    this.#catalog = catalog
  }

  /**
   * Build a detached, frozen, JSON-only browser view.
   * @param query - optional Bundle name/description search.
   * @returns current published Kit pins and the searched Bundle catalog.
   */
  async workspace(query = ''): Promise<StudioWorkspaceView> {
    const snapshot = await this.#catalog.snapshot()
    const composition = buildStudioCompositionCatalog(snapshot)
    const normalizedQuery = query.trim()
    const kits = Object.freeze(composition.kits.map((kit) => {
      const definition = snapshot.kits.find(entry => entry.name === kit.name && entry.version === kit.version)!.definition
      return Object.freeze({ name: kit.name, version: kit.version,
        ...(definition.description === undefined ? {} : { description: definition.description }),
        ...(definition.pickerDescription ? { displayDescription: Object.freeze({ ...definition.pickerDescription }) } : {}),
      })
    }))
    const bundles = Object.freeze(searchStudioBundles(composition, normalizedQuery).map((bundle) => Object.freeze({
      name: bundle.name,
      version: bundle.version,
      description: bundle.definition.description,
      ...(bundle.definition.title ? { title: Object.freeze({ ...bundle.definition.title }) } : {}),
      ...(bundle.definition.pickerDescription ? { displayDescription: Object.freeze({ ...bundle.definition.pickerDescription }) } : {}),
      usedBy: Object.freeze(bundle.usedBy.map((kit) => Object.freeze({ name: kit.name, version: kit.version }))),
    })))
    return Object.freeze({ query: normalizedQuery, kits, bundles })
  }

  /**
   * Read the Kit workspace view model for one exact installed Kit version.
   *
   * The view is JSON-only: the complete raw mindset.md source is exposed for
   * reading, mounts carry exact version pins plus their reverse Kit
   * references, and resources project only the paths the Core loader compiled
   * into the version. No Core-compiled definition object crosses into the view.
   * @param name - the Kit id.
   * @param version - exact installed Kit version.
   * @returns the frozen workspace view, or resolution diagnostics.
   */
  async readKitWorkspace(name: string, version: string): Promise<StudioKitWorkspaceResult> {
    const snapshot = await this.#catalog.snapshot()
    const entry = snapshot.kits.find((kit) => kit.name === name && kit.version === version)
    if (entry === undefined) {
      const installed = snapshot.kits.filter((kit) => kit.name === name).map((kit) => kit.version)
      if (installed.length === 0) {
        return Object.freeze({
          diagnostics: Object.freeze([Object.freeze({
            code: 'workspace.kit_missing',
            message: `Kit ${JSON.stringify(name)} is not installed`,
            subject: name,
          })]),
        })
      }
      return Object.freeze({
        diagnostics: Object.freeze([Object.freeze({
          code: 'workspace.version_missing',
          message: `Kit ${JSON.stringify(name)} version ${JSON.stringify(version)} is not installed; the installed versions are ${installed.map((candidate) => JSON.stringify(candidate)).join(', ')}`,
          subject: version,
        })]),
      })
    }
    const definition = entry.definition
    const mounts = Object.freeze(entry.bundles.map((bundle) => Object.freeze({
      name: bundle.name,
      version: bundle.version,
      description: bundle.definition.description,
      ...(bundle.definition.title ? { title: Object.freeze({ ...bundle.definition.title }) } : {}),
      ...(bundle.definition.pickerDescription ? { displayDescription: Object.freeze({ ...bundle.definition.pickerDescription }) } : {}),
      // Reverse references only: every installed Kit version mounting this
      // exact Bundle version. A mount never implies Bundle ownership.
      mountedBy: Object.freeze(snapshot.kits
        .filter((kit) => kit.bundles.some(
          (candidate) => candidate.name === bundle.name && candidate.version === bundle.version,
        ))
        .map((kit) => Object.freeze({ name: kit.name, version: kit.version }))),
    })))
    const resources = Object.freeze(Object.entries(definition.resources)
      .map(([path, content]) => Object.freeze({ path, bytes: utf8ByteLength(content) }))
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)))
    return Object.freeze({
      workspace: Object.freeze({
        name: entry.name,
        version: entry.version,
        description: definition.description ?? '',
        ...(definition.pickerDescription ? { displayDescription: Object.freeze({ ...definition.pickerDescription }) } : {}),
        mindsetSource: definition.mindsetSource,
        mounts,
        resources,
        relationVocabulary: Object.freeze({
          schemaVersion: 1,
          pin: definition.relationVocabulary?.revision ?? 'legacy-unavailable',
          relations: Object.freeze((definition.relationVocabulary?.relations ?? []).map((relation) => Object.freeze({
            type: relation.type, meaning: relation.meaning, direction: relation.direction,
            label: Object.freeze({ ...relation.label }), description: Object.freeze({ ...relation.description }),
            ...(relation.domain ? { domain: Object.freeze([...relation.domain]) } : {}),
            ...(relation.range ? { range: Object.freeze([...relation.range]) } : {}),
            ...(relation.inverse ? { inverse: relation.inverse } : {}),
            ...(relation.cardinality ? { cardinality: Object.freeze({ ...relation.cardinality }) } : {}),
            ...(relation.reasoning ? { reasoning: Object.freeze({ ...relation.reasoning }) } : {}),
            ...(relation.evidence ? { evidence: Object.freeze({ ...relation.evidence }) } : {}),
          }))),
        }),
      }),
      diagnostics: Object.freeze([]),
    })
  }
}
