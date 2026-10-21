/** Shared security policy for untrusted Design File and derived-view HTML previews. */

/** Preview execution modes supported by the native Web App panels. */
export type DesignSrcDocMode = 'interactive-preview' | 'static-document'

const BASE_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "object-src 'none'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data:",
  "style-src 'unsafe-inline'",
]

/**
 * Bootstrap a trusted head before parsing any untrusted preview markup.
 *
 * Scope (honest): the meta CSP confines subresources, connections, and forms
 * (default/connect/form/object `none`; img/media/font data/blob only).
 * It does NOT restrict the document's own navigation — that confinement
 * depends on the embedding iframe's sandbox (no allow-top-navigation /
 * allow-popups) and needs real-browser tests to prove. In
 * `interactive-preview` mode `script-src 'unsafe-inline'` allows the
 * artifact's OWN inline scripts to run (prototype interactivity); only
 * host-authored markup is trusted in the head.
 * @param html - untrusted artifact HTML or an HTML fragment.
 * @param mode - whether artifact inline scripts are allowed.
 * @param trustedHeadMarkup - host-authored style/script markup, never artifact content.
 * @returns a complete srcDoc document with the restrictive meta CSP prepended to its head.
 */
export function secureDesignSrcDoc(
  html: string,
  mode: DesignSrcDocMode,
  trustedHeadMarkup = '',
): string {
  const modePolicy = mode === 'interactive-preview'
    ? ["frame-src 'none'", "script-src 'unsafe-inline'"]
    // PRD is the only static-document caller. Its validator permits nested
    // frames only as sandbox="" srcdoc projections of landed owner HTML.
    : ["frame-src 'self'", "script-src 'none'"]
  const policy = [...BASE_POLICY, ...modePolicy].join('; ')
  const head = `<meta http-equiv="Content-Security-Policy" content="${policy}">${trustedHeadMarkup}`
  // Never locate an untrusted <head> with a regular expression: comments,
  // quoted attributes and raw-text elements can contain fake opening tags.
  // The browser parses this head before the artifact. Subsequent document
  // wrappers are handled by HTML's normal duplicate-wrapper rules; artifact
  // title/style/body content is retained, but cannot precede the host CSP.
  return `<!doctype html><html><head>${head}</head>${html}</html>`
}
