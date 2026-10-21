/** Ambient typing for the core package's descriptor artifact (no shipped .d.ts). */
declare module 'dsh-design-core/remote-client' {
  /** The `designPanel` Remote contribution for `ctx.remote.$mount`. */
  const TYPERT_REMOTE: {
    package: string
    descriptors: readonly unknown[]
  }
  export default TYPERT_REMOTE
}
