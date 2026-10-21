import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { readDesignSourceReference, validateDesignSourceReference, validateDesignSourceReferenceSubject } = await import('../src/design-source-reference.ts')
const a = 'a'.repeat(40), b = 'b'.repeat(40)
const file = 'fixture/fixture.json'
const past = { records: { 'p/~': { text: 'A' } }, order: ['p/~', 'other'],
  anonymous: [{ scenario: 'A', handling: 'First' }, { scenario: 'B', handling: 'Second' }],
  identified: [{ id: 'x', text: 'X' }, { id: 'y', text: 'Y' }] }
const now = structuredClone(past)
now.order.reverse(); now.anonymous.reverse(); now.identified.reverse()
const reader = async revision => JSON.stringify(revision === a ? past : now)

test('map keys and escaped pointers survive unrelated sorting without positional guesses', async () => {
  const result = await readDesignSourceReference({ file, revision: a, pointer: '/records/p~1~0/text' }, b, reader)
  assert.equal(result.current, 'matching')
  assert.equal(result.currentValue, 'A')
  const updated = structuredClone(now); updated.records['p/~'].text = 'Later user intent'
  const changed = await readDesignSourceReference({ file, revision: a, pointer: '/records/p~1~0/text' }, b,
    async revision => JSON.stringify(revision === a ? past : updated))
  assert.equal(changed.current, 'changed')
  assert.equal(changed.historicalValue, 'A')
  assert.equal(changed.currentValue, 'Later user intent')
})

test('both anonymous and identified arrays are honestly historical-only in v1', async () => {
  for (const pointer of ['/anonymous/0', '/identified/0']) {
    const result = await readDesignSourceReference({ file, revision: a, pointer }, b, reader)
    assert.equal(result.current, 'historical-only')
    assert.equal(result.currentValue, undefined)
  }
})

test('deleted targets retain history; missing histories do not authorize a guessed current edge', async () => {
  const result = await readDesignSourceReference({ file, revision: a, pointer: '/records/p~1~0' }, b,
    async revision => revision === a ? JSON.stringify(past) : '{}')
  assert.equal(result.historical, 'found'); assert.equal(result.current, 'missing')
  const missing = await readDesignSourceReference({ file, revision: a, pointer: '/records/p~1~0' }, b, async () => undefined)
  assert.equal(missing.historical, 'missing'); assert.equal(missing.current, 'historical-only')
})

test('format/path violations fail before reading, and invalid JSON is not an empty record', async () => {
  for (const reference of [
    ...['../escape.json', '/etc/passwd', 'C:/outside.json', 'C:outside.json', 'fixture/../../etc/passwd', 'fixture\\\\escape.json', 'fixture/\u0000.json', '.git/config', 'fixture/.git/config'].map(file => ({ file, revision: a })),
    { file, revision: 'HEAD' },
    { file, revision: a, pointer: '/wrong~2escape' }, { file: 'fixture/note.md', revision: a, pointer: '/x' },
  ]) assert.throws(() => validateDesignSourceReference(reference))
  const result = await readDesignSourceReference({ file, revision: a, pointer: '' }, b, async () => '{broken')
  assert.equal(result.historical, 'unreadable')
  const controller = new AbortController(); controller.abort()
  await assert.rejects(readDesignSourceReference({ file, revision: a }, b, reader, controller.signal), /abort/i)
})

test('subject pointers resolve only in the owning record and cannot guess array identity', () => {
  const reference = { file, revision: a, pointer: '/records/p~1~0', subject_pointer: '/details/behaviors/B-1' }
  assert.doesNotThrow(() => validateDesignSourceReferenceSubject(reference, { details: { behaviors: { 'B-1': { description: 'Find evidence' } } } }))
  assert.throws(() => validateDesignSourceReferenceSubject(reference, past), /owning record/)
  assert.throws(() => validateDesignSourceReferenceSubject({ ...reference, subject_pointer: '/anonymous/0' }, past), /positional array/)
})
