/** Isolated browser → production Remote methods → real Git/files probe.
 * Host selection/journal are fixtures, not a running DSH installation. */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { openRetainedFixtureRoot } from './retained-fixture-root.mjs'
const { register } = await import('tsx/esm/api'); register()
const { DesignPanelRemote } = await import('../../core/src/panel-remote.ts')
const { DesignFilesStore } = await import('../../core/src/design-files.ts')
const { GitVersioning } = await import('../../core/src/git.ts')
const { nodeFs } = await import('../../core/src/service-tools.ts')
const { publishAutoPanelCache } = await import('../../core/src/auto-panel-cache.ts')
const { resolveAutoPanel } = await import('../../core/src/auto-panel-resolution.ts')
const { parseSchemaYaml, validatorFromSchemaYaml } = await import('../../core/src/schema.ts')
const { loadSavedAutoPanel } = await import('../../core/src/saved-auto-panel-store.ts')
const { basicGenericManifest } = await import('../../core/src/auto-panel-generation.ts')
const { questionSchemaYaml: schemaYaml, questionState: initial, questionContext } = await import('../../core/test/fixtures/declarative-question.mjs')
const output = process.env.AUTO_BROWSER_OUT
if (!output) throw new Error('AUTO_BROWSER_OUT required')
const owned = await openRetainedFixtureRoot({ directory: process.env.RETAINED_BROWSER_ROOT,
  token: process.env.RETAINED_BROWSER_OWNER_TOKEN, identity: {
    kit: questionContext.kit, kitVersion: questionContext.kitVersion, bundle: questionContext.bundle, bundleVersion: questionContext.bundleVersion,
    schemaDigest: createHash('sha256').update(schemaYaml).digest('hex') } })
const { root } = owned
const exec = promisify(execFile)
const git = new GitVersioning(async ({ argv, cwd, env, signal }) => {
  try { return { exitCode: 0, ...await exec(argv[0], argv.slice(1), { cwd, signal, env: { ...process.env, ...env,
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@localhost', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@localhost' } }) } }
  catch (error) { return { exitCode: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' } }
}, root, 'design_files')
if (!owned.reopened) await git.ensureRepo()
const store = new DesignFilesStore(nodeFs, git, join(root, 'design_files'))
if (!owned.reopened) await store.write(questionContext.bundle, initial, { origin: 'agent', settleEvent: async () => {} })
else {
  const current = await store.readPublished(questionContext.bundle)
  if (current === undefined) throw new Error('Reopened fixture has no published design data')
  const validation = validatorFromSchemaYaml(schemaYaml)(current)
  if (!validation.ok) throw new Error('Reopened fixture schema failed: ' + validation.error)
}
const project = { projectId: 'retained-browser', root, stateRoot: join(root, '.host-cache') }
const skill = { name: questionContext.bundle, version: questionContext.bundleVersion, execution: { handoff: 'can_edit' }, metadata: {
  skillManifest: { presentation: { mode: 'auto' } }, schemaYaml } }
const kit = { name: questionContext.kit, version: questionContext.kitVersion, skills: [skill] }
const context = async () => ({ kit: kit.name, kitVersion: kit.version, bundle: skill.name, bundleVersion: skill.version,
  schema: parseSchemaYaml(schemaYaml), state: await store.readPublished(skill.name) })
const initialContext = await context()
const saved = await loadSavedAutoPanel(root, initialContext)
if (saved.status === 'incompatible') throw new Error('Reopened fixture has incompatible saved panel')
if (saved.status !== 'ready') await publishAutoPanelCache(project.stateRoot, initialContext, [
  { version: 'v0.9', createSurface: { surfaceId: 'auto-panel', catalogId: 'urn:dsh:panel-catalog:design-files:v1', sendDataModel: false } },
  { version: 'v0.9', updateComponents: { surfaceId: 'auto-panel', components: [{ id: 'root', component: 'DesignPanel', manifest: basicGenericManifest(initialContext) }] } },
])
const roots = { definitionRoot: root, cacheRoot: project.stateRoot }
const remote = Object.create(DesignPanelRemote.prototype)
const agent = { id: 'browser-agent', inject() {} }
let tail = Promise.resolve(), revision = 0
remote.design = {
  projectForAgent: async () => project, requireKitForAgent: () => kit, designFilesForProject: async () => store,
  withProjectMutationFor: (_agent, _project, operation) => { const next = tail.then(operation); tail = next.catch(() => {}); return next },
  assertProjectSelection() {}, readDesignJournal: async () => ({ revision, records: [] }),
  recordDesignChange: async () => ++revision,
}
remote.readWorkspace = async () => ({ projectId: project.projectId, worktreeRevision: await store.head(),
  access: { mode: 'writable' }, design: { [skill.name]: { state: await store.readPublished(skill.name) } } })
const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><html><meta charset="utf-8"><div id="root"></div><script type="module" src="/auto-browser.js"></script></html>'); return
    }
    if (request.method === 'GET' && /^\/[a-zA-Z0-9_.-]+\.js$/.test(request.url)) {
      response.writeHead(200, { 'content-type': 'text/javascript' }).end(await readFile(join(output, request.url.slice(1)))); return
    }
    let result
    if (request.method === 'GET' && request.url === '/fixture') {
      const current = await context(), panel = await resolveAutoPanel(roots, current)
      if (panel.status !== 'ready') throw new Error(panel.reason)
      result = { ...panel, state: current.state, sourceRevision: await store.head(), projectId: project.projectId, skill: skill.name }
    } else if (request.method === 'POST' && ['/retain', '/save'].includes(request.url)) {
      let body = ''
      for await (const bytes of request) { body += bytes; if (body.length > 128000) throw new Error('payload too large') }
      const input = JSON.parse(body), signal = new AbortController().signal
      result = request.url === '/retain'
        ? await remote.retainAutoPanel(agent, input, signal)
        : await remote.savePanel(agent, skill.name, input.after, { autoBefore: input.before, definitionRevision: input.definitionRevision }, input.eventId, signal)
    } else { response.writeHead(404).end(); return }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result))
  } catch (error) { response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(error.message ?? error) })) }
})
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`,
  root, ownerToken: owned.token, reopened: owned.reopened, generationCacheSeeded: saved.status !== 'ready' })))
// The owning bounded runner must retain this root for save/reopen and failure inspection.
// Stopping a fixture must not erase the Git/file evidence it just produced.
const stop = () => server.close(error => {
  console.log(JSON.stringify({ stopped: true, root, retainedEvidence: true, error: error ? String(error) : undefined }))
  if (error) process.exitCode = 1
})
process.once('SIGINT', stop); process.once('SIGTERM', stop)
