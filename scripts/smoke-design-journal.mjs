/** Deterministic source smoke for the host-neutral Design Journal. */
import assert from 'node:assert/strict'
import { appendFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesignJournalStorage } from '../packages/core/src/design-journal-storage.ts'
import { designClarityDigest } from '../packages/core/src/design-clarity-report.ts'
import { foldDesignJournal } from '../packages/core/src/design-journal.ts'
import { projectDesignKnowledgeDecisions } from '../packages/core/src/design-knowledge-journal.ts'

const root = await mkdtemp(join(tmpdir(), 'dsh-design-journal-'))
const kitVersion = '1.0'
const advisory = {
  schemaVersion: 1,
  id: 'alignment/run-1',
  profile: 'io.deepseek.design.advisory.alignment/v1',
  resultRef: 'alignment-result-1',
  inputs: [{ source: 'design-state', revision: 'state-1' }],
  kind: 'suggestion',
  attention: 'human-review',
  summary: 'Confirm the remaining preference.',
  items: [{ id: 'format', title: 'Choose format', detail: 'Ask for the export format.', references: [] }],
  acceptanceInstruction: 'Ask the user for the preferred export format.',
  blocksConversation: false,
  authorizesDesignWrite: false,
}

try {
  const storage = new DesignJournalStorage(root)
  const observed = []
  const dispose = storage.subscribe('conversation/A', (value) => observed.push(value.revision))
  const facts = [
    { type: 'design/kit-selected', data: { kit: 'web_app', version: kitVersion, operation: 'activate' } },
    { type: 'design/changed', data: { kit: 'web_app', version: kitVersion, skill: 'questions', state: { answer: 42 }, origin: 'panel' } },
    { type: 'design/advisory-published', data: advisory },
    { type: 'design/advisory-decided', data: { advisoryId: advisory.id, decision: 'accepted' } },
  ]
  const appended = await Promise.all(facts.map((fact) => storage.append('conversation/A', fact)))
  assert.deepEqual(appended.map((entry) => entry.revision), [1, 2, 3, 4])
  assert.deepEqual(observed, [1, 2, 3, 4])
  dispose()

  const read = await storage.read('conversation/A')
  assert.equal(read.revision, 4)
  assert.equal(read.records.length, 4)
  assert.deepEqual(read.snapshot.latestKitSelection, { kit: 'web_app', version: kitVersion })
  assert.deepEqual(read.snapshot.design.questions.state, { answer: 42 })
  assert.equal(read.snapshot.advisories[0].status, 'accepted')
  assert.ok(Number.isSafeInteger(read.snapshot.advisories[0].publishedAt), 'publication time survives disposition and replay')
  assert.equal(read.snapshot.advisories[0].publishedAt, read.records[2].publishedAt)
  assert.equal(read.snapshot.advisories[0].publishedRevision, 3)
  assert.equal((await storage.read('conversation/B')).revision, 0)

  const knowledgeDecision = {
    projectId: '11111111-1111-4111-8111-111111111111',
    proposalId: 'grounding/proposal-1',
    proposalRevision: 'knowledge-revision-1',
    proposalDigest: 'b'.repeat(64),
    decision: 'deferred',
    checkpoint: 'project-head-1',
  }
  const deferred = await storage.append('conversation/A', { type: 'design/knowledge-decided', data: knowledgeDecision })
  assert.deepEqual(deferred.snapshot.knowledgeDecisions, [{ ...knowledgeDecision, journalRevision: 5 }])
  const acceptedKnowledge = await storage.append('conversation/A', {
    type: 'design/knowledge-decided',
    data: { ...knowledgeDecision, decision: 'accepted' },
  })
  assert.equal(acceptedKnowledge.snapshot.knowledgeDecisions.at(-1).decision, 'accepted')
  assert.deepEqual(projectDesignKnowledgeDecisions('conversation/A', acceptedKnowledge.records).map((entry) => ({
    proposalId: entry.proposalId,
    decision: entry.decision,
    journal: entry.journal,
    journalRevision: entry.journalRevision,
  })), [
    { proposalId: knowledgeDecision.proposalId, decision: 'deferred', journal: 'conversation/A', journalRevision: 5 },
    { proposalId: knowledgeDecision.proposalId, decision: 'accepted', journal: 'conversation/A', journalRevision: 6 },
  ])
  await assert.rejects(
    storage.append('conversation/A', { type: 'design/knowledge-decided', data: { ...knowledgeDecision, decision: 'rejected' } }),
    /terminal knowledge decision/,
  )

  const [journalFile] = await readdir(root)
  const journalPath = join(root, journalFile)
  await appendFile(journalPath, '{"schemaVersion":3,"revision":7', 'utf8')
  assert.equal((await storage.read('conversation/A')).revision, 6, 'a syntactically torn final fragment is recoverable')
  const repaired = await storage.append('conversation/A', {
    type: 'design/changed',
    data: { kit: 'web_app', version: kitVersion, skill: 'questions', state: { answer: 43 }, origin: 'agent' },
  })
  assert.equal(repaired.revision, 7)
  assert.deepEqual(repaired.snapshot.design.questions.state, { answer: 43 })
  assert.deepEqual(repaired.snapshot.latestDesignChange, {
    journalRevision: 7,
    kit: 'web_app',
    version: kitVersion,
    skill: 'questions',
  })
  assert.equal((await readFile(journalPath, 'utf8')).split('\n').filter(Boolean).length, 7)

  const clarityContent = {
    summary: 'The product goal is clear, but its acceptance evidence remains incomplete.',
    u: { score: 72, evidence: 'The target user and primary outcome are explicit.' },
    s: { score: 48, evidence: 'The main capability exists without a complete flow.' },
    t: { score: 31, evidence: 'No measurable acceptance scenario has been recorded.' },
    nextGap: 'Define one observable acceptance scenario.',
  }
  const clarity = {
    digest: designClarityDigest(clarityContent, 'web_app', kitVersion),
    turn: 3,
    callId: 'clarity-call-3',
    kit: 'web_app',
    version: kitVersion,
    ...clarityContent,
  }
  const reported = await storage.append('conversation/A', {
    type: 'design/clarity-reported',
    data: { assessedCheckpoint: 'checkpoint-clarity-3', report: clarity },
  })
  assert.deepEqual(reported.snapshot.latestClarity, {
    assessedCheckpoint: 'checkpoint-clarity-3',
    report: clarity,
    journalRevision: 8,
  })
  assert.equal(reported.snapshot.latestDesignChange.journalRevision, 7)

  const postClarityChange = await storage.append('conversation/A', {
    type: 'design/changed',
    data: {
      kit: 'web_app',
      version: kitVersion,
      skill: 'questions',
      state: { answer: 44 },
      origin: 'agent',
      commit: 'project-head-44',
      execution: { invocationId: 'design-invocation-44', stateStatus: 'complete', handoff: 'none' },
    },
  })
  assert.equal(postClarityChange.snapshot.latestClarity.journalRevision, 8)
  assert.deepEqual(postClarityChange.snapshot.latestDesignChange, {
    journalRevision: 9,
    kit: 'web_app',
    version: kitVersion,
    skill: 'questions',
    commit: 'project-head-44',
  })

  const upgradedVersion = '1.1'
  const upgraded = await storage.append('conversation/A', {
    type: 'design/kit-selected',
    data: { kit: 'web_app', version: upgradedVersion, operation: 'upgrade' },
  })
  assert.deepEqual(upgraded.snapshot.latestKitSelection, { kit: 'web_app', version: upgradedVersion }, 'a Kit selection advances only its audit fact')
  assert.equal(upgraded.snapshot.latestClarity.journalRevision, 8, 'a Kit selection must not clear the clarity report')
  assert.equal(upgraded.snapshot.latestDesignChange.journalRevision, 9, 'a Kit selection must not clear the change entry')
  assert.deepEqual(upgraded.snapshot.design.questions.state, { answer: 44 }, 'a Kit selection must not clear Design Files facts')

  const otherKit = await storage.append('conversation/A', {
    type: 'design/kit-selected',
    data: { kit: 'game', version: '1.0', operation: 'activate' },
  })
  assert.deepEqual(otherKit.snapshot.latestKitSelection, { kit: 'game', version: '1.0' })
  assert.deepEqual(Object.keys(otherKit.snapshot.design), ['questions'], 'a cross-Kit selection keeps earlier design facts in the read model')

  // A missing or stale Journal Kit fact cannot gate design facts: the
  // committed project pin is the sole Kit-selection authority.
  const ungatedChange = { type: 'design/changed', data: { kit: 'web_app', version: kitVersion, skill: 'questions', state: { answer: 45 }, origin: 'agent' } }
  assert.deepEqual(foldDesignJournal([
    { schemaVersion: 3, revision: 1, ...ungatedChange },
  ]).design.questions.state, { answer: 45 }, 'a design change lands without any prior kit-selected fact')
  assert.deepEqual(foldDesignJournal([
    { schemaVersion: 3, revision: 1, type: 'design/kit-selected', data: { kit: 'game', version: '1.0', operation: 'activate' } },
    { schemaVersion: 3, revision: 2, ...ungatedChange },
  ]).design.questions.state, { answer: 45 }, 'a stale kit-selected audit fact cannot block a design change')
  const mismatchedClarity = { ...clarity, kit: 'game' }
  mismatchedClarity.digest = designClarityDigest(clarityContent, 'game', '1.0')
  assert.equal(foldDesignJournal([
    { schemaVersion: 3, revision: 1, type: 'design/kit-selected', data: facts[0].data },
    { schemaVersion: 3, revision: 2, type: 'design/clarity-reported', data: { assessedCheckpoint: 'checkpoint-clarity-game', report: mismatchedClarity } },
  ]).latestClarity.report.kit, 'game', 'a stale kit-selected audit fact cannot block a clarity report')

  const handoff = {
    invocationId: 'invocation-1',
    pin: {
      invocationId: 'invocation-1',
      projectId: '11111111-1111-4111-8111-111111111111',
      kitName: 'web_app',
      kitVersion,
      skillName: 'questions',
      bundleVersion: '1.0',
      stateRevision: 'agent-head',
    },
    panelStateRevision: 'panel-head',
  }
  await storage.append('conversation/A', { type: 'design/execution-handoff-consumed', data: handoff })
  const duplicateHandoff = await storage.append('conversation/A', { type: 'design/execution-handoff-consumed', data: handoff })
  assert.equal(duplicateHandoff.snapshot.consumedExecutionHandoffs.length, 1, 'the fold is idempotent for an exact duplicate')
  await assert.rejects(
    storage.append('conversation/A', {
      type: 'design/execution-handoff-consumed',
      data: { ...handoff, panelStateRevision: 'different-panel-head' },
    }),
    /consumed with different authority/,
  )

  const badRoot = await mkdtemp(join(tmpdir(), 'dsh-design-journal-bad-'))
  try {
    const badStorage = new DesignJournalStorage(badRoot)
    const badName = Buffer.from('bad', 'utf8').toString('base64url') + '.jsonl'
    await writeFile(join(badRoot, badName), '{}\n', 'utf8')
    await assert.rejects(badStorage.read('bad'), /invalid record on line 1/)
    const validFirst = JSON.stringify({ schemaVersion: 3, revision: 1, ...facts[0] })
    await writeFile(join(badRoot, badName), `${validFirst}\nnot-json\n`, 'utf8')
    await assert.rejects(badStorage.read('bad'), /malformed JSON on complete line 2/)
    await writeFile(join(badRoot, badName), 'not-json', 'utf8')
    await assert.rejects(badStorage.read('bad'), /malformed JSON on complete line 1/)
  } finally {
    await rm(badRoot, { recursive: true, force: true })
  }

  const bounded = new DesignJournalStorage(join(root, 'bounded'), { maxRecords: 1 })
  await bounded.append('bounded', facts[0])
  await assert.rejects(bounded.append('bounded', facts[1]), /record limit/)
  console.log('DESIGN JOURNAL OK')
} finally {
  await rm(root, { recursive: true, force: true })
}
