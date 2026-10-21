/** Source-browser lifecycle plus built Core guard; not an installed-host UI claim. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PanelDraftLease } from '../src/panel-draft-lease.ts'
import { ProjectContentPanelGuard } from '../../core/lib/index.js'

test('80 clean reloads keep one page identity and clean close retires it without restarting the service', async () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
  const key = randomUUID(), ids = new Set(), guard = new ProjectContentPanelGuard('project')
  const send = async message => { ids.add(message.pageId); guard.observe(message) }
  for (let i = 0; i < 80; i++) {
    const page = new PanelDraftLease(key, 'project', storage, send, true)
    page.open(); page.report({ dirty: false, saving: false }); await page.flushed(); guard.assertQuiescent()
    page.close(); await page.flushed(); guard.assertQuiescent()
  }
  assert.equal(ids.size, 1)
})

test('dirty reload remains unknown until a real explicit disposition; closing it is never a save', async () => {
  let time = 0
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
  const key = randomUUID(), guard = new ProjectContentPanelGuard('project', 1000, () => time), sent = []
  const send = async message => { sent.push(message); guard.observe(message) }
  const original = new PanelDraftLease(key, 'project', storage, send, true)
  original.open(); original.report({ dirty: true, saving: false }); await original.flushed()
  original.close(); await original.flushed(); assert.equal(sent.at(-1).lifecycle, 'observed')
  const reloaded = new PanelDraftLease(key, 'project', storage, send, true)
  assert.equal(reloaded.unresolved, true)
  reloaded.open(); reloaded.report({ dirty: false, saving: false }); await reloaded.flushed()
  assert.throws(() => guard.assertQuiescent(), /missing/)
  time += 1001; reloaded.heartbeat(); await reloaded.flushed(); assert.throws(() => guard.assertQuiescent(), /disconnected/)
  reloaded.discardPriorDraft(); await reloaded.flushed(); guard.assertQuiescent()
  reloaded.close(); await reloaded.flushed(); guard.assertQuiescent()
})
