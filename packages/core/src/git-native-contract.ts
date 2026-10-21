/** Structured operations for the existing managed Git worker; never argv emulation. */
export interface NativeGitFile {
  readonly path: string
  readonly source?: string
  readonly oid?: string
  readonly mode: number
}

/** Fresh repository facts, resolved by the same native executor as publication. */
export interface NativeGitInspection {
  readonly format: 'sha1' | 'sha256'
  readonly head?: string
  readonly gitDir: string
  readonly workdir: string
  readonly indexPath: string
}

export type NativeGitOperation =
  | { readonly kind: 'inspect' }
  | { readonly kind: 'init' }
  | { readonly kind: 'head' }
  | { readonly kind: 'ancestor'; readonly ancestor: string; readonly descendant: string }
  | { readonly kind: 'status'; readonly pathPrefix?: string }
  | { readonly kind: 'entry'; readonly commit: string; readonly path: string }
  | { readonly kind: 'tree'; readonly commit: string; readonly pathPrefix?: string; readonly maxBytes?: number }
  | { readonly kind: 'blob'; readonly oid: string; readonly size: number }
  | { readonly kind: 'blob-header'; readonly oid: string }
  | { readonly kind: 'message'; readonly commit: string }
  | { readonly kind: 'latest-marker'; readonly from: string; readonly marker: string }
  | { readonly kind: 'history'; readonly limit: number; readonly pathPrefix?: string; readonly path?: string;
      readonly from?: string; readonly offset?: number }
  | { readonly kind: 'diff-commit'; readonly commit: string; readonly pathPrefix?: string }
  | { readonly kind: 'diff-between'; readonly from: string; readonly to: string; readonly pathPrefix?: string; readonly path?: string }
  | { readonly kind: 'diff-since'; readonly baseline?: string; readonly pathPrefix?: string }
  | { readonly kind: 'index-read'; readonly bytes?: string | null; readonly paths: readonly string[] }
  | { readonly kind: 'index-update'; readonly bytes?: string; readonly updates: readonly { readonly path: string; readonly oid?: string; readonly mode?: number }[] }
  | { readonly kind: 'publish'; readonly expectedHead?: string; readonly message: string;
      readonly stagingRoot: string; readonly files: readonly NativeGitFile[]; readonly forceCommit?: boolean }

export interface NativeGitResult {
  readonly value: unknown
  readonly bytes?: Uint8Array
  /** Parent-owned post-publication guard failed; never supplied by the worker. */
  readonly publicationScopeInvalidated?: true
}
export type NativeGitFailure = 'invalid-request' | 'unsupported-object-format' | 'unsupported-history' | 'commit-not-found'
  | 'stale-publication' | 'native-unavailable' | 'native-operation-failed'

export class NativeGitError extends Error {
  constructor(readonly code: NativeGitFailure) { super(`design git native: ${code}`) }
}
