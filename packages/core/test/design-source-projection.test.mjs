import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { appendDesignSourceReferenceEdges } = await import('../src/design-source-projection.ts')
const { projectDesignGraph } = await import('../src/design-graph.ts')
const { parseSchemaYaml } = await import('../src/schema.ts')
const a='a'.repeat(40),b='b'.repeat(40)
const target='context/context.json',owner='capabilities/capabilities.json'
const schema=parseSchemaYaml(`type: object
properties:
  records:
    type: map
    value:
      type: object
      properties:
        text: { type: string }
        refs:
          type: map
          knowledge: { role: metadata, source_reference: true }
          value: { type: object }
`)
test('declared versioned locators produce source references, never metadata nodes or causal edges',async()=>{
  const source={records:{r1:{text:'Current changed evidence',secret:'Do not project this metadata'}}}
  const sourceSchema=parseSchemaYaml('type: object\nproperties:\n  records:\n    type: map\n    value:\n      type: object\n      properties:\n        text: { type: string }\n        secret: { type: string, knowledge: { role: metadata } }')
  const ref={file:target,pointer:'/records/r1/text',revision:a}
  const files={ [target]:source,[owner]:{records:{f1:{text:'Inspect evidence',refs:{one:ref,two:{...ref,pointer:'/records/r1/secret'},three:{...ref,pointer:'/records/missing'},four:{...ref,pointer:'/array/0'}}}}}}
  const schemas={[target]:sourceSchema,[owner]:schema}
  const graph=projectDesignGraph(files,b,schemas,{purpose:'storage'})
  let reads=0
  await appendDesignSourceReferenceEdges(graph,files,schemas,async revision=>{
    reads++
    return JSON.stringify(revision===a?{records:{r1:{text:'Original evidence',secret:'Hidden'},missing:{text:'Removed'}},array:[{text:'First'}]}:source)
  })
  const edges=graph.edges.filter(edge=>edge.id.startsWith('source-ref:'))
  assert.equal(edges.length,1)
  assert.equal(edges[0].relationType,'references'); assert.equal(edges[0].kind,'identifier-match')
  assert.equal(edges[0].reading.lifecycle,'observed')
  assert.equal(JSON.parse(edges[0].evidence).current,'changed')
  assert.ok(!graph.nodes.some(node=>node.pointer.includes('/refs')))
  assert.ok(graph.warnings.some(message=>message.includes('/two')),'metadata is not a valid current endpoint')
  assert.ok(graph.warnings.some(message=>message.includes('/three')))
  assert.ok(graph.warnings.some(message=>message.includes('/four')))
  assert.equal(reads,2,'one historical and one current read per source file, not one Git subprocess per reference')
})
test('source annotation remains opt-in and rejects inappropriate content/array declarations',()=>{
  for(const yaml of ['type: string\nknowledge: { role: metadata, source_reference: true }','type: map\nvalue: { type: object }\nknowledge: { role: content, granularity: container, source_reference: true }']) assert.throws(()=>parseSchemaYaml(yaml),/source_reference/)
})
