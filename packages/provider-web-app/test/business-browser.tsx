/** Browser fixture loads the real packaged native provider, not copied UI. */
import React, { useEffect, useState } from 'react'
import * as jsx from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import { createRoot } from 'react-dom/client'
import initial from '../../skills-web-app/bundles/business_data/reference/example.json'
/** Test-only multi-parent topology with long names; the frozen reference example stays untouched. */
const diamond = (() => {
  const obj = (id: string, name: string, description: string) => ({id, name, description, fields:{}, field_order:[], states:{}, state_order:[]})
  const order = ['document', 'sale-document', 'purchase-document', 'settlement-summary', 'counterparty']
  const objects: Record<string, unknown> = {
    'document': obj('document', '业务单据（长名称用于检验侧边栏换行）', '所有单据共享的父类型，维护编号与金额等公共信息。'),
    'sale-document': obj('sale-document', '销售类业务单据', '面向客户开出的单据，继承业务单据的公共信息。'),
    'purchase-document': obj('purchase-document', '采购类业务单据（名称较长）', '面向供应商收到的单据，继承业务单据的公共信息。'),
    'settlement-summary': obj('settlement-summary', '购销结算汇总单据', '同时属于销售类与采购类单据，用于双向结算汇总。'),
    'counterparty': obj('counterparty', '往来单位', '与客户或供应商往来的单位主体。'),
  }
  const relations: Record<string, unknown> = {
    'gen-sale': {id:'gen-sale', kind:'generalization', name:'是一种', source:'sale-document', target:'document'},
    'gen-purchase': {id:'gen-purchase', kind:'generalization', name:'是一种', source:'purchase-document', target:'document'},
    'gen-summary-sale': {id:'gen-summary-sale', kind:'generalization', name:'是一种', source:'settlement-summary', target:'sale-document'},
    'gen-summary-purchase': {id:'gen-summary-purchase', kind:'generalization', name:'是一种', source:'settlement-summary', target:'purchase-document'},
    'assoc-counterparty': {id:'assoc-counterparty', kind:'association', name:'对应一个往来单位并参与长期对账（关系名较长）', source:'settlement-summary', target:'counterparty', source_count:'0..*', target_count:'1..*', description:'汇总单据可对应多个往来单位。'},
    'assoc-unknown': {id:'assoc-unknown', kind:'association', name:'关联单据', source:'counterparty', target:'document', description:'数量尚未确定。'},
  }
  return {schema_version: 3, object_order: order, objects, relations}
})()
/** Test-only cycle topology: self-association plus a two-node association cycle must not stretch columns. */
const cyclic = (() => {
  const obj = (id: string, name: string, description: string) => ({id, name, description, fields:{}, field_order:[], states:{}, state_order:[]})
  const order = ['loop-a', 'loop-b', 'solo', 'parent']
  const objects: Record<string, unknown> = {
    'loop-a': obj('loop-a', '循环甲', '与循环乙互相关联，并自关联。'),
    'loop-b': obj('loop-b', '循环乙', '与循环甲互相关联。'),
    'solo': obj('solo', '独立对象', '不参与任何关系。'),
    'parent': obj('parent', '父类型', '继承链上的父类型。'),
  }
  const relations: Record<string, unknown> = {
    'self-a': {id:'self-a', kind:'association', name:'自关联', source:'loop-a', target:'loop-a'},
    'a-b': {id:'a-b', kind:'association', name:'关联乙', source:'loop-a', target:'loop-b'},
    'b-a': {id:'b-a', kind:'association', name:'关联甲', source:'loop-b', target:'loop-a'},
    'gen-solo-parent': {id:'gen-solo-parent', kind:'generalization', name:'是一种', source:'solo', target:'parent'},
  }
  return {schema_version: 3, object_order: order, objects, relations}
})()
const topo = new URLSearchParams(location.search).get('topo')
const fixture: any = topo === 'diamond' ? diamond : topo === 'cycle' ? cyclic : initial
const definitions = new Map<string, any>()
const platform: Record<string, unknown> = {react: React, 'react/jsx-runtime': jsx, 'react-dom': ReactDOM}
;(window as any).__ModuleLoader__ = {load({factory}: any) {
  factory((id: string) => {if (!(id in platform)) throw new Error(`Unsupported module: ${id}`); return platform[id]}).apply({effect: (fn: () => void) => fn(), designNativePanels: {
    register(definition: any) {definitions.set(definition.id, definition); return () => {}},
  }})
  createRoot(document.getElementById('root')!).render(<App />)
}}
/**
 * `?storm` reproduces the host re-render pressure that blanked the live canvas:
 * a fresh render every 40ms plus a full draft identity rebuild every 500ms.
 */
const storm = new URLSearchParams(location.search).has('storm')
/**
 * `?blind=<ms>` hides the whole panel for a while: measurement can never land, which is
 * the only way to hold React Flow in the uninitialized state. Distinguishes the old
 * dimension-dropping canvas (stays blank after un-blinding) from the fixed one.
 */
const blindMs = Number(new URLSearchParams(location.search).get('blind') ?? 0)
const probe = () => {
  const wrappers = [...document.querySelectorAll<HTMLElement>('.react-flow__node')]
  const draft = (window as any).businessTest.draft
  return {
    nodes: wrappers.length,
    hidden: wrappers.filter(element => getComputedStyle(element).visibility === 'hidden').length,
    edgePaths: document.querySelectorAll('.react-flow__edge-path').length,
    objects: Object.keys(draft?.objects ?? {}).length,
    relations: Object.keys(draft?.relations ?? {}).length,
  }
}
const openCanvas = () => document.querySelector<HTMLButtonElement>('[aria-label="展开业务对象关系画布"]')?.click()
function App() {
  const [draft, setDraft] = useState(fixture), [saved, setSaved] = useState(fixture), [running, setRunning] = useState(false)
  const [blind, setBlind] = useState(blindMs > 0)
  useEffect(() => {
    if (!storm) return
    const tick = setInterval(() => setDraft(previous => ({...previous})), 40)
    const rebuild = setInterval(() => setDraft(previous => structuredClone(previous)), 500)
    return () => {clearInterval(tick); clearInterval(rebuild)}
  }, [])
  useEffect(() => {
    if (!blind) return
    const timer = setTimeout(() => setBlind(false), blindMs)
    return () => clearTimeout(timer)
  }, [blind])
  ;(window as any).businessTest = {draft, saved, running, storm, blind, probe, openCanvas, definitionCount: definitions.size, topo: fixture === diamond ? 'diamond' : fixture === cyclic ? 'cycle' : 'example'}
  const definition = definitions.get('io.deepseek.design.web-app.business-data/v1')
  return <main className='dsh-design-root' style={{height:'100vh',display:blind?'none':'flex',flexDirection:'column',background:'#fff'}}>
    <header style={{padding:12,borderBottom:'1px solid #ddd'}}>隔离测试 · 业务对象
      <button onClick={() => setSaved(structuredClone(draft))}>保存 fixture</button>
      <button onClick={() => setDraft(structuredClone(saved))}>重开 fixture</button>
      <button onClick={() => setRunning(!running)}>切换运行锁</button>
    </header>
    {definition.render({draft,onChange:setDraft,originalState:saved,running,skill:'business_data',sendPrompt:()=>{},selectPanel:()=>{},panelData:()=>({}),readArtifact:async()=>({found:false,content:''}),readBinaryArtifact:async()=>({found:false,base64:'',mediaType:'image/png'})})}
  </main>
}
