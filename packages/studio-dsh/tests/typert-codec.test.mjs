/** Source-level boundary checks; official registry/Gateway acceptance is separate. */
import assert from 'node:assert/strict'
import test from 'node:test'
import core from '../../core/src/typert.remote-client.ts'
import coreHost from '../../core/src/typert.host.ts'
import studio from '../src/typert.remote-client.ts'
import studioHost from '../src/typert.host.ts'
import { STUDIO_AUTHORING_REMOTE } from '../src/authoring.remote-client.ts'
import { createSameOriginStudioRemote } from '../src/page-rpc.ts'

function codecs(contribution) {
  return contribution.descriptors.flatMap(descriptor => [descriptor.result, ...descriptor.parameters.map(parameter => parameter.codec)])
}

test('Core and Studio share their strict factories between Host and Client', () => {
  for (const [remote, host, expectedCount] of [[core, coreHost, 55], [studio, studioHost, 21]]) {
    assert.equal(host.package, remote.package)
    const expectedInvocations = remote === studio
      ? [...studio.descriptors, ...STUDIO_AUTHORING_REMOTE.descriptors] : remote.descriptors
    assert.equal(host.invocations.length, expectedInvocations.length)
    expectedInvocations.forEach((descriptor, index) => assert.equal(host.invocations[index], descriptor))
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

test('installed preview factories reject workspace metadata and the page carrier preserves exact pins', async () => {
  const kit = { name: 'evidence', version: '2.0' }, bundle = { name: 'observations', version: '1.0' }
  const calls = []
  const remote = createSameOriginStudioRemote(async (_url, init) => {
    const request = JSON.parse(init.body)
    calls.push(request)
    return new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId,
      result: { ok: true, value: { diagnostics: [] } } }))
  })
  const input = { kit, bundle, revision: 0 }
  const descriptor = studio.descriptors.find(item => item.method === 'previewInstalled')
  const requestSchema = descriptor.parameters[0].codec.create()
  assert.deepEqual(requestSchema.parse(input), input)
  assert.deepEqual(await remote.previewInstalled(input), { ok: true, value: { diagnostics: [] } })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].payload.args.request, input)
  for (const invalid of [
    { ...input, kit: { ...kit, description: 'Readable catalog metadata', mounts: [], resources: [] } },
    { ...input, bundle: { ...bundle, title: { en: 'Observations' } } },
    { ...input, kit: { name: kit.name } },
  ]) {
    assert.throws(() => requestSchema.parse(invalid), /unrecognized|invalid|expected/iu)
  }
})
