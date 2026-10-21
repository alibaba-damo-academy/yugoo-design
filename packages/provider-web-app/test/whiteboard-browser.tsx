/** Isolated test harness: load the production DSH factory, never source Panels. */
import React, { useState } from 'react'
import * as jsx from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import { createRoot } from 'react-dom/client'

const definitions = new Map<string, any>()
const platform: Record<string, unknown> = { react: React, 'react/jsx-runtime': jsx, 'react-dom': ReactDOM }
;(window as any).__ModuleLoader__ = { load({ factory }: any) {
  const plugin = factory((id: string) => {
    if (!(id in platform)) throw new Error(`Unsupported DSH module: ${id}`)
    return platform[id]
  })
  plugin.apply({ effect: (fn: () => void) => fn(), designNativePanels: {
    register(definition: any) { definitions.set(definition.id, definition); return () => {} },
  } })
  createRoot(document.getElementById('root')!).render(<App />)
} }
const readDisk = () => JSON.parse(localStorage.getItem('whiteboard-test') ?? '{"state":{"boards":{},"board_order":[]},"files":{}}')
let disk = readDisk()
const readArtifact = async (path: string) => ({ found: path in disk.files, content: disk.files[path]?.content ?? '' })
const readBinaryArtifact = async (path: string) => ({ found: path in disk.files, base64: disk.files[path]?.content ?? '', mediaType: 'image/png' })
function App() {
  const [original, setOriginal] = useState(disk.state)
  const [draft, setDraft] = useState(disk.state)
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const definition = definitions.get('io.deepseek.design.web-app.whiteboard/v1')
  ;(window as any).whiteboardTest = { draft, disk, definitionCount: definitions.size }
  return <div style={{height:'100vh',display:'flex',flexDirection:'column'}}>
    <div><button onClick={() => {
      try {
        const saved = definition.prepareSave(draft)
        for (const file of saved.artifacts ?? []) disk.files[file.path] = file
        disk.state = saved.state
        localStorage.setItem('whiteboard-test', JSON.stringify(disk))
        setOriginal(saved.state); setDraft(saved.state); setRevision(n => n + 1); setError('')
      } catch (e) { setError(String(e)) }
    }}>保存测试文件</button><button onClick={() => setDraft(original)}>取消编辑</button>
    <button onClick={() => {
      const path = draft.boards[draft.board_order[0]]?.artifact_file
      if (!disk.files[path]) return
      const scene = JSON.parse(disk.files[path].content)
      scene.appState.viewBackgroundColor = scene.appState.viewBackgroundColor === '#ffeecc' ? '#ccffee' : '#ffeecc'
      disk.files[path] = { ...disk.files[path], content: JSON.stringify(scene) }
      setRevision(n => n + 1)
    }}>模拟 AI 文件更新</button><span role="status">{draft === original ? '已保存' : '未保存'}</span>{error && <p role="alert">{error}</p>}</div>
    <div className="dsh-design-root" style={{flex:1,minHeight:0}}>{definition.render({draft,originalState:original,onChange:setDraft,
      artifactFiles:Object.fromEntries(Object.entries(disk.files).map(([path, file]: any) => [path,file.content])),
      readArtifact,readBinaryArtifact,running:false, revision,
      sendPrompt: () => { throw new Error('Whiteboard must not offer a separate prompt input') },
    })}</div>
  </div>
}
const script = document.createElement('script'); script.src = '/provider.js'; document.head.appendChild(script)
