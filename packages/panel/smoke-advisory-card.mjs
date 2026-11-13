/**
 * Advisory Review Card acceptance smoke (node, SSR + pure helpers): renders
 * only current pending/deferred human-review advisories deduplicated by id
 * (stale pending entries remain reviewable); acceptance saves its receipt before
 * confirming the Host continuation delivery and keeps the
 * card retryable on failure; reject/defer never deliver a prompt. The inbox
 * stays on the host composer card width when the Design dock is open. Run (from
 * packages/panel): node smoke-advisory-card.mjs. Source-only checks:
 * PANEL_ADVISORY_SOURCE=1 node --import tsx smoke-advisory-card.mjs
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
const {
  AdvisoryReviewCard,
  adjacentAdvisoryIndex,
  completeAdvisoryAcceptance,
  deliverAdvisoryAcceptance,
  resolveAdvisoryIndex,
  renderAdvisoryAcceptancePrompt,
  selectPendingAdvisories,
} = await import(process.env.PANEL_ADVISORY_SOURCE === '1'
  ? './src/client/ported/design/AdvisoryReviewCard.tsx' : './lib/index.js')
import { advisoryEntries, alignmentAdvisory, reflectionAdvisory } from './fixtures/advisory-review.mjs'

const noop = async () => {}
const noopDeferred = () => {}

// --- Host layout: advisory chrome owns the composer column, not the dock ----

const [styles, client, advisoryComponent] = await Promise.all([
  readFile(new URL('./src/client/styles.ts', import.meta.url), 'utf8'),
  readFile(new URL('./src/client/index.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./src/client/ported/design/AdvisoryReviewCard.tsx', import.meta.url), 'utf8'),
])
assert.match(
  client,
  /face\.slots\.inject\('conversation\.input\.dock',[\s\S]*?id: 'design-advisories',[\s\S]*?AdvisoryComposerInbox/,
  'advisory inbox must remain mounted in the conversation input dock',
)
assert.match(client, /id='dsh-advisory-composer-inbox'/, 'the composer inbox must be the sidebar trigger target')
assert.match(client, /const pending = pendingAdvisoryCount\(entries\)/, 'the single inbox must retain every unresolved retryable review')
assert.match(client, /useAdvisoryInboxExpanded\(sessionId\)/, 'sidebar and composer slots must share one controlled visibility state')
assert.match(client, /workspace\.projectId === null \|\| !expanded/, 'collapsed state must unmount the composer inbox; open empty state remains visible')
assert.match(
  client,
  /if \(hasNewPending && !expanded\)/,
  'new arrivals reopen a closed inbox but never interrupt an open card',
)
const advisoryRule = styles.match(/\.dsh-advisory-inbox\{([^}]+)\}/)?.[1]
assert.notEqual(advisoryRule, undefined, 'advisory inbox CSS rule must exist')
assert.match(advisoryRule, /box-sizing:border-box/)
assert.match(advisoryRule, /min-inline-size:0/)
assert.match(
  advisoryRule,
  /inline-size:calc\(100% - var\(--dsh-composer-side-clearance,16px\) - var\(--dsh-composer-side-clearance,16px\)\)/,
  'advisory inbox must use the same side clearance as the composer card',
)
assert.match(
  advisoryRule,
  /max-inline-size:var\(--dsh-composer-card-max-width,780px\)/,
  'advisory inbox must use the composer card maximum width instead of the viewport or Design dock width',
)
assert.match(advisoryRule, /align-self:center/)
assert.doesNotMatch(advisoryComponent, /createPortal|expandedRect|ResizeObserver/, 'details do not leave the inbox or maintain a second layout')
assert.doesNotMatch(styles, /dsh-advisory-expanded-layer/, 'the superseded expanded layer has no styling authority')
assert.match(styles, /\.dsh-advisory-card\{[^}]*font:400 14px\/1\.5/, 'the same card owns reading typography')
assert.match(styles, /\.dsh-advisory-card\[data-expanded\] \.dsh-advisory-details\{display:flex;min-height:0;flex:1;flex-direction:column;overflow:hidden/)
assert.match(styles, /\.dsh-advisory-card\[data-expanded\] \.dsh-advisory-items-scroll\{min-height:0;max-height:none;flex:1;overflow-y:auto/)
assert.match(advisoryComponent, /<div className='dsh-advisory-items-scroll'>\s*<ul className='dsh-advisory-items'>/)

// --- SSR: pending human-review only, deduplicated, accessible actions -----------
const html = renderToStaticMarkup(createElement(AdvisoryReviewCard, {
  entries: advisoryEntries,
  onAccept: noop,
  onRecordAccepted: noop,
  onDismiss: noop,
  onDeferred: noopDeferred,
}))
assert.equal((html.match(/data-advisory-id="advisory-stale-1"/g) ?? []).length, 1, 'latest pending card renders first')
assert.equal((html.match(/data-advisory-id="advisory-alignment-1"/g) ?? []).length, 0, 'only the selected card renders')
assert.ok(html.includes('1 / 3'))
assert.match(html, /aria-label="Previous design advisory"[^>]*disabled=""/)
assert.match(html, /aria-label="Next design advisory"/)
assert.ok(!html.includes('advisory-boundary-1'), 'next-boundary advisories must not render')
assert.ok(html.includes('aria-label="Accept advisory advisory-stale-1"'))
assert.ok(html.includes('aria-label="Reject advisory advisory-stale-1"'))
assert.ok(html.includes('aria-label="Defer advisory advisory-stale-1"'))
assert.ok(html.includes('aria-label="Show advisory details for advisory-stale-1"'))
assert.ok(html.includes('<details class="dsh-advisory-details">'), 'details are collapsed by default')
assert.ok(!html.includes('<details class="dsh-advisory-details" open=""'))
assert.ok(!html.includes('Reflection review'), 'the profile does not repeat the surrounding advisory context')
assert.ok(html.includes('Contradicting refund paths'))
assert.ok(
  html.indexOf('</article>') < html.indexOf('dsh-advisory-carousel-controls'),
  'pagination must render below the advisory card',
)
const paginationRule = styles.match(/\.dsh-advisory-carousel-controls\{([^}]+)\}/)?.[1]
assert.notEqual(paginationRule, undefined, 'advisory pagination CSS rule must exist')
assert.match(paginationRule, /justify-content:center/, 'pagination must be centered below the card')
assert.doesNotMatch(html, /dsh-advisory-card-header|dsh-advisory-profile|dsh-advisory-status|dsh-advisory-new-arrival/, 'the stale selected card starts with its actual advice rather than a second title/status row')
assert.doesNotMatch(styles, /\.dsh-advisory-(?:card-header|profile|status|new-arrival|unread)(?:\{|:|,)/, 'superseded header styles are removed at their owner')
const actionRule = styles.match(/\.dsh-advisory-actions button\{([^}]+)\}/)?.[1]
assert.match(actionRule, /display:inline-flex/)
assert.match(actionRule, /box-sizing:border-box/)
assert.match(actionRule, /height:32px/)
assert.match(actionRule, /align-items:center/)
assert.match(actionRule, /justify-content:center/)
assert.match(actionRule, /padding:0 12px/, 'ordinary actions have no vertical padding added to the shared height')

// Empty state: nothing pending renders nothing unless emptyText is provided.
assert.equal(renderToStaticMarkup(createElement(AdvisoryReviewCard, {
  entries: [], onAccept: noop, onRecordAccepted: noop, onDismiss: noop, onDeferred: noopDeferred,
})), '')
assert.ok(renderToStaticMarkup(createElement(AdvisoryReviewCard, {
  entries: [],
  onAccept: noop,
  onRecordAccepted: noop,
  onDismiss: noop,
  onDeferred: noopDeferred,
  emptyText: 'No pending reviews',
})).includes('No pending reviews'))

// --- Pure selection: status/attention/stale filters, dedup, handled exclusion ----

const selected = selectPendingAdvisories(advisoryEntries, new Set())
assert.equal(selected.some(advisory => advisory.id === 'advisory-completed-1'), false, 'execution completion is terminal and hidden')
assert.deepEqual(selected.map((advisory) => advisory.id), [
  'advisory-stale-1', 'advisory-alignment-1', 'advisory-reflection-1',
], 'accepted entries leave the review surface while pending needs-revalidation entries remain visible')
assert.deepEqual(
  selectPendingAdvisories(advisoryEntries, new Set(['advisory-reflection-1'])).map((advisory) => advisory.id),
  ['advisory-stale-1', 'advisory-alignment-1'],
)
assert.deepEqual(
  selectPendingAdvisories([
    { advisory: { ...alignmentAdvisory, id: 'advisory-deferred-1' }, status: 'deferred', stale: false },
  ], new Set()).map((advisory) => advisory.id),
  ['advisory-deferred-1'],
  'defer keeps the advisory in the review surface',
)
assert.equal(resolveAdvisoryIndex(['a', 'new', 'b'], 'b', ['a', 'b']), 2, 'new arrivals preserve the selected advisory')
assert.equal(resolveAdvisoryIndex(['a', 'c'], 'b', ['a', 'b', 'c']), 1, 'a removed advisory selects its nearest survivor')
assert.equal(resolveAdvisoryIndex(['a'], null, []), 0)
assert.equal(adjacentAdvisoryIndex(0, 2, -1), 0, 'previous stays disabled at the first card')
assert.equal(adjacentAdvisoryIndex(0, 2, 1), 1, 'next switches to the second card')
assert.equal(adjacentAdvisoryIndex(1, 2, 1), 1, 'next stays disabled at the last card')
assert.match(advisoryComponent, /if \(expandedId !== null\) setExpandedId\(next\.id\)/, 'switching cards preserves expanded mode')
assert.match(
  advisoryComponent,
  /if \(!result\.receiptRecorded \|\| !result\.promptDelivered\)[\s\S]*?addTo\(setFailed, advisory\.id\)[\s\S]*?return[\s\S]*?addTo\(setLocallyHandled, advisory\.id\)/,
  'successful acceptance must leave the carousel while failed delivery remains retryable',
)
assert.match(
  advisoryComponent,
  /await onDismiss\(advisory, decision\)[\s\S]*?setExpandedId\(\(current\) => current === advisory\.id \? null : current\)[\s\S]*?if \(decision === 'rejected'\) addTo\(setLocallyHandled, advisory\.id\)[\s\S]*?else onDeferred\(\)/,
  'defer collapses the shared inbox while reject removes the card from the review surface',
)
assert.match(
  client,
  /onDeferred=\{\(\) => \{ advisoryInboxVisibility\.setExpanded\(sessionId, false\) \}\}/,
  'the composer host must collapse the same shared inbox controlled by the sidebar bubble',
)
assert.match(
  client,
  /setExpanded: \(sessionId: string \| undefined, expanded: boolean, target\?: string\): void => \{[\s\S]*?isExpanded\(sessionId\) === expanded[\s\S]*?advisoryInboxVisibilityBySession\.set\(sessionId, expanded\)/,
  'defer uses an idempotent explicit collapse instead of toggling a possibly stale visibility state',
)

const exactAuthority = {
  acceptanceReceiptId: 'acceptance-secret',
  actionReceipts: [{
    actionId: 'bundle:flow_design',
    receiptId: 'action-flow',
    target: {
      kitName: 'web_app', kitVersion: '1', skillName: 'flow_design', bundleVersion: '1', entityRefs: ['flow-1'],
    },
    state: 'ready',
  }],
  executionStatus: 'ready',
}
const exactPrompt = renderAdvisoryAcceptancePrompt(reflectionAdvisory, exactAuthority)
assert.match(exactPrompt, /action-flow/)
assert.match(exactPrompt, /flow_design/)
assert.doesNotMatch(exactPrompt, /acceptance-secret/, 'acceptance receipt must not enter model-visible tool authority')
assert.ok(exactPrompt.includes(`advisoryId: ${JSON.stringify(reflectionAdvisory.id)}`), 'the accepted report is identified independently of item titles')
assert.ok(exactPrompt.includes(reflectionAdvisory.acceptanceInstruction), 'the model retains the server-bounded facts the human accepted')
const zeroReceiptPrompt = renderAdvisoryAcceptancePrompt(alignmentAdvisory, {
  acceptanceReceiptId: 'acceptance-zero', actionReceipts: [], executionStatus: 'not-applicable',
})
assert.match(zeroReceiptPrompt, /No Bundle action was authorized/)
assert.doesNotMatch(zeroReceiptPrompt, /acceptance-zero/)

// --- Delivery contract: await-first acceptance, retryable failure, quiet dismiss --

{
  const calls = []
  const delivered = await deliverAdvisoryAcceptance(reflectionAdvisory, async (advisory) => {
    calls.push(advisory.acceptanceInstruction)
  })
  assert.equal(delivered, true)
  assert.deepEqual(calls, [reflectionAdvisory.acceptanceInstruction], 'acceptance delivers exactly one prompt')
}
{
  const order = []
  const first = await completeAdvisoryAcceptance(
    reflectionAdvisory,
    async () => { order.push('record'); throw new Error('receipt append failed') },
    async () => { order.push('deliver') },
  )
  assert.deepEqual(first, { promptDelivered: false, receiptRecorded: false })
  assert.deepEqual(order, ['record'], 'failed receipt persistence must prevent dispatch')
  const retry = await completeAdvisoryAcceptance(
    reflectionAdvisory,
    async () => {
      order.push('record')
      return {
        acceptanceReceiptId: 'acceptance-1',
        actionReceipts: [{
          actionId: 'bundle:flow_design',
          receiptId: 'action-1',
          target: {
            kitName: 'web_app', kitVersion: '1', skillName: 'flow_design', bundleVersion: '1', entityRefs: ['flow-1'],
          },
          state: 'ready',
        }],
        executionStatus: 'ready',
      }
    },
    async (_advisory, authority) => { order.push(`deliver:${authority.actionReceipts[0].receiptId}`) },
  )
  assert.deepEqual(retry, { promptDelivered: true, receiptRecorded: true, receiptId: 'acceptance-1' })
  assert.deepEqual(order, ['record', 'record', 'deliver:action-1'], 'acceptance is receipt-first and dispatch receives its exact action authority')
}
{
  const calls = []
  const delivered = await deliverAdvisoryAcceptance(alignmentAdvisory, async () => {
    calls.push('sent')
    throw new Error('sendPrompt failed')
  })
  assert.equal(delivered, false, 'failed delivery reports false so the card stays retryable')
  assert.equal(calls.length, 1)
}
{
  // Reject/defer path: the dismiss callback never receives a delivery channel.
  let delivered = 0
  const onDismiss = async (advisory, decision) => {
    assert.equal(decision, 'rejected')
    assert.equal(advisory.id, reflectionAdvisory.id)
  }
  const onAccept = async () => { delivered += 1 }
  renderToStaticMarkup(createElement(AdvisoryReviewCard, {
    entries: advisoryEntries, onAccept, onRecordAccepted: noop, onDismiss, onDeferred: noopDeferred,
  }))
  onDismiss(reflectionAdvisory, 'rejected')
  assert.equal(delivered, 0, 'reject/defer must never deliver a prompt')
}

console.log('ADVISORY CARD OK')
