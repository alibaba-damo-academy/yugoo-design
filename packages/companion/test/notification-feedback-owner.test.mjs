/** Execute the actual source adapter method with bounded ports; not native Host acceptance. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { requireNotificationAccepted, notificationAutoDismiss } from '../src/notification-result.mjs'

const source = await readFile(new URL('../src/client.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('client.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let method, continuation
const visit = node => {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'runtime') {
    method = node.initializer.properties.find(property => property.name?.getText(tree) === 'sendPrompt').initializer
  }
  if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'onContinue' && node.initializer?.expression?.getText(tree).includes('runtime.sendPrompt')) continuation = node.initializer.expression
  ts.forEachChild(node, visit)
}
visit(tree)
assert.ok(method, 'the existing runtime adapter owns notification feedback')
const compiled = ts.transpileModule(`(${method.getText(tree)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
function harness(result, failure) {
  const notices = [], notificationErrors = [], saving = [], polls = []
  const context = { Error, rpc: async () => { if (failure) throw failure; return result },
    requireNotificationAccepted, notificationAutoDismiss, companionChromeMessages: () => undefined,
    companionLocale: { getSnapshot: () => ({ active: 'en' }) },
    currentHostLabel: () => 'Codex', nativeHostLabel: 'Codex', hostInfo: { host: 'codex' },
    currentChrome: key => key, onNotice: (...args) => notices.push(args),
    panelStore: { getSnapshot: () => ({ saving: false, error: 'Earlier save delivery failed' }) },
    lastNotificationFailure: 'Earlier save delivery failed', setSaving: value => saving.push(value),
    onNotificationError: value => notificationErrors.push(value), requestLivePoll: () => polls.push(true),
  }
  return { send: vm.runInNewContext(compiled, context), context, notices, notificationErrors, saving, polls }
}

test('ordinary chat failure stays with its composer and cannot replace saved-notification recovery', async () => {
  const error = new Error('Transport disconnected')
  const h = harness(undefined, error)
  await assert.rejects(h.send('', 'Keep this unsent message'), failure => failure === error)
  assert.deepEqual(h.notices, [])
  assert.deepEqual(h.notificationErrors, [])
  assert.deepEqual(h.saving, [])
  assert.equal(h.context.lastNotificationFailure, 'Earlier save delivery failed')
})

test('ordinary accepted chat and denied review requests preserve notification state', async () => {
  const accepted = harness({ accepted: true, status: 'submitted_unverified' })
  await accepted.send('', 'Continue reviewing')
  assert.deepEqual(accepted.notices, [])
  assert.deepEqual(accepted.notificationErrors, [])
  assert.deepEqual(accepted.polls, [true])
  assert.equal(accepted.context.lastNotificationFailure, 'Earlier save delivery failed')
  const denied = harness({ accepted: false, status: 'denied' })
  await assert.rejects(denied.send('', 'Review the current design'))
  assert.deepEqual(denied.notices, [])
})

test('saved-event notification keeps failure recovery and clears only its own acknowledged error', async () => {
  const error = new Error('Saved event delivery failed'), saved = { eventId: 'saved-event' }
  const failed = harness(undefined, error)
  await assert.rejects(failed.send('', 'Saved changes', undefined, saved), failure => failure === error)
  assert.equal(failed.notices.length, 2)
  assert.deepEqual(failed.notificationErrors, [String(error)])
  assert.equal(failed.context.lastNotificationFailure, error.message)
  const accepted = harness({ accepted: true, status: 'user_input_accepted' })
  await accepted.send('', 'Saved changes', undefined, saved)
  assert.equal(accepted.notices.length, 2)
  assert.deepEqual(accepted.notificationErrors, [''])
  assert.deepEqual(accepted.saving, [false])
  assert.equal(accepted.context.lastNotificationFailure, undefined)
})

test('the continuation action owns its failed-send notice and keeps its one-shot admission', async () => {
  assert.ok(continuation)
  const notices = [], submitted = [], state = { value: undefined }
  const context = { Error, thread: 'thread', continuationStatus: undefined, continuationKey: 'gate',
    trialControls: { current: { dirty: false, saving: false } }, panelStore: { getSnapshot: () => ({ saving: false }) },
    attemptedContinuation: { current: undefined }, browserRandomUuid: () => 'request',
    setContinuationAttempt: next => { state.value = typeof next === 'function' ? next(state.value) : next },
    onNotice: text => notices.push(text),
    runtime: { sendPrompt: async (...args) => { submitted.push(args); throw new Error('Continuation transport disconnected') } },
  }
  const callback = vm.runInNewContext(ts.transpileModule(`(${continuation.getText(tree)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  callback('Continue design')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(notices, ['Continuation transport disconnected'])
  assert.equal(state.value.sending, false)
  callback('Continue design')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(submitted.length, 1, 'a failure never silently retries the continuation')
})
