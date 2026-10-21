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
// The standalone browser page may inject only this shared choice control and
// its own popup CSS. Server, launcher and transport still cannot import Panel.
const selectImport = "import { PanelSelect, PANEL_SELECT_MENU_CSS } from 'dsh-design-panel/select'"
for (const entry of sources) {
  const withoutSelect = entry.name === 'page-client.tsx' ? entry.source.replace(selectImport, '') : entry.source
  assert.equal(withoutSelect.includes('dsh-design-panel'), false, `${entry.name} must not import Panel beyond the standalone choice-control port`)
  assert.doesNotMatch(entry.source, /(?:\.\.\/)+panel\//u, `${entry.name} must not bypass the public browser control API`)
}
for (const superseded of ['createKitDraft', 'updateKitDraft', 'StudioDraftStore', 'editSequence', 'draft_conflict']) {
  assert.equal(source.includes(superseded), false, `Studio DSH adapter must not use the superseded ${superseded}`)
}
// Studio 1.0 is read-only inspection: no mutation or persistence vocabulary.
for (const mutation of ['WorkingCopy', 'saveKitWorkingCopy', 'createKitWorkingCopy', 'saveBundleFile', 'checkpoint_conflict']) {
  assert.equal(source.includes(mutation), false, `read-only Studio DSH adapter must not contain ${mutation}`)
}
for (const browserFile of ['client.tsx', 'client-adapter.tsx', 'page-client.tsx', 'page-rpc.ts', 'page-path.ts', 'typert.remote-client.ts']) {
  const browserSource = await readFile(new URL(`../src/${browserFile}`, root), 'utf8')
  assert.equal(browserSource.includes('node:fs'), false, `browser file ${browserFile} must not import the filesystem`)
}
const client = await readFile(new URL('../src/client-adapter.tsx', import.meta.url), 'utf8')
const clientEntry = await readFile(new URL('../src/client.tsx', import.meta.url), 'utf8')
assert.match(clientEntry, /export const inject = \['slots', 'locale'\]/u, 'the launcher requires only services it actually consumes')
assert.doesNotMatch(clientEntry, /settingsScope/u, 'removed settingsScope must not block current Host client mounting')
assert.match(clientEntry, /registerDshStudioSettings\(face\)/u, 'dropping an unused hard dependency does not skip launcher registration')
assert.equal(client.includes('StudioWorkingCopyStore'), false)
assert.equal(client.includes('StudioManagementService'), false)
assert.equal(client.includes('repository'), false)
const pageClient = await readFile(new URL('../src/page-client.tsx', import.meta.url), 'utf8')
assert.equal(pageClient.includes(selectImport), true, 'the page must use the isolated control entry, not the broad provider API')
for (const pageFile of ['page-client.tsx', 'page-rpc.ts']) {
  const pageSource = await readFile(new URL(`../src/${pageFile}`, import.meta.url), 'utf8')
  assert.equal(pageSource.includes('@deepseek-ai/cordis'), false, `${pageFile} must not boot a cordis context`)
  assert.equal(pageSource.includes('dsh-client-'), false, `${pageFile} must not import DSH client plugins`)
  assert.equal(pageSource.includes('__ModuleLoader__'), false, `${pageFile} must not depend on the SPA module loader`)
}
assert.equal(pageClient.includes('createSameOriginStudioRemote'), true, 'the page renders through the thin same-origin RPC transport')
for (const method of ['workspace', 'readKitWorkspace', 'readBundleWorkspace', 'readBundleFile']) {
  assert.equal(source.includes(`markRemote('${method}',`), true, `${method} must stay a marked Remote method`)
}
assert.equal(source.includes('@deepseek-ai/dsh-agent'), false, 'global Studio Remote must not acquire the Agent service')
console.log('adapter boundary confines Panel to the standalone choice-control port and excludes Core GRA, filesystem, and browser mutation bypasses')
