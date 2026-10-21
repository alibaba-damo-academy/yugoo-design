import type { KitResourceContent } from 'dsh-design-core'

/**
 * Host-neutral Design Studio ports and read-model vocabulary.
 *
 * The Studio is a pure domain library: every filesystem operation goes through
 * an injected port so each Agent Host adapter (DSH, Codex, Claude Code, SDK
 * Pilot) supplies its own native file operations. Nothing here imports an
 * Agent Host runtime, Cordis, or `node:fs`. Installed content remains read-only;
 * editable drafts use separate injected snapshot and persistence ports.
 */

/**
 * Read-only filesystem surface the Studio needs to enumerate and validate
 * Kits. Structurally compatible with the Design Core `KitFsLike` loader port.
 */
export interface StudioReadFs {
  /** Read one UTF-8 text file; `undefined` when absent. */
  readText(path: string): Promise<string | undefined>
  /** Optional attached-resource text/opaque projection; never used for definition slots. */
  readResource?(path: string): Promise<KitResourceContent | undefined>
  /** List one directory's entry names. */
  listDir(path: string): Promise<string[]>
  /** Whether a path is a directory; adapters without it fall back to read probes. */
  isDirectory?(path: string): Promise<boolean>
  /** Resolve symlinks for confinement checks. */
  realPath?(path: string): Promise<string>
}

/** One explicit Studio diagnostic (a stable code plus a locatable message). */
export interface StudioDiagnostic {
  /** Stable diagnostic code, e.g. `kit.load`. */
  readonly code: string
  /** Human-readable, locatable message. */
  readonly message: string
  /** The Kit or Bundle the diagnostic is about, when known. */
  readonly subject?: string
  /** Omitted means error, preserving existing error-only consumers. */
  readonly severity?: 'warning'
}

/** The outcome of validating one Kit or Bundle definition. */
export interface StudioValidationReport {
  /** True when the definition loads without errors; warnings do not block use. */
  readonly valid: boolean
  /** Definition errors or non-blocking authoring warnings. */
  readonly diagnostics: readonly StudioDiagnostic[]
}

/** Exact identity of one published Kit version. */
export interface DesignKitVersionPin {
  /** Published Kit name. */
  readonly name: string
  /** Exact declared Kit version (`major.minor`). */
  readonly version: string
}

/** Exact identity of one published Bundle version. */
export interface DesignBundleVersionPin {
  /** Published Bundle name. */
  readonly name: string
  /** Explicit declared Bundle version (`major.minor`). */
  readonly version: string
}

/**
 * Thrown by a Bundle source port when a file exists but is not decodable
 * UTF-8 text. The Studio surfaces binary content as an explicit diagnostic
 * instead of lossy-decoding it into a text viewer.
 */
export class StudioBinaryContentError extends Error {
  /** The path whose content is not UTF-8 text. */
  readonly path: string

  /** @param path - absolute path of the non-text file. */
  constructor(path: string) {
    super(`design studio: ${JSON.stringify(path)} is not UTF-8 text`)
    this.name = 'StudioBinaryContentError'
    this.path = path
  }
}
