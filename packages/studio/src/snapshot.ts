/**
 * Version-addressed Design catalog snapshot vocabulary.
 *
 * A snapshot is an immutable, derived view of the installed Kits and Bundles,
 * addressed by the explicit declared versions authored in their content
 * (parsed by the Design Core loader — the Studio never derives identity). It
 * is rebuildable and never a second catalog authority.
 */
import type { DesignKit, DesignSkill } from 'dsh-design-core'

/** One Bundle addressed by its declared version. */
export interface DesignBundleSnapshot {
  /** Bundle id, unique within its Kit. */
  readonly name: string
  /** Explicit declared Bundle version (`major.minor`). */
  readonly version: string
  /**
   * The Core-compiled, frozen in-process Bundle definition. This is a live
   * object for in-process read-back, not a persistable catalog record; it must
   * not be serialized as catalog JSON, and the Design Core loader remains the
   * authority for producing it.
   */
  readonly definition: DesignSkill
}

/** One Kit addressed by its declared version. */
export interface DesignKitSnapshot {
  /** Kit / mindset id, unique across the installation. */
  readonly name: string
  /** Explicit declared Kit version (`major.minor`). */
  readonly version: string
  /**
   * The Core-compiled, frozen in-process Kit definition. This is a live object
   * for in-process read-back, not a persistable catalog record; it must not be
   * serialized as catalog JSON (runtime pack and compiled functions included),
   * and the Design Core loader remains the authority for producing it.
   */
  readonly definition: DesignKit
  /** The Bundles this Kit exposes, in catalog order. */
  readonly bundles: readonly DesignBundleSnapshot[]
}

/** An immutable, version-addressed view of the installed Kits. */
export interface DesignCatalogSnapshot {
  /** The installed Kits, sorted by name. */
  readonly kits: readonly DesignKitSnapshot[]
  /**
   * Independent compiled Bundle versions, including versions with no Kit mounts.
   * When supplied, this is the complete Bundle catalog; Kit membership only
   * contributes reverse references. Omission supports directory-loader adapters
   * while they are migrated to independent content resolution.
   */
  readonly bundles?: readonly DesignBundleSnapshot[]
}

/** Supplies a current Core-compiled catalog snapshot to Studio read models. */
export interface StudioCatalogSnapshotPort {
  /** @returns the current immutable installed Kit snapshot. */
  snapshot(): Promise<DesignCatalogSnapshot>
}

/**
 * Project one Core-compiled Kit into its version-addressed snapshot form.
 * @param kit - compiled Kit from the host catalog authority.
 * @returns the frozen snapshot entry retaining the definition by reference.
 */
export function snapshotKit(kit: DesignKit): DesignKitSnapshot {
  return Object.freeze({
    name: kit.name,
    version: String(kit.version),
    definition: kit,
    bundles: Object.freeze(kit.skills.map((skill) => Object.freeze({
      name: skill.catalogName ?? skill.name,
      version: String(skill.version),
      definition: skill,
    }))),
  })
}
