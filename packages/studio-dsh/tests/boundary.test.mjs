/** Static package-boundary acceptance for the DSH-only adapter. */
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('../src/', import.meta.url)
const files = (await readdir(root)).filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
const sources = await Promise.all(files.map(async name => ({ name, source: await readFile(new URL(name, root), 'utf8') })))
const source = sources.map(entry => entry.source).join('\n')
for (const forbidden of ['design-knowledge', 'ground-assertions', 'accepted-assertions', 'dsh-storage']) {
  assert.equal(source.includes(forbidden), false, `Studio DSH adapter must not import ${forbidden}`)
}
// Only the standalone choice control and the optional read-only sample
// workbench may use their narrow public Panel ports.
const selectImports = {
  'page-client.tsx': "import { PANEL_SELECT_MENU_CSS } from 'dsh-design-panel/select'",
  'page-workspace.tsx': "import { PanelSelect } from 'dsh-design-panel/select'",
}
const sampleImport = "import { PanelSamplePreview } from 'dsh-design-panel/sample-preview'"
for (const entry of sources) {
  const selectImport = selectImports[entry.name]
  const withoutSelect = selectImport ? entry.source.replace(selectImport, '') : entry.source
  const withoutSample = ['authoring-workbench.tsx', 'page-workspace.tsx'].includes(entry.name) ? withoutSelect.replace(sampleImport, '') : withoutSelect
  assert.equal(withoutSample.includes('dsh-design-panel'), false, `${entry.name} must stay within its narrow public Panel presentation port`)
  assert.doesNotMatch(entry.source, /(?:\.\.\/)+panel\//u, `${entry.name} must not bypass the public browser control API`)
}
for (const superseded of ['createKitDraft', 'updateKitDraft', 'StudioDraftStore', 'editSequence', 'draft_conflict']) {
  assert.equal(source.includes(superseded), false, `Studio DSH adapter must not use the superseded ${superseded}`)
}
// Studio 1.0 is read-only inspection: no mutation or persistence vocabulary.
for (const mutation of ['WorkingCopy', 'saveKitWorkingCopy', 'createKitWorkingCopy', 'saveBundleFile', 'checkpoint_conflict']) {
  assert.equal(source.includes(mutation), false, `read-only Studio DSH adapter must not contain ${mutation}`)
}
for (const browserFile of ['client.tsx', 'client-adapter.tsx', 'page-client.tsx', 'page-workspace.tsx', 'page-rpc.ts', 'page-path.ts', 'typert.remote-client.ts', 'authoring.remote-client.ts', 'authoring.page-rpc.ts', 'authoring-workbench.tsx']) {
  const browserSource = await readFile(new URL(`../src/${browserFile}`, root), 'utf8')
  assert.equal(browserSource.includes('node:fs'), false, `browser file ${browserFile} must not import the filesystem`)
}
const client = await readFile(new URL('../src/client-adapter.tsx', import.meta.url), 'utf8')
const clientEntry = await readFile(new URL('../src/client.tsx', import.meta.url), 'utf8')
assert.match(clientEntry, /export const inject = \['slots', 'locale'\]/u, 'the Settings launcher only needs its public Settings services')
assert.doesNotMatch(clientEntry, /registerDshStudioAuthoringLauncher|conversation\.session\.header/u, 'Studio does not add a conversation-header entry')
assert.doesNotMatch(clientEntry, /settingsScope/u, 'removed settingsScope must not block current Host client mounting')
assert.match(clientEntry, /registerDshStudioSettings\(face\)/u, 'dropping an unused hard dependency does not skip launcher registration')
assert.equal(client.includes('StudioWorkingCopyStore'), false)
assert.equal(client.includes('StudioManagementService'), false)
assert.equal(client.includes('repository'), false)
const pageClient = await readFile(new URL('../src/page-client.tsx', import.meta.url), 'utf8')
assert.equal(pageClient.includes(selectImports['page-client.tsx']), true, 'page popup CSS uses the isolated control entry')
const pageWorkspace = await readFile(new URL('../src/page-workspace.tsx', import.meta.url), 'utf8')
assert.equal(pageWorkspace.includes(selectImports['page-workspace.tsx']), true, 'the shared choice control stays on its isolated API')
for (const pageFile of ['page-client.tsx', 'page-workspace.tsx', 'page-rpc.ts']) {
  const pageSource = await readFile(new URL(`../src/${pageFile}`, import.meta.url), 'utf8')
  assert.equal(pageSource.includes('@deepseek-ai/cordis'), false, `${pageFile} must not boot a cordis context`)
  assert.equal(pageSource.includes('dsh-client-'), false, `${pageFile} must not import DSH client plugins`)
  assert.equal(pageSource.includes('__ModuleLoader__'), false, `${pageFile} must not depend on the SPA module loader`)
}
assert.equal(pageClient.includes('createSameOriginStudioRemote'), true, 'the page renders through the thin same-origin RPC transport')
for (const method of ['workspace', 'readKitWorkspace', 'readBundleWorkspace', 'readBundleFile']) {
  assert.equal(source.includes(`markRemote('${method}',`), true, `${method} must stay a marked Remote method`)
}
// The global Remote and default page retain inspection-only authority.
// Optional browser clients still cannot load the native Agent runtime.
const nativeFiles = new Set(['authoring-agent.ts', 'authoring-agent.types.ts', 'authoring-session.ts', 'authoring-session.types.ts', 'authoring-host.ts', 'authoring-host.types.ts', 'authoring-service.ts'])
const nativeTypeImports = {
  'authoring-reference-store.ts': "import type { StudioAuthoringReference } from './authoring-agent.types.ts'",
  'authoring.remote-client.ts': "import type { StudioAuthoringReference, StudioAuthoringObservation, StudioAuthoringScope } from './authoring-agent.types.ts'",
  'authoring.page-rpc.ts': "import type { StudioAuthoringReference, StudioAuthoringObservation } from './authoring-agent.types.ts'",
  'authoring-workbench.tsx': "import type { StudioAuthoringObservation, StudioAuthoringReference } from './authoring-agent.types.ts'",
}
for (const entry of sources.filter(entry => !nativeFiles.has(entry.name))) {
  assert.equal(entry.source.includes('@deepseek-ai/dsh-agent'), false, `${entry.name}: global Studio Remote must not acquire the Agent service`)
  // Only these exact type imports are erased; runtime native entry imports stay forbidden.
  const erasedImport = nativeTypeImports[entry.name]
  const runtimeSource = erasedImport ? entry.source.replace(erasedImport, '') : entry.source
  assert.doesNotMatch(runtimeSource, /(?:from\s*|import\s*\()["']\.\/authoring-agent/u, `${entry.name} must not activate the optional native entry`)
}
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
assert.equal(pkg.exports['./authoring'].default, './lib/authoring-agent.js')
assert.equal(pkg.exports['./authoring'].types, './lib/authoring-agent.d.ts')
assert.equal(pkg.exports['./authoring-session'].default, './lib/authoring-session.js')
assert.equal(pkg.exports['./authoring-session'].types, './lib/authoring-session.d.ts')
assert.equal(pkg.exports['./authoring-reference-store'].default, './lib/authoring-reference-store.js')
assert.equal(pkg.exports['./authoring-reference-store'].types, './lib/authoring-reference-store.d.ts')
assert.equal(pkg.exports['./authoring-sources'].default, './lib/authoring-sources.js')
assert.equal(pkg.exports['./authoring-sources'].types, './lib/authoring-sources.d.ts')
assert.equal(pkg.exports['./authoring-remote'].default, './lib/authoring.page-rpc.js')
assert.equal(pkg.exports['./authoring-remote'].types, './lib/authoring.page-rpc.d.ts')
assert.equal(pkg.exports['./authoring-host'].default, './lib/authoring-host.js')
assert.equal(pkg.exports['./authoring-host'].types, './lib/authoring-host.d.ts')
assert.equal(pkg.exports['./authoring-service'].default, './lib/authoring-service.js')
assert.equal(pkg.exports['./authoring-service'].types, './lib/authoring-service.d.ts')
assert.equal(pkg.exports['./authoring-workbench'].default, './lib/authoring-workbench.js')
assert.equal(pkg.exports['./authoring-workbench'].types, './lib/authoring-workbench.d.ts')
assert.equal(pkg.exports['./authoring-entry'].default, './lib/authoring-entry.js')
assert.equal(pkg.exports['./authoring-entry'].types, './lib/authoring-entry.d.ts')
const visited = new Set()
async function inspectDefaultEntry(path) {
  if (visited.has(path.href)) return
  visited.add(path.href)
  const text = await readFile(path, 'utf8')
  assert.equal(text.includes('@deepseek-ai/dsh-agent'), false, 'built default Studio entry must keep native Agent code in its optional entry')
  for (const match of text.matchAll(/(?:from\s*|import\s*\()["'](\.\.?\/[^"']+\.js)["']/gu)) {
    await inspectDefaultEntry(new URL(match[1], path))
  }
}
await inspectDefaultEntry(new URL('../lib/index.js', import.meta.url))
console.log('adapter confines Panel to public choice/sample ports and excludes Core GRA, filesystem, and browser mutation bypasses')
