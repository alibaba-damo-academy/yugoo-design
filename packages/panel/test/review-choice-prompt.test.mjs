import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { renderAdvisoryAcceptancePrompt } = await import('../src/client/ported/design/AdvisoryReviewCard.tsx')
const { TYPERT_REMOTE } = await import('../../core/src/typert.remote-client.ts')
const { officialAdvisoryProfile, OFFICIAL_GROUNDING_PROFILE } = await import('../../core/src/official-advisory-profiles.ts')

test('Grounding acceptance retains exact report identity and server facts despite repeated item ids and generic titles', () => {
  for (const userContextSummary of ['Please repair the CSS href.', '请修复页面样式引用。']) {
  const profile = officialAdvisoryProfile(OFFICIAL_GROUNDING_PROFILE)
  const advice = (runId, detail, correction) => profile.project({ schemaVersion: 1, runId, resultId: 'grounding',
    userContextSummary, pins: [{ source: 'design-revision', revision: '38' }], facetRefs: ['page_design', 'design_style'] },
  { schemaVersion: 1, inconsistencies: [{ id: 'GND-004', facets: ['page_design', 'design_style'], summary: detail,
    authoritativeReference: 'design_files/page_design/pages/detail.html', correction, affectedFacets: ['page_design', 'design_style'] }] })
  const previous = advice('previous', 'The layout uses a sidebar.', 'Change layout to standalone.')
  const current = advice('current', 'The HTML href ../tokens.css points to a missing file.', 'Use ../../design_style/tokens.css.')
  assert.equal(previous.items[0].id, current.items[0].id)
  assert.equal(previous.items[0].title, current.items[0].title)
  const authority = { actionReceipts: ['design_style', 'page_design'].map(skillName => ({
    actionId: `bundle:${skillName}`, receiptId: `exact-${skillName}`, state: 'ready',
    target: { kitName: 'fixture', kitVersion: '1.0', skillName, bundleVersion: '1.0', entityRefs: [current.items[0].id] },
  })) }
  const before = structuredClone(authority)
  const prompt = renderAdvisoryAcceptancePrompt(current, authority)
  assert.ok(prompt.includes(`advisoryId: ${JSON.stringify(current.id)}`))
  assert.ok(prompt.includes(current.acceptanceInstruction), 'reuse the exact server-bounded instruction')
  assert.match(prompt, /\.\.\/tokens\.css/)
  assert.match(prompt, /\.\.\/\.\.\/design_style\/tokens\.css/)
  assert.doesNotMatch(prompt, /Change layout to standalone|previous\/grounding/)
  for (const action of authority.actionReceipts) assert.ok(prompt.includes(`${action.target.skillName} · ${current.items[0].id} · receipt: ${action.receiptId}`))
  assert.deepEqual(authority, before, 'facts never mint, replace or retarget receipts')
  }
})

test('legacy acceptance without a server instruction still retains item facts and references', () => {
  const prompt = renderAdvisoryAcceptancePrompt({ id: 'exact/report', summary: 'Review finding',
    items: [{ id: 'reused-item', title: 'Generic title', detail: 'Repair only the CSS href.', rationale: 'Styles fail to load.', references: ['page_design/pages/detail.html'] }],
    actionSpec: { kind: 'none' } }, { actionReceipts: [] })
  for (const text of ['exact/report', 'reused-item', 'Repair only the CSS href.', 'Styles fail to load.', 'page_design/pages/detail.html']) assert.ok(prompt.includes(text))
  assert.match(prompt, /No Bundle action was authorized/)
})

test('DSH review-choice acceptance sends identity and selection steps, not the old no-Bundle fallback', () => {
  for (const summary of ['Clarify audience', '请澄清用户范围']) {
    const prompt = renderAdvisoryAcceptancePrompt({id:'review/result',summary,items:[],actionSpec:{kind:'review-choice'}},{actionReceipts:[]})
    assert.match(prompt,/review\/result/)
    assert.match(prompt,/design_read_review_action/)
    assert.match(prompt,/design_select_review_action/)
    assert.match(prompt,/review_support/)
    assert.doesNotMatch(prompt,/No Bundle action was authorized|没有可调用的 Bundle 授权/)
  }
})
test('ordinary zero-action and fixed-target prompts keep their previous semantics', () => {
  const advice={id:'fixed',summary:'Fix owner',items:[],actionSpec:{kind:'none'}}
  assert.match(renderAdvisoryAcceptancePrompt(advice,{actionReceipts:[]}),/No Bundle action was authorized/)
  const prompt=renderAdvisoryAcceptancePrompt({...advice,actionSpec:{kind:'bundle-targets'}},{actionReceipts:[{receiptId:'exact',target:{skillName:'owner',entityRefs:[]}}]})
  assert.match(prompt,/owner.*receipt: exact/)
  assert.doesNotMatch(prompt,/design_select_review_action/)
})
test('DSH remote projection preserves the durable selection through its real result schema', () => {
  const descriptor=TYPERT_REMOTE.descriptors.find(d=>d.method==='listAdvisories')
  assert.ok(descriptor)
  const selection={advisoryId:'review/result',acceptanceReceiptId:'accepted',kind:'host-question',reason:'Ask the user',actions:[],journalRevision:3}
  const parsed=descriptor.result.create().parse([{advisory:{id:'review/result'},status:'accepted',stale:false,selection}])
  assert.deepEqual(parsed[0].selection,selection)
})
