/** One exact effective content closure for every project consumer. */
import { createHash } from 'node:crypto'
import { composeDesignKitBundles, type DesignBundleContent, type DesignBundlePin } from './kit-loader.ts'
import type { DesignProjectKitPin } from './design-project.ts'
import { DesignBundleVersion, type DesignKit } from './types.ts'

/** Canonical JSON, ignoring object insertion order but preserving authored array order. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([key, item]) => [key, canonical(item)]))
  return value
}

/** Paths are installation details; all authored methods, manifests and captured resources participate. */
export function projectKitContentHash(kit: DesignKit): string {
  const { sourceRoot: _root, ...definition } = kit
  const skills = kit.skills.map(({ resourceRoot: _resourceRoot, ...skill }) => skill)
  return createHash('sha256').update(JSON.stringify(canonical({ ...definition, skills }))).digest('hex')
}

export function sameProjectContentPin(left: DesignProjectKitPin | undefined, right: DesignProjectKitPin | undefined): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

/** Only mounted catalog identities are selectable; no implicit replacement or name guessing. */
export function projectBundleOverrides(pin: DesignProjectKitPin, kit: DesignKit): readonly DesignBundlePin[] {
  if (pin.name !== kit.name || pin.version !== kit.version) throw new Error('project content: exact Kit pin is unavailable')
  const mounted = new Map(kit.skills.map(skill => [skill.catalogName ?? skill.name, skill]))
  return Object.entries(pin.bundles ?? {}).flatMap(([name, version]) => {
    if (!mounted.has(name)) throw new Error(`project content: Bundle ${JSON.stringify(name)} is not mounted by this Kit`)
    const exact = DesignBundleVersion(version)
    return mounted.get(name)!.version === exact ? [] : [{ name, version: exact }]
  })
}

/** Validate whole-Kit composition and the optional durable closure fingerprint. */
export function composeProjectKit(pin: DesignProjectKitPin, base: DesignKit, replacements: readonly DesignBundleContent[]): DesignKit {
  const expected = projectBundleOverrides(pin, base)
  if (replacements.length !== expected.length || expected.some(target => !replacements.some(bundle =>
    (bundle.skill.catalogName ?? bundle.skill.name) === target.name && bundle.skill.version === target.version))) {
    throw new Error('project content: unavailable exact Bundle override; no latest fallback is permitted')
  }
  const kit = replacements.length ? composeDesignKitBundles(base, replacements) : base
  if (pin.contentHash !== undefined && pin.contentHash !== projectKitContentHash(kit)) {
    throw new Error('project content: pinned definitions changed; restore the exact closure or explicitly migrate')
  }
  return kit
}

/** Numeric exact-version ordering, never lexicographic and never a version range. */
export function compareContentVersions(left: string, right: string): number {
  DesignBundleVersion(left); DesignBundleVersion(right)
  const a = left.split('.').map(BigInt), b = right.split('.').map(BigInt)
  return a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : a[1]! < b[1]! ? -1 : a[1]! > b[1]! ? 1 : 0
}

/** New projects choose one already validated complete Kit composition. */
export function latestInstalledKit(kits: readonly DesignKit[], name: string): DesignKit | undefined {
  return kits.filter(kit => kit.name === name).reduce<DesignKit | undefined>((latest, kit) =>
    latest === undefined || compareContentVersions(kit.version, latest.version) > 0 ? kit : latest, undefined)
}

/** One catalog card per identity; versions remain available inside its detail view. */
export function groupContentVersions<T extends { readonly name: string; readonly version: string }>(contents: readonly T[]): readonly {
  readonly name: string; readonly latest: T; readonly versions: readonly T[]
}[] {
  const groups = new Map<string, T[]>()
  for (const content of contents) {
    const versions = groups.get(content.name) ?? []
    if (versions.some(item => item.version === content.version)) throw new Error('content catalog: duplicate exact identity/version')
    versions.push(content); groups.set(content.name, versions)
  }
  return [...groups].map(([name, entries]) => {
    const versions = entries.sort((a, b) => compareContentVersions(b.version, a.version))
    return { name, latest: versions[0]!, versions: Object.freeze(versions) }
  })
}
