import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { browserTransport, resolveBrowserAccess, browserMethods, browserRequestAllowed } from '../src/browser-access.mjs'

test('browser access defaults remain compatible and invalid modes fail closed', () => {
  assert.equal(resolveBrowserAccess(), 'token')
  assert.equal(resolveBrowserAccess('local'), 'local')
  for (const value of [false, true, null, '', 'off', 'LOCAL']) assert.throws(() => resolveBrowserAccess(value))
  for (const method of [
    'prepareBundle', 'registerNativeRun', 'finishNativeRun', 'beginMainBundle', 'finishMainBundle',
    'prepareReview', 'prepareReviews', 'bindReviewRun', 'bindReviewRuns', 'submitReview',
    'readReviewAction', 'selectReviewAction', 'claimReviewAction', 'settleReviewAction',
    'prepareContentUpgrade', 'readContentUpgradeDefinition', 'listContentUpgradeFiles',
    'readContentUpgradeFile', 'writeContentUpgradeFile', 'validateContentUpgrade',
    'finishContentUpgrade', 'recoverContentUpgrade', 'submitTrialInput',
    'prepareAutoPanel', 'submitAutoPanel', 'constructor',
  ]) {
    assert.equal(browserMethods.has(method), false, method)
  }
})

test('fresh local pages and refreshed pages need no browser storage or token', () => {
  const path = '/browser/' + '1'.repeat(32) + '/'
  const storage = { getItem() { throw Error('must not read storage') }, setItem() { throw Error('must not write storage') } }
  const expected = { endpoint: path + 'api', headers: { 'X-Design-Browser': '1' } }
  for (const search of ['', '?view=panel-only', '?view=full']) {
    assert.deepEqual(browserTransport({ pathname: path, hash: '', search }, storage), expected)
    assert.deepEqual(browserTransport({ pathname: path, hash: '#irrelevant', search }, undefined), expected)
  }
  assert.throws(() => browserTransport({ pathname: '/browser/stale/', hash: '' }, storage))
})

test('legacy token entry survives refresh and retains fragment when storage is unavailable', () => {
  let saved = ''
  const storage = { getItem: () => saved, setItem: (_key, value) => { saved = value } }
  const token = 'a'.repeat(64)
  assert.deepEqual(browserTransport({ pathname: '/', hash: '#' + token }, storage), {
    endpoint: '/api', headers: { 'X-Design-Token': token }, removeFragment: true,
  })
  assert.equal(browserTransport({ pathname: '/', hash: '' }, storage).headers['X-Design-Token'], token)
  assert.equal(browserTransport({ pathname: '/', hash: '#' + token }, undefined).removeFragment, false)
})


test('full and panel-only local views admit draft guards and Studio lifecycle operations', () => {
  const origin = 'http://127.0.0.1:32123'
  for (const view of ['full', 'panel-only']) {
    const transport = browserTransport(new URL(`${origin}/browser/${'2'.repeat(32)}/?view=${view}`))
    const headers = { origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin',
      ...Object.fromEntries(Object.entries(transport.headers).map(([key, value]) => [key.toLowerCase(), value])),
    }
    assert.equal(browserRequestAllowed(headers, origin), true, view)
    for (const method of [
      'observePanelDraft', 'savePanel', 'decideAdvisory',
      'studioKitFiles', 'studioKitFile', 'studioInstalledPreview',
      'studioInstanceList', 'studioInstanceRead', 'studioInstanceCopy', 'studioInstanceRename',
      'studioInstanceRemove', 'studioInstanceFile', 'studioInstanceSave', 'studioInstancePreview', 'studioInstanceMounts',
      'studioTrialAvailability', 'studioTrialStart', 'studioTrialList', 'studioTrialRead', 'studioTrialStop', 'studioTrialRemove',
      'studioContentExport', 'studioContentImport', 'studioContentImportRead',
      'studioContentImportList', 'studioContentImportAdopt',
    ]) assert.equal(browserMethods.has(method), true, `${view}: ${method}`)
    // Neither a view choice nor an extra native credential expands browser authority.
    headers['x-design-token'] = 'a'.repeat(64)
    assert.equal(browserMethods.has('submitTrialInput'), false, view)
    assert.equal(browserMethods.has('prepareContentUpgrade'), false, view)
    assert.equal(browserMethods.has('registerNativeRun'), false, view)
    for (const invalid of [{ origin: 'https://outside.invalid' }, { 'x-design-browser': '' },
      { 'content-type': 'text/plain' }, { 'sec-fetch-site': 'cross-site' }]) {
      assert.equal(browserRequestAllowed({ ...headers, ...invalid }, origin), false, `${view}: ${JSON.stringify(invalid)}`)
    }
  }
})

test('shared client RPCs remain reachable through the explicit browser allowlist', async () => {
  const client = await readFile(new URL('../src/client.tsx', import.meta.url), 'utf8')
  const methods = new Set([...client.matchAll(/\brpc(?:<[^>]*>)?\(\s*['"]([^'"]+)['"]/g)].map(match => match[1]))
  assert.ok(methods.has('savePanel') && methods.has('readWorkspace') && methods.has('sendPrompt'), 'client RPC extraction must include the shared project operations')
  assert.deepEqual([...methods].filter(method => !browserMethods.has(method)).sort(), [],
    'new browser UI operations need an explicit admission decision; native dispatcher methods are not automatically admitted')
})
