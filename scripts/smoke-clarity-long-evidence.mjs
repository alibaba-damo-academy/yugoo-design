/** Host-neutral long scoring evidence: parse, digest, atomic persistence and reopen. */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DESIGN_CLARITY_TEXT_LIMITS, DesignKitVersion, DesignProjectId, designClarityDigest,
  parseDesignClarityInput, parseDesignClarityReported, readDesignClarityAuthority,
  writeDesignClarityAuthority } from '../packages/core/lib/index.js'
import { DesignPanelRemote } from '../packages/core/lib/panel-remote.js'
import { TYPERT_REMOTE } from '../packages/core/lib/typert.remote-client.js'

const text = '结构与流程已经明确；每项评分应保留完整证据，而不是因为说明较长拒绝更新。'.repeat(300)
assert.ok(Buffer.byteLength(text) > 1024)
const input = { summary: text, u: { score: 82, evidence: text },
  s: { score: 76, evidence: text }, t: { score: 61, evidence: text }, nextGap: text }
assert.deepEqual(parseDesignClarityInput(input), input)
const kit = 'web_app', version = DesignKitVersion('1.0')
const report = { ...input, origin: 'evaluator', kit, version, turn: 1, callId: 'long-evidence', digest: designClarityDigest(input, kit, version) }
assert.deepEqual(parseDesignClarityReported(report), report)
assert.throws(() => parseDesignClarityInput({ ...input, u: { score: 82, evidence: 'x'.repeat(DESIGN_CLARITY_TEXT_LIMITS.evidenceMaxBytes + 1) } }), /exceeds/)
assert.throws(() => parseDesignClarityInput({ ...input, u: { score: 101, evidence: text } }), /integer/)
assert.throws(() => parseDesignClarityReported({ ...report, digest: '0'.repeat(64) }), /digest/)
const root = await mkdtemp(join(tmpdir(), 'clarity-long-evidence-'))
try {
  const projectId = DesignProjectId('11111111-1111-4111-8111-111111111111')
  const authority = { schemaVersion: 1, projectId, assessedCheckpoint: 'long-evidence-commit', report }
  await writeDesignClarityAuthority(root, authority)
  assert.deepEqual(await readDesignClarityAuthority(root, projectId), authority, 'all explanations survive save and reopen')
  const remote = Object.create(DesignPanelRemote.prototype)
  Object.defineProperty(remote, 'worktreeProjections', { value: new Map() })
  Object.defineProperty(remote, 'design', { value: {
    withWorkspaceRead: (_agent, _signal, read) => read(),
    selectedProjectForAgent: async () => ({ projectId, name: 'Fixture', root, kit: { name: kit, version } }),
    readProjectWorkspaceSnapshot: async () => ({ checkpoint: authority.assessedCheckpoint, design: {}, kit: { name: kit, version } }),
    readDesignJournal: async () => ({ revision: 1, records: [], snapshot: { design: {} } }),
    readClarityAuthority: async () => readDesignClarityAuthority(root, projectId),
    designFilesForProject: async () => ({ listPathsAt: async () => [], listWorktreeFiles: async () => [], sameDesignEvidenceAt: async () => true }),
    executionAttemptsFor: () => [], assertProjectSelection() {}, resolveProjectKit: () => undefined, latestKit: () => undefined,
    advisoryRuntimeStatus: () => ({ available: false, profiles: [], phase: 'idle' }),
  } })
  const workspace = await remote.readWorkspace({ id: 'fixture', session: { id: 'fixture', events: [] } }, new AbortController().signal)
  assert.equal(workspace.clarity.explanation.s, text)
  assert.equal(workspace.clarity.needsReassessment, true, 'readable historical evidence without input pins must not be relabeled current')
  const route = TYPERT_REMOTE.descriptors.find(method => method.method === 'readWorkspace')
  assert.equal(route.result.create().parse(workspace).clarity.explanation.s, text, 'strict DSH transport must not strip explanations')
  // JSON escaping is substantially larger than UTF-8 input; a valid report
  // must never be written successfully and then rejected on its next read.
  const escaped = { ...input, summary: '\u0001'.repeat(65_536), nextGap: '\u0001'.repeat(65_536),
    u: { score: 82, evidence: '\u0001'.repeat(65_536) },
    s: { score: 76, evidence: '\u0001'.repeat(65_536) }, t: { score: 61, evidence: '\u0001'.repeat(65_536) } }
  const escapedReport = { ...report, ...escaped, digest: designClarityDigest(escaped, kit, version) }
  await writeDesignClarityAuthority(root, { ...authority, report: escapedReport })
  assert.deepEqual((await readDesignClarityAuthority(root, projectId)).report, escapedReport)
} finally { await rm(root, { recursive: true, force: true }) }
console.log('LONG CLARITY EVIDENCE OK')
