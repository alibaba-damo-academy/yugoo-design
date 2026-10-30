import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './fixture.mjs'
import { openCompanionProject } from '../src/project.mjs'
import { createCodexConnection } from '../src/codex-connection.mjs'

test('Codex pre-add setup failure preserves notification-only recovery while queue failure remains unknown after reopen', async () => {
  const f = await fixture()
  try {
    for (const failure of ['proxy-connect', 'initialize', 'queue-add']) {
      const calls = []
      const connection = createCodexConnection(f.options.threadId, async () => {
        if (failure === 'proxy-connect') throw Error('SECRET setup failure')
        return { close() {}, notify() {}, async request(method) {
          calls.push(method)
          if (method === 'initialize' && failure !== 'initialize') return {}
          throw Object.assign(Error('SECRET native failure'), { transportCategory: 'disconnected', notSubmitted: true })
        } }
      })
      const options = { ...f.options, connection }
      let api = await openCompanionProject(options)
      const eventId = `codex-${failure}`
      const saved = await api.savePanel({ skill: 'smart_questions', eventId,
        state: { questions: { goal: { prompt: 'Goal?', kind: 'text', answer: failure, detail: '' } } } })
      const canonical = join(f.options.projectRoot, 'design_files/smart_questions/smart_questions.json')
      const bytes = await readFile(canonical, 'utf8')
      const request = { text: 'Continue', requestId: eventId, saved: [{ eventId, commit: saved.commit }] }
      await assert.rejects(api.sendPrompt(request), error => {
        assert.equal(error.notSubmitted, failure === 'queue-add' ? undefined : true)
        assert.doesNotMatch(error.message, /SECRET/)
        return true
      })
      api = await openCompanionProject(options)
      const entry = (await api.readWorkspace()).savedContinuations.find(entry => entry.eventId === eventId)
      assert.equal(entry.status, failure === 'queue-add' ? 'unknown' : 'not_submitted')
      assert.equal(entry.retryable, failure !== 'queue-add')
      assert.equal(await api.store.head(), saved.commit)
      assert.equal(await readFile(canonical, 'utf8'), bytes)
      if (failure === 'queue-add') {
        assert.equal((await api.sendPrompt(request)).status, 'unknown')
        assert.equal(calls.filter(method => method === 'thread/queue/add').length, 1, 'unknown queue insertion cannot replay')
      } else assert.equal(calls.includes('thread/queue/add'), false)
      assert.deepEqual(f.messages, [])
    }
  } finally { await f.close() }
})

test('Qwen saved-edit continuation uses live GRA policy and readiness while preserving foreground progress', async () => {
  const f = await fixture()
  try {
    const api = await openCompanionProject({ ...f.options,
      connection: { ...f.options.connection, host: 'qwenwork' },
      getConnectionPath: () => '/fixture/exact-qwen-connection.json',
    })
    const saved = await api.savePanel({ skill: 'smart_questions', eventId: 'qwen-live-gra',
      state: { questions: { goal: { prompt: 'Goal?', kind: 'text', answer: 'Saved user answer', detail: '' } } },
    })
    const receipt = await api.sendPrompt({ text: 'Continue my design', requestId: 'qwen-continue',
      saved: [{ eventId: 'qwen-live-gra', commit: saved.commit }],
    })
    assert.equal(receipt.accepted, true)
    assert.equal(f.messages.length, 1)
    const prompt = f.messages[0]
    assert.match(prompt, /QwenWork native-execution reference/)
    assert.match(prompt, /design_status\.hostCapabilities and reviewPolicy/)
    assert.match(prompt, /only current ready capability and an authorized dispatch reference permit a background launch/)
    assert.match(prompt, /turn off automatic GRA while retaining manual checks/)
    assert.match(prompt, /executionMode="foreground"/)
    assert.match(prompt, /keep requests and policy unchanged/)
    assert.match(prompt, /Never run synchronous GRA automatically/)
    assert.match(prompt, /After this Panel save, read design_status once/)
    assert.match(prompt, /do not wait for background GRA/)
    assert.match(prompt, /exact-qwen-connection\.json/)
    assert.match(prompt, /Saved user answer/)
    assert.doesNotMatch(prompt, /QwenWork background reviewer execution is not verified|Read existing review status only|do not prepare a new batch|background reviewer execution is unavailable in this adapter/)
    assert.equal(await api.store.head(), saved.commit, 'notification neither rewrites the saved design nor runs a review')
    await api.sendPrompt({ text: 'Another ordinary user message', requestId: 'qwen-no-save' })
    assert.equal(f.messages.length, 2)
    assert.doesNotMatch(f.messages[1], /After this Panel save/, 'a plain message is not fabricated as another save or review request')

    for (const host of ['codex', 'claude-code', 'qoder', 'workbuddy']) {
      const other = await openCompanionProject({ ...f.options, connection: { ...f.options.connection, host } })
      await other.sendPrompt({ text: 'Ordinary unchanged host message', requestId: `${host}-no-save` })
      assert.match(f.messages.at(-1), /turn off automatic GRA while retaining manual checks/)
      assert.match(f.messages.at(-1), /executionMode="foreground"/)
      assert.doesNotMatch(f.messages.at(-1), /Workers and GRA remain unavailable|GRA review execution are unavailable/)
      assert.doesNotMatch(f.messages.at(-1), /QwenWork native-execution/)
    }
  } finally { await f.close() }
})

test('real saved checkpoint recovers only notification across reopen, never unknown/accepted delivery or canonical writes', async () => {
  const f = await fixture()
  try {
    let api = f.server.project
    const canonical = join(f.options.projectRoot, 'design_files/smart_questions/smart_questions.json')
    const state = answer => ({ questions: { overview: { prompt: 'Goal?', kind: 'text', answer, detail: '' } } })
    const first = await api.savePanel({ skill: 'smart_questions', state: state('saved once'), eventId: 'save-reopen' })
    const saved = [{ eventId: 'save-reopen', commit: first.commit }]
    const published = await readFile(canonical, 'utf8')
    f.failNotification(true)
    await assert.rejects(api.sendPrompt({ text: 'Continue', requestId: 'request-one', saved }), /disconnected/)
    assert.equal((await api.readWorkspace()).savedContinuations[0].retryable, true)
    f.failNotification(false)
    api = await openCompanionProject(f.options)
    assert.equal(f.messages.length, 0, 'reopen itself never submits')
    const originalSend = f.options.connection.send
    const admission = []
    f.options.connection.send = async (text, metadata) => {
      admission.push(metadata)
      await originalSend(text)
      return { accepted: true, status: 'queued', queuedSubmissionId: 'exact-native-queue' }
    }
    const receipt = await api.sendPrompt({ text: 'Continue', requestId: 'request-one', saved })
    assert.equal(receipt.status, 'queued')
    assert.equal(admission[0].requestId, 'request-one')
    assert.deepEqual(admission[0].saved, saved)
    assert.match(f.messages[0], /saved once/)
    assert.match(f.messages[0], /Do not call a write tool/)
    assert.equal(await api.store.head(), first.commit)
    assert.equal(await readFile(canonical, 'utf8'), published)
    api = await openCompanionProject(f.options)
    assert.equal((await api.sendPrompt({ text: 'Continue', requestId: 'request-one', saved })).status, 'queued')
    assert.equal(admission.length, 1, 'accepted durable native queue never resubmits on replay')

    const second = await api.savePanel({ skill: 'smart_questions', state: state('second checkpoint'), eventId: 'save-unknown' })
    const unknownSaved = [{ eventId: 'save-unknown', commit: second.commit }]
    let uncertainAttempts = 0
    f.options.connection.send = async () => { uncertainAttempts++; return { accepted: false, status: 'unknown' } }
    await api.sendPrompt({ text: 'Continue second', requestId: 'unknown-one', saved: unknownSaved })
    api = await openCompanionProject(f.options)
    const uncertain = await api.sendPrompt({ text: 'Continue second', requestId: 'unknown-one', saved: unknownSaved })
    assert.equal(uncertain.status, 'unknown'); assert.equal(uncertainAttempts, 1)
    assert.equal(await api.store.head(), second.commit)
    assert.equal(JSON.parse(await readFile(canonical, 'utf8')).questions.overview.answer, 'second checkpoint')

    const third = await api.savePanel({ skill: 'smart_questions', state: state('preflight failure'), eventId: 'save-preflight' })
    let rejectContext = true
    api = await openCompanionProject({ ...f.options, getMainAssessmentContext: async entries => {
      assert.equal(entries[0].eventId, 'save-preflight')
      if (rejectContext) throw Error('read-only context unavailable')
      return 'Exact main assessment input fixture (not an assessment result).'
    } })
    const thirdSaved = [{ eventId: 'save-preflight', commit: third.commit }]
    await assert.rejects(api.sendPrompt({ text: 'Continue third', requestId: 'third', saved: thirdSaved }), /context unavailable/)
    assert.equal(uncertainAttempts, 1, 'context failure occurs before native submission')
    assert.equal((await api.readWorkspace()).savedContinuations.find(entry => entry.eventId === 'save-preflight').retryable, true)
    rejectContext = false
    f.options.connection.send = async text => { assert.match(text, /Exact main assessment input fixture/); return { accepted: true, status: 'hook_received' } }
    await api.sendPrompt({ text: 'Continue third', requestId: 'third', saved: thirdSaved })
    assert.equal(await api.store.head(), third.commit)

    // Delivery metadata is not a second design authority or save gate.
    const directory = join(f.options.stateRoot, api.project.metadata.id, 'saved-continuations')
    const file = join(directory, (await readdir(directory))[0])
    await writeFile(file, '{')
    const snapshot = await api.readWorkspace()
    assert.ok(snapshot.savedNotificationError)
    assert.equal(snapshot.design.smart_questions.state.questions.overview.answer, 'preflight failure')
    const fourth = await api.savePanel({ skill: 'smart_questions', state: state('saved despite metadata fault'), eventId: 'save-metadata-fault' })
    assert.ok(fourth.commit); assert.equal(fourth.notificationPersistence, 'unavailable')
    assert.equal(JSON.parse(await readFile(canonical, 'utf8')).questions.overview.answer, 'saved despite metadata fault')
    assert.equal(await api.store.head(), fourth.commit)
  } finally { await f.close() }
})
