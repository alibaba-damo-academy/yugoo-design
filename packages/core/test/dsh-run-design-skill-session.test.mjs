import assert from 'node:assert/strict'
import test from 'node:test'
const { register } = await import('tsx/esm/api'); register()
const { apply } = await import('../src/dsh-run-design-skill-tool.ts')

test('snapshot-only host enforces visible acknowledgement instead of bypassing it', async () => {
  let tool, runs = 0
  apply({ on() {}, tools: { register(definition) { tool = definition } } }, {
    onMainSettlement() {},
    async run() { runs++; return { kind: 'in_progress', summary: 'started' } },
  })
  const call = { type: 'tool/call', data: { turn: 1, step: 1, callId: 'root', name: 'run_design_skill' } }
  const history = [{ type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [] } } }, call]
  const session = {
    snapshotEvents() { return history },
    ownEvents() { throw new Error('full snapshot required') },
    get events() { throw new Error('must not inspect legacy accessor on official host') },
  }
  const exec = { agent: { session }, rootCallId: 'root', signal: new AbortController().signal }
  const blocked = await tool.execute({ name: 'example' }, exec)
  assert.equal(blocked.kind, 'invalid')
  assert.equal(runs, 0)
  history[0].data.message.content.push({ type: 'text', text: 'I will run this design skill and persist its result.' })
  assert.equal((await tool.execute({ name: 'example' }, exec)).kind, 'in_progress')
  assert.equal(runs, 1)
})
