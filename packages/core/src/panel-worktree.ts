/** Shared live-file projection; no Host session, transport or Agent dependency. */
import { createHash } from 'node:crypto'
import type { DesignFilesStore } from './design-files.ts'
import type { DesignJournalValue } from './design-journal-payloads.ts'
import type { DesignSkill } from './types.ts'

export const WORKTREE_REVISION_PREFIX = 'worktree:'
const PANEL_WORKTREE_MAX_BUNDLES = 128
const PANEL_WORKTREE_MAX_BUNDLE_BYTES = 1024 * 1024
const PANEL_WORKTREE_MAX_TOTAL_BYTES = 64 * 1024 * 1024

interface WorktreeFileDigest {
  readonly bytes: number
  readonly sha256: string
}

export interface WorktreeProjection {
  readonly baseRevision: string
  readonly metadataFingerprint: string
  readonly revision: string
  /** Same observed worktree evidence, excluding system-derived experiences. */
  readonly evidenceRevision: string
  readonly design: Readonly<Record<string, DesignJournalValue>>
  readonly fileDigests: ReadonlyMap<string, WorktreeFileDigest>
  /** Per-file cache; a changed artifact does not require rereading every other artifact. */
  readonly fileCache?: ReadonlyMap<string, { stamp: string; digest: WorktreeFileDigest; text?: string }>
}

/** Overlay parseable canonical worktree files onto the last Published projection. */
export async function projectWorktreeDesign(
  store: Pick<DesignFilesStore, 'listWorktreeFiles' | 'readWorktreeText' | 'readWorktreeBytes'> & Partial<Pick<DesignFilesStore, 'listDisplayFiles'>>,
  published: Readonly<Record<string, DesignJournalValue>>,
  kitSkills: readonly DesignSkill[],
  baseRevision: string,
  previous?: WorktreeProjection,
): Promise<WorktreeProjection> {
  const worktreeFiles = store.listDisplayFiles
    ? await store.listDisplayFiles([...kitSkills.map(skill => skill.name), ...Object.keys(published), '_experiences'])
    : await store.listWorktreeFiles()
  const metadataHash = createHash('sha256')
  for (const file of worktreeFiles) {
    metadataHash.update(file.path).update('\0')
      .update(String(file.size)).update('\0')
      .update(String(file.mtimeMs)).update('\0')
      .update(String(file.ctimeMs)).update('\0')
      .update(String(file.ino)).update('\0')
  }
  const metadataFingerprint = metadataHash.digest('hex')
  if (previous?.baseRevision === baseRevision && previous.metadataFingerprint === metadataFingerprint) return previous
  const worktreePaths = worktreeFiles.map(file => file.path)
  const canonical = worktreePaths
    .filter((path) => {
      const parts = path.split('/')
      return parts.length === 2 && parts[0] !== '' && parts[1] === `${parts[0]}.json`
    })
    .sort()
  if (canonical.length > PANEL_WORKTREE_MAX_BUNDLES) {
    throw new Error(`design panel: worktree exceeds ${PANEL_WORKTREE_MAX_BUNDLES} Bundle states`)
  }
  const hash = createHash('sha256')
  const evidenceHash = createHash('sha256')
  const isEvidence = (path: string) => path !== '_experiences' && !path.startsWith('_experiences/')
  const design: Record<string, DesignJournalValue> = {}
  // Journal metadata describes the historical publication, not the currently
  // installed Kit. Preserve facts but always render with the pinned Kit's
  // current Panel declaration (including an explicit removal of panel.yaml).
  for (const skill of kitSkills) {
    const prior = published[skill.name]
    if (prior === undefined || !canonical.includes(`${skill.name}/${skill.name}.json`)) continue
    const panelYaml = skill.metadata?.panelYaml
    const skillManifest = skill.metadata?.skillManifest
    design[skill.name] = Object.freeze({
      state: prior.state,
      origin: prior.origin,
      ...(typeof panelYaml === 'string' ? { panelYaml } : {}),
      ...(typeof skillManifest === 'object' && skillManifest !== null && !Array.isArray(skillManifest)
        ? { skillManifest: skillManifest as Record<string, unknown> }
        : {}),
    })
  }
  const fileDigests = new Map<string, WorktreeFileDigest>()
  const fileCache = new Map<string, { stamp: string; digest: WorktreeFileDigest; text?: string }>()
  const stamps = new Map(worktreeFiles.map(file => [file.path, JSON.stringify([file.size, file.mtimeMs, file.ctimeMs, file.ino])]))
  let totalBytes = 0
  const canonicalPaths = new Set(canonical)
  for (const path of canonical) {
    const stamp = stamps.get(path)!
    const cached = previous?.fileCache?.get(path)
    const text = cached?.stamp === stamp && cached.text !== undefined ? cached.text : await store.readWorktreeText(path)
    if (text === undefined) continue
    const bytes = Buffer.byteLength(text, 'utf8')
    if (bytes > PANEL_WORKTREE_MAX_BUNDLE_BYTES) throw new Error(`design panel: state too large: ${path}`)
    totalBytes += bytes
    if (totalBytes > PANEL_WORKTREE_MAX_TOTAL_BYTES) {
      throw new Error(`design panel: worktree Bundle states exceed ${PANEL_WORKTREE_MAX_TOTAL_BYTES} bytes`)
    }
    hash.update(path).update('\0').update(text).update('\0')
    if (isEvidence(path)) evidenceHash.update(path).update('\0').update(text).update('\0')
    const digest = Object.freeze({ bytes, sha256: createHash('sha256').update(text).digest('hex') })
    fileDigests.set(path, digest)
    fileCache.set(path, { stamp, digest, text })
    try {
      const state = JSON.parse(text) as unknown
      if (typeof state !== 'object' || state === null || Array.isArray(state)) throw new Error('expected an object')
      const skill = path.slice(0, path.indexOf('/'))
      const prior = published[skill]
      const definition = kitSkills.find(entry => entry.name === skill)
      const metadata = definition?.metadata ?? design[skill]
      const panelYaml = metadata?.panelYaml
      const skillManifest = metadata?.skillManifest
      design[skill] = Object.freeze({
        state: state as Record<string, unknown>,
        origin: prior?.origin ?? 'agent',
        ...(typeof panelYaml === 'string' ? { panelYaml } : {}),
        ...(typeof skillManifest === 'object' && skillManifest !== null && !Array.isArray(skillManifest)
          ? { skillManifest: skillManifest as Record<string, unknown> }
          : {}),
      })
    } catch {
      // Let the client retain its last successful snapshot with an explicit read
      // failure. Never silently present old Published bytes as the current file.
      throw new Error(`design panel: current JSON is incomplete or invalid: ${path}`)
    }
  }
  // Artifact arrival and repair must also advance the polling identity even
  // when the Producer has not yet updated canonical JSON. This is what makes a
  // first-finished Worker artifact visible immediately. Attachment names are
  // content-addressed and immutable, so their paths suffice; ordinary design
  // artifacts include bytes so same-path repairs invalidate artifact readers.
  for (const path of worktreePaths) {
    if (canonicalPaths.has(path)) continue
    if (path.includes('/attachments/')) {
      // Never load arbitrary upload bytes into the one-second polling path.
      hash.update(path).update('\0')
      if (isEvidence(path)) evidenceHash.update(path).update('\0')
      continue
    }
    const stamp = stamps.get(path)!
    const cached = previous?.fileCache?.get(path)
    let digest = cached?.stamp === stamp ? cached.digest : undefined
    if (digest === undefined) {
      const bytes = await store.readWorktreeBytes(path)
      if (bytes === undefined) continue
      digest = Object.freeze({ bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') })
    }
    totalBytes += digest.bytes
    if (totalBytes > PANEL_WORKTREE_MAX_TOTAL_BYTES) {
      throw new Error(`design panel: worktree files exceed ${PANEL_WORKTREE_MAX_TOTAL_BYTES} bytes`)
    }
    hash.update(path).update('\0').update(String(digest.bytes)).update('\0').update(digest.sha256).update('\0')
    if (isEvidence(path)) evidenceHash.update(path).update('\0').update(String(digest.bytes)).update('\0').update(digest.sha256).update('\0')
    fileDigests.set(path, digest)
    fileCache.set(path, { stamp, digest })
  }
  return Object.freeze({
    baseRevision,
    metadataFingerprint,
    revision: `${WORKTREE_REVISION_PREFIX}${hash.digest('hex')}`,
    evidenceRevision: `${WORKTREE_REVISION_PREFIX}${evidenceHash.digest('hex')}`,
    design: Object.freeze(design),
    fileDigests,
    fileCache,
  })
}
