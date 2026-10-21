/** System view file operations over the existing confined Design Files / Git seam. */
import { createHash, randomUUID } from 'node:crypto'
import { EXPERIENCE_AUTHORING_VERSION, EXPERIENCE_AUTHORING_GUIDE, EXPERIENCE_HTML_STARTER } from './experience-authoring.ts'
import type { DesignFilesStore } from './design-files.ts'
import { EXPERIENCE_ROOT, experienceId, experienceSource, experienceResource, readExperienceView } from './experience-view.ts'

const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
interface Draft { id: string; version: string; base: string | null; sources: Record<string, string>; stylesheet?: string }
export interface ExperienceRequest {
  action: 'prepare' | 'write' | 'publish'
  id: string
  version?: string
  sources?: string[]
  stylesheet?: string
  artifactId?: string
  content?: string
  offset?: number
  title?: string
  purpose?: string
  sections?: { id: string; title: string; sources: string[]; assumptions: string[] }[]
}
/** Caller holds the selected project's existing mutation lock across this operation. */
export async function operateExperience(store: DesignFilesStore, args: ExperienceRequest, signal?: AbortSignal): Promise<Record<string, unknown>> {
  signal?.throwIfAborted()
  if (!['prepare', 'write', 'publish'].includes(args.action)) throw new Error('Unknown experience action: use prepare, write or publish')
  experienceId(args.id)
  // Validate action-specific inputs before touching draft files. These fields
  // cannot be globally required because prepare/write/publish share one tool.
  if (args.action !== 'prepare') experienceId(args.version, 'version')
  if (args.action === 'write') {
    experienceId(args.artifactId, 'artifactId')
    if (typeof args.content !== 'string' || !args.content.length) throw new Error('write requires nonempty content containing the HTML chunk')
  }
  if (args.action === 'publish') {
    for (const field of ['title', 'purpose'] as const) if (typeof args[field] !== 'string' || !args[field]?.trim()) throw new Error(`publish requires nonempty ${field}`)
    if (!Array.isArray(args.sections) || !args.sections.length) throw new Error('publish requires sections; each sections[].id must match a written artifactId')
  }
  const currentPath = `${EXPERIENCE_ROOT}/${args.id}/view.json`
  if (args.action === 'prepare') {
    const sources = [...new Set([...(args.sources ?? []), ...(args.stylesheet ? [args.stylesheet] : [])])]
    if (!sources.length || sources.length > 64) throw new Error('Choose 1–64 relevant source files')
    if (args.stylesheet !== undefined && !args.stylesheet.endsWith('.css')) throw new Error('Stylesheet must be CSS')
    const versions: Record<string, string> = {}
    for (const path of sources) {
      experienceSource(path)
      const bytes = await store.readWorktreeBytes(path)
      if (!bytes?.length) throw new Error(`Missing source: ${path}`)
      versions[path] = hash(bytes)
    }
    const current = await store.readWorktreeText(currentPath)
    const draft: Draft = { id: args.id, version: randomUUID(), base: current === undefined ? null : hash(current), sources: versions,
      ...(args.stylesheet ? { stylesheet: args.stylesheet } : {}) }
    await store.writeWorktreeText(`${EXPERIENCE_ROOT}/${args.id}/${draft.version}/draft.json`, JSON.stringify(draft))
    return { id: draft.id, version: draft.version, sources,
      authoring: { version: EXPERIENCE_AUTHORING_VERSION, guide: EXPERIENCE_AUTHORING_GUIDE, htmlStarter: EXPERIENCE_HTML_STARTER },
      writeExample: { action: 'write', id: draft.id, version: draft.version, artifactId: 'overview', content: '<html><body>Replace with the evidence-based experience.</body></html>', offset: 0 },
      instructions: 'Read these sources directly. Each write requires id, returned version, artifactId (section name without .html, e.g. overview), and content. Choose a separate artifactId for each section; publish sections[].id must match its artifactId. Write bounded standalone HTML; content may be a comparison, diagram, simulation or narrative. No mandatory steps/pages. The panel supplies scene/section navigation, title, purpose, source details and a demo label. Name scenes around user situations; focus each section on what the user needs to judge, not a repeated report introduction. Split independently useful views into sections rather than one long document. If an element looks actionable, provide its source-backed local demo response or visibly identify it as a non-interactive illustration; do not invent product behavior to create interactivity. Demo interactions are temporary, reset on section changes, and must not write product facts or call host actions. Cite sources and explicitly list demo assumptions; distinguish sample data and unconfirmed behavior within the scene itself. Resource support: inline CSS/JS/SVG and data images; one selected CSS stylesheet; PNG/JPEG/WebP img src files included in sources, referenced relative to the version HTML path. CSS url/@import, external fonts/scripts, srcset and other external dependencies are NOT hydrated. Inline the needed presentation or clearly disclose the limitation; do not silently omit branding. Publish after checking fidelity and visible presentation. Current view stays unchanged until publish.' }
  }
  const prefix = `${EXPERIENCE_ROOT}/${args.id}/${args.version}`
  const draftText = await store.readWorktreeText(`${prefix}/draft.json`)
  if (!draftText) throw new Error('Prepare this view first')
  const draft = JSON.parse(draftText) as Draft
  if (draft === null || typeof draft !== 'object' || draft.id !== args.id || draft.version !== args.version
    || (draft.base !== null && (typeof draft.base !== 'string' || !/^[a-f0-9]{64}$/u.test(draft.base)))
    || draft.sources === null || typeof draft.sources !== 'object' || Array.isArray(draft.sources) || !Object.keys(draft.sources).length || Object.keys(draft.sources).length > 64) throw new Error('Invalid prepared view')
  for (const [path, digest] of Object.entries(draft.sources)) {
    experienceSource(path)
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/u.test(digest)) throw new Error('Invalid prepared source fingerprint')
  }
  if (draft.stylesheet !== undefined && (typeof draft.stylesheet !== 'string' || !draft.stylesheet.endsWith('.css') || !draft.sources[draft.stylesheet])) throw new Error('Invalid prepared stylesheet')
  if (args.action === 'write') {
    if (typeof args.content !== 'string' || Buffer.byteLength(args.content) > 32 * 1024) throw new Error('Write at most 32 KiB per chunk')
    const path = `${prefix}/${args.artifactId}.html`
    const prior = await store.readWorktreeText(path) ?? ''
    const offset = args.offset ?? 0
    if (!Number.isSafeInteger(offset) || offset < 0 || (offset !== 0 && offset !== Buffer.byteLength(prior))) throw new Error('Append offset must match the current UTF-8 byte length; 0 replaces the draft artifact')
    const next = offset === 0 ? args.content : prior + args.content
    if (Buffer.byteLength(next) > 512 * 1024) throw new Error('One view artifact must not exceed 512 KiB')
    // Published version files are immutable; edits require another prepare.
    const head = await store.head(signal)
    if (head && await store.readTextAt(head, path, signal) !== undefined) throw new Error('Published artifacts are immutable; prepare a new revision')
    await store.writeWorktreeText(path, next)
    return { path, artifactId: args.artifactId, bytes: Buffer.byteLength(next), complete: /<\/html\s*>/iu.test(next) }
  }
  if (args.action !== 'publish') throw new Error('Unknown experience operation')
  const view = readExperienceView({ id: args.id, version: args.version, title: args.title, purpose: args.purpose,
    sourceVersions: draft.sources, ...(draft.stylesheet ? { stylesheet: draft.stylesheet } : {}),
    sections: args.sections?.map(s => ({ ...s, htmlFile: `${prefix}/${s.id}.html` })) })
  const current = await store.readWorktreeText(currentPath)
  if ((current === undefined ? null : hash(current)) !== draft.base) throw new Error('The published view changed since prepare; reread before replacing it')
  const files: Record<string, string | Uint8Array> = {}
  let resourceBytes = 0
  for (const [path, digest] of Object.entries(view.sourceVersions)) {
    const bytes = await store.readWorktreeBytes(path)
    if (!bytes || hash(bytes) !== digest) throw new Error(`Source changed: ${path}; reread and revise the experience`)
    if (path === view.stylesheet || /\.(png|jpe?g|webp)$/u.test(path)) {
      resourceBytes += bytes.byteLength
      if (resourceBytes > 16 * 1024 * 1024) throw new Error('View resources exceed 16 MiB')
      files[experienceResource(view, path)] = bytes
    }
  }
  for (const section of view.sections) {
    const html = await store.readWorktreeText(section.htmlFile)
    if (!html || !/<html\b/iu.test(html) || !/<body\b/iu.test(html) || !/<\/html\s*>/iu.test(html)) throw new Error(`Incomplete HTML: ${section.htmlFile}`)
    files[section.htmlFile] = html
  }
  files[currentPath] = `${JSON.stringify(view, null, 2)}\n`
  const commit = await store.commitExperienceFiles(args.id, files, signal)
  return { published: true, id: view.id, version: view.version, commit, viewFile: currentPath,
    resourceSupport: 'Frozen selected CSS and captured PNG/JPEG/WebP img src only; inline contents are retained in HTML. External fonts, CSS url/@import, srcset and other linked dependencies are not hydrated. Verify the visible result; publication is not visual-quality certification.',
    next: 'Invite the user to open 场景体验 in the Design Panel. It is a derived view, not confirmed product facts.' }
}
