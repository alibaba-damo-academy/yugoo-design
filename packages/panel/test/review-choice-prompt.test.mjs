import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { renderAdvisoryAcceptancePrompt } = await import('../src/client/ported/design/AdvisoryReviewCard.tsx')
const { TYPERT_REMOTE } = await import('../../core/src/typert.remote-client.ts')

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
