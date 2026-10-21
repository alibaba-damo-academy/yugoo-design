/** Source-level boundary checks; official registry/Gateway acceptance is separate. */
import assert from 'node:assert/strict'
import test from 'node:test'
import core from '../../core/src/typert.remote-client.ts'
import coreHost from '../../core/src/typert.host.ts'
import studio from '../src/typert.remote-client.ts'
import studioHost from '../src/typert.host.ts'
import { createSameOriginStudioRemote } from '../src/page-rpc.ts'

function codecs(contribution) {
  return contribution.descriptors.flatMap(descriptor => [descriptor.result, ...descriptor.parameters.map(parameter => parameter.codec)])
}

test('Core and Studio share their strict factories between Host and Client', () => {
  for (const [remote, host, expectedCount] of [[core, coreHost, 49], [studio, studioHost, 19]]) {
    assert.equal(host.package, remote.package)
    assert.equal(host.invocations, remote.descriptors)
    assert.equal(codecs(remote).length, expectedCount)
    for (const codec of codecs(remote)) {
      assert.equal(codec.mode, 'strict')
      assert.equal(typeof codec.typeSymbol, 'string')
      assert.equal(Object.hasOwn(codec, 'schema'), false, 'the descriptor has one factory contract')
      assert.equal(typeof codec.create, 'function')
      assert.equal(typeof codec.create().parse, 'function', codec.typeSymbol)
    }
  }
})

test('only existing optional Studio versions permit absent wire fields', () => {
  const absent = []
  for (const descriptor of studio.descriptors) {
    for (const parameter of descriptor.parameters) {
      const schema = parameter.codec.create()
      assert.equal(parameter.acceptsUndefined === true, schema.safeParse(undefined).success)
      if (parameter.acceptsUndefined) {
        absent.push(`${descriptor.method}/${parameter.name}`)
        assert.equal(schema.parse('1.0'), '1.0')
        assert.equal(schema.safeParse(null).success, false)
        assert.equal(schema.safeParse(1).success, false)
      }
    }
  }
  assert.deepEqual(absent, ['readBundleWorkspace/version', 'readBundleFile/version'])
})

test('same-origin Studio reads consume the factory and retain strict result validation', async () => {
  const value = { query: '', kits: [], bundles: [] }
  const transport = supplied => async (_url, init) => {
    const request = JSON.parse(init.body)
    return new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: supplied } }))
  }
  assert.deepEqual(await createSameOriginStudioRemote(transport(value)).workspace(''), { ok: true, value })
  await assert.rejects(createSameOriginStudioRemote(transport({ ...value, extra: true })).workspace(''), /unrecognized|extra/iu)
  await assert.rejects(createSameOriginStudioRemote(transport({ query: '' })).workspace(''), /required|invalid/iu)
})
