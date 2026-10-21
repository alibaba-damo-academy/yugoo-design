/** Flat Bundle discovery over a catalog snapshot. */
import type { DesignSkill } from 'dsh-design-core'
import type { DesignBundleSnapshot, DesignCatalogSnapshot } from './snapshot.ts'
import type { DesignBundleVersionPin, DesignKitVersionPin } from './types.ts'

/** One immutable Bundle version with exact reverse Kit dependencies. */
export interface StudioBundleVersionEntry extends DesignBundleVersionPin {
  /** Core-compiled definition retained by reference; source is never copied. */
  readonly definition: DesignSkill
  /** Exact published Kit versions that select this Bundle version. */
  readonly usedBy: readonly DesignKitVersionPin[]
}

/** Frozen flat Bundle catalog plus the published Kit versions it derives from. */
export interface StudioCompositionCatalog {
  /** Bundle versions sorted by name then version. */
  readonly bundles: readonly StudioBundleVersionEntry[]
  /** Published Kit version pins sorted by name then version. */
  readonly kits: readonly DesignKitVersionPin[]
}

function pinKey(name: string, version: string): string {
  return `${name}\u0000${version}`
}

function comparePins(left: DesignKitVersionPin | DesignBundleVersionPin, right: DesignKitVersionPin | DesignBundleVersionPin): number {
  if (left.name !== right.name) return left.name < right.name ? -1 : 1
  if (left.version === right.version) return 0
  return left.version < right.version ? -1 : 1
}

/**
 * Derive the flat searchable Bundle catalog and reverse dependencies.
 * @param snapshot - authoritative Core-compiled installed catalog snapshot.
 * @returns a frozen derived catalog; identical Bundle pins are coalesced.
 */
export function buildStudioCompositionCatalog(snapshot: DesignCatalogSnapshot): StudioCompositionCatalog {
  const entries = new Map<string, { bundle: DesignBundleSnapshot; usedBy: DesignKitVersionPin[] }>()
  const kits: DesignKitVersionPin[] = []
  for (const bundle of snapshot.bundles ?? []) {
    const key = pinKey(bundle.name, bundle.version)
    if (entries.has(key)) throw new Error(`studio.duplicate_bundle: ${bundle.name}@${bundle.version}`)
    entries.set(key, { bundle, usedBy: [] })
  }
  for (const kit of snapshot.kits) {
    const kitPin = Object.freeze({ name: kit.name, version: kit.version })
    kits.push(kitPin)
    for (const bundle of kit.bundles) {
      const key = pinKey(bundle.name, bundle.version)
      const current = entries.get(key)
      if (current === undefined && snapshot.bundles !== undefined) {
        throw new Error(`studio.missing_bundle: ${kit.name}@${kit.version} references ${bundle.name}@${bundle.version}`)
      }
      if (current === undefined) entries.set(key, { bundle, usedBy: [kitPin] })
      else current.usedBy.push(kitPin)
    }
  }
  const bundles = [...entries.values()].map(({ bundle, usedBy }) => Object.freeze({
    name: bundle.name,
    version: bundle.version,
    definition: bundle.definition,
    usedBy: Object.freeze([...usedBy].sort(comparePins)),
  })).sort(comparePins)
  return Object.freeze({ bundles: Object.freeze(bundles), kits: Object.freeze(kits.sort(comparePins)) })
}

/**
 * Search Bundle name and description in deterministic catalog order.
 * @param catalog - derived flat catalog.
 * @param query - case-insensitive trimmed text; empty returns the full catalog.
 * @returns matching immutable catalog entries.
 */
export function searchStudioBundles(catalog: StudioCompositionCatalog, query: string): readonly StudioBundleVersionEntry[] {
  const normalized = query.trim().toLowerCase()
  if (normalized === '') return catalog.bundles
  return Object.freeze(catalog.bundles.filter((entry) => (
    entry.name.toLowerCase().includes(normalized)
    || entry.definition.description.toLowerCase().includes(normalized)
    || Object.values(entry.definition.title ?? {}).some(text => text.toLowerCase().includes(normalized))
    || Object.values(entry.definition.pickerDescription ?? {}).some(text => text.toLowerCase().includes(normalized))
  )))
}
