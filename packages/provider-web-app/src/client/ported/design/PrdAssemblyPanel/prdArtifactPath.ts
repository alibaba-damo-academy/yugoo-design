/**
 * Artifact reference confinement for the web_app_prd_assembly panel.
 * Durable state carries only bare artifact names under the bundle's Design
 * Files directory; the server readArtifact seam already rejects path escape,
 * so this check is defense-in-depth and UI correctness: an invalid durable
 * ref must fail visibly instead of silently reading another file.
 */

/** The bundle directory that owns all PRD artifacts, Design-Files relative. */
export const PRD_ARTIFACT_DIR = 'web_app_prd_assembly'

/** The only PRD artifact kind. */
export type PrdArtifactKind = 'html'

/**
 * Validate one canonical current PRD artifact name and matching extension.
 * Case-sensitive, no separators allowed; Git stores prior revisions.
 * @param name - candidate bare file name from durable PRD state.
 * @param kind - artifact kind whose extension the name must carry.
 * @returns true when the name is a valid artifact of that kind.
 */
export function isValidPrdArtifactName(name: string, kind: PrdArtifactKind): boolean {
  return kind === 'html' && name === 'prd.html'
}

/**
 * Confine a durable artifact reference to the bundle directory. Accepts the
 * bare name or the same name already prefixed with the bundle directory and
 * returns the canonical `web_app_prd_assembly/prd.html` readArtifact path.
 * @param file - durable `html_file` value.
 * @param kind - artifact kind whose extension the reference must carry.
 * @returns the confined readArtifact path, or undefined for an invalid ref.
 */
export function confinePrdArtifactPath(file: string | undefined, kind: PrdArtifactKind): string | undefined {
  if (typeof file !== 'string' || file === '') return undefined
  const name = file.startsWith(`${PRD_ARTIFACT_DIR}/`) ? file.slice(PRD_ARTIFACT_DIR.length + 1) : file
  return isValidPrdArtifactName(name, kind) ? `${PRD_ARTIFACT_DIR}/${name}` : undefined
}
