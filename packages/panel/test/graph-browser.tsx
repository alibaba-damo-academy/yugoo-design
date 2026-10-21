/** Real GraphPanel with an isolated read-only transport; not host E2E. */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { GraphPanel } from '../src/client/graph-panel.tsx'
import { complexGraph } from './graph-complex-fixture.mjs'
const nodes = [
  { id: 'a', label: '活动安排', file: 'event/event.json', pointer: '/plan', context: '{"title":"活动安排","role_ref":"host"}', owner: 'event' },
  { id: 'b', label: '现场协调', file: 'event/event.json', pointer: '/plan/coordination', context: '主持人协调签到和活动进度', owner: 'event' },
  { id: 'd', label: '确认到场人数再开始', file: 'event/event.json', pointer: '/plan/coordination/rule', context: '到场人数需要先由主持人确认', owner: 'event' },
  { id: 'c', label: '主持人职责', file: 'roles/roles.json', pointer: '/roles/host', context: '{"id":"host","responsibility":"协助签到"}', owner: 'roles' },
  { id: 'e', label: '组织签到与确认到场', file: 'roles/roles.json', pointer: '/roles/host/responsibility', context: '组织签到与确认到场', owner: 'roles' },
]
const read = async () => ({ content: JSON.stringify({ checkpoint: 'fixture-commit', nodes: nodes.map(n => ({ ...n, record: ['a','c'].includes(n.id), recordId: ['c','e'].includes(n.id) ? 'c' : 'a' })), edges: [
  { id: 'ab', from: 'a', to: 'b', kind: 'contains', label: '包含', evidence: 'event/event.json#/plan/role_ref' },
  { id: 'bd', from: 'b', to: 'd', kind: 'contains', label: '包含', evidence: 'event/event.json#/plan/coordination/rule' },
  { id: 'ce', from: 'c', to: 'e', kind: 'contains', label: '包含', evidence: 'roles/roles.json#/roles/host/responsibility' },
  { id: 'bc', from: 'b', to: 'c', kind: 'identifier-match', label: '标识符匹配（非业务确认）', evidence: 'role_ref = host；不表示业务规则已确认' },
  { id: 'de', from: 'd', to: 'e', kind: 'identifier-match', label: '标识符匹配（非业务确认）', evidence: '签到确认规则对应主持人的到场确认职责' },
], warnings: ['隔离浏览器测试，非用户项目；无 embedding。'] }) })
const large = async () => ({ content: JSON.stringify({ checkpoint: 'large', warnings: [], edges: [], nodes: Array.from({ length: 200 }, (_, i) => ({ id: 'record' + i, label: 'record' + i, file: 'sample/sample.json', pointer: '/' + i, context: '', owner: 'sample', record: true })) }) })
const heavy = async () => {
  const graph = { checkpoint: 'heavy', warnings: [], nodes: [] as any[], edges: [] as any[] }
  for (let i = 0; i < 265; i++) for (let j = 0; j < 8; j++) {
    graph.nodes.push({ id: `${i}-${j}`, recordId: `${i}-0`, record: j === 0, owner: 'bundle' + i % 10, file: 'fixture.json', pointer: '/' + i + '/' + j, label: `Record ${i} Field ${j}`, context: 'Synthetic performance fixture' })
    if (j) graph.edges.push({ id: `${i}-${j}`, from: `${i}-0`, to: `${i}-${j}`, kind: 'contains', label: '包含', evidence: 'fixture' })
    if (i && j === 0) graph.edges.push({ id: `link${i}`, from: `${i}-0`, to: `${i-1}-0`, kind: 'semantic', label: '候选', evidence: 'fixture' })
  }
  return { content: JSON.stringify(graph) }
}
let statusReads = 0
const statusRead = async () => {
  const graph = JSON.parse((await read()).content)
  graph.warnings = ['Knowledge 暂不可用，保留文件结构图。']
  graph.semantic = { state: ++statusReads < 2 ? 'indexing' : 'ready', cache: 'memory', model: 'fixture', completed: 2, total: 2, message: '测试状态' }
  return { content: JSON.stringify(graph) }
}
/** Synthetic contract test; not evidence that the example's domain claims are true. */
const readingRead = async () => {
  const graph = JSON.parse((await read()).content)
  for (const edge of graph.edges) edge.reading = edge.kind === 'contains'
    ? { relationType:'contains', meaning:'contains', origin:'file', direction:'forward', lifecycle:'observed' }
    : { relationType:'identifier-match', meaning:'references', origin:'file', direction:'forward', lifecycle:'proposed' }
  graph.edges.push(
    { id:'interpretation', from:'a', to:'c', kind:'knowledge', label:'活动安排支持主持人协调', evidence:'two-endpoint-saved-evidence', reading:{relationType:'supports',meaning:'supports',origin:'agent',direction:'forward',lifecycle:'proposed'} },
    { id:'candidate', from:'a', to:'c', kind:'semantic', label:'内容相似候选', evidence:'embedding-recall-evidence', reading:{relationType:'semantic-similarity',meaning:'similar',origin:'embedding',direction:'symmetric',lifecycle:'proposed'} },
    { id:'legacy', from:'a', to:'c', kind:'knowledge', label:'旧关系未声明语义', evidence:'legacy-evidence' },
  )
  return {content:JSON.stringify(graph)}
}
const complexRead = async () => ({ content: JSON.stringify(complexGraph()) })
const liveFixture = { state: 'current', phase: undefined as string | undefined, head: 'v1', published: 'v1', equivalent: false, graphReads: 0, statusReads: 0, failStatus: false, failGraphRead: false }
const liveGraphRead = async () => {
  liveFixture.graphReads++
  if (liveFixture.failGraphRead) throw new Error('temporary graph read failure')
  const graph = JSON.parse((await read()).content)
  return { content: JSON.stringify({ ...graph, projectId: 'fixture-project', knowledgeRevision: liveFixture.published,
    knowledgeStatus: liveFixture.state, freshness: { sourceCheckpoint: liveFixture.head, indexedCheckpoint: liveFixture.published } }) }
}
const liveStatusRead = async () => {
  liveFixture.statusReads++
  if (liveFixture.failStatus) throw new Error('temporary status read failure')
  return { schemaVersion: 1 as const, project: 'fixture-project' as any, head: liveFixture.head,
    state: liveFixture.state as any, ...(liveFixture.phase ? { phase: liveFixture.phase as any } : {}),
    freshness: liveFixture.head === liveFixture.published || liveFixture.equivalent ? 'matching' as const : 'different' as const,
    latestComplete: { checkpoint: liveFixture.published, revision: liveFixture.published, warningCount: 0 }, semanticLayer: 'enabled' as const }
}
let releaseSlowRead: (() => void) | undefined
const slowRead = async () => {
  await new Promise<void>(resolve => { releaseSlowRead = resolve })
  return read()
}
;(window as any).releaseGraphRead = () => releaseSlowRead?.()
;(window as any).graphLiveFixture = liveFixture
const live = location.search.includes('live-status')
const load = location.search.includes('slow-read') ? slowRead : live ? liveGraphRead : location.search.includes('complex') ? complexRead : location.search.includes('reading') ? readingRead : location.search.includes('heavy') ? heavy : location.search.includes('status') ? statusRead : location.search.includes('large') ? large : location.search.includes('real') ? async () => ({ content: await (await fetch('/graph.json')).text() }) : read
createRoot(document.getElementById('root')!).render(<GraphPanel read={load} readStatus={live ? liveStatusRead : undefined} footer={<nav>设计文件 · 场景体验 · 关联图谱</nav>} />)
