/** Static package-boundary acceptance for host-neutral Studio UI code. */
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as surface from '../lib/index.js'

const sourceRoot = new URL('../src/', import.meta.url)
const files = (await readdir(sourceRoot)).filter((name) => /\.(?:ts|tsx)$/u.test(name))
const source = (await Promise.all(files.map((name) => readFile(join(sourceRoot.pathname, name), 'utf8')))).join('\n')
for (const forbidden of [
  '@deepseek-ai/',
  'dsh-design-core',
  'node:fs',
  'node:path',
  'StudioWorkingCopyRepository',
  'createKitDraft',
  'updateKitDraft',
  'publishKitDraft',
  // Preview compilation grants no catalog or installed-content mutation API.
  'WorkingCopy',
  'saveKitWorkingCopy',
  'saveBundleFile',
  'setMindsetSource',
  'createWorkingCopy',
]) {
  assert.equal(source.includes(forbidden), false, `shared UI source must not contain ${forbidden}`)
}
// The installed-content viewer remains read-only. The separate, newly
// authorized preview editor legitimately has revisions; do not ban that word
// package-wide or confuse its compile result with publication authority.
const viewerSource = (await Promise.all(['controller.ts', 'StudioWorkspace.tsx', 'types.ts'].map(name => readFile(join(sourceRoot.pathname, name), 'utf8')))).join('\n')
for (const banned of ['createDraft', 'saveDraft', 'publishDraft', 'preparePreview']) {
  assert.equal(viewerSource.includes(banned), false, `installed viewer must not gain an implicit authoring action: ${banned}`)
}
assert.deepEqual(Object.keys(surface).sort(), [
  'CONVERSATION_ACTIVITY_CSS',
  'ConversationActivity',
  'ConversationMessage',
  'ConversationMessages',
  'InstanceWorkbench',
  'STUDIO_WORKSPACE_CSS',
  'StudioEmptyState',
  'StudioErrorDialog',
  'StudioFeedback',
  'StudioTrialController',
  'StudioWorkspace',
  'StudioWorkspaceController',
  'assertStudioImportRequestSize',
  'checkStudioTrialConnection',
  'localTrialUrl',
  'trialActive',
])
console.log('shared UI public surface and imports contain no host, Core/GRA, filesystem, repository, or superseded-era bypass')

console.log('DESIGN STUDIO UI BOUNDARY OK')
