/** Isolated UI fixture using the packaged native provider, not copied components. */
import React, { useState } from 'react'
import * as jsx from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import { createRoot } from 'react-dom/client'
const definitions = new Map<string, any>()
const platform: Record<string, unknown> = { react: React, 'react/jsx-runtime': jsx, 'react-dom': ReactDOM }
;(window as any).__ModuleLoader__ = { load({ factory }: any) {
  const plugin = factory((id: string) => { if (!(id in platform)) throw new Error(`Unsupported module: ${id}`); return platform[id] })
  plugin.apply({ effect: (fn: () => void) => fn(), designNativePanels: {
    register(definition: any) { definitions.set(definition.id, definition); return () => {} },
  } })
  createRoot(document.getElementById('root')!).render(<App />)
} }
const initial = { functions: { 'F-1': { function_id:'F-1',function_name:'论点证据追溯',function_description:'查看论点所依据的文献摘录和个人笔记。',function_epic:'文献与知识',priority:'High',rejected:false,source:'ai',reason:'回应写综述时难以找到原文依据的困难；仍为可调整的功能提案。',
  details:{purpose:'让研究者找到论点对应的已有依据。',behaviors:{'B-1':{description:'选择论点后查看已有文献摘录及关联笔记。'}},exceptions:{'E-1':{condition:'关联原文无法读取。',response:'保留来源标识，告知原文暂不可读，不显示虚构摘录。'}}},
  references:{'R-1':{file:'context/context.json',revision:'a'.repeat(40),pointer:'/records/r1',note:'用户描述的实际困难'}} } } }
function App() {
  const [draft,setDraft]=useState(initial),[original,setOriginal]=useState(initial)
  const definition=definitions.get('io.deepseek.design.web-app.function-modules/v2')
  ;(window as any).functionTest={draft,definitionCount:definitions.size}
  return <main className='dsh-design-root' style={{height:'100vh',display:'flex',flexDirection:'column',background:'#fff'}}>
    <header style={{padding:12,borderBottom:'1px solid #ddd'}}>隔离测试 · 功能详情
      <button onClick={()=>setOriginal(structuredClone(draft))}>保存 fixture</button>
      <button onClick={()=>setDraft(structuredClone(original))}>重开 fixture</button>
    </header>
    {definition.render({draft,onChange:setDraft,originalState:original,running:false,skill:'function_modules',sendPrompt:()=>{},selectPanel:()=>{},panelData:()=>({}),onAction:undefined,
      sourceRevision:'b'.repeat(40),readArtifact:async (_path:string,revision?:string)=>({found:true,content:JSON.stringify({records:{r1:revision==='a'.repeat(40)?'过去：整理综述时找不到依据。':'现在：重点是核验原文，不只是找到链接。'}})}),readBinaryArtifact:async()=>({found:false,base64:'',mediaType:'image/png'})})}
  </main>
}
