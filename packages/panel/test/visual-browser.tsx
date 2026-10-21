/** Actual declarative renderer; isolated test persistence, not a live DSH session. */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { parsePanelManifest } from '../../core/src/panel-dsl.ts'
import { renderManifest, applyDesignEditToDraft, applyPanelUpdatesToDraft, type DesignData } from '../src/interpreter.ts'
import '@xyflow/react/dist/style.css'
import '../src/visual-components.css'
import DESIGN_TW_CSS from '../src/client/generated/design.tw.css?inline'
import { DOCK_CSS } from '../src/client/styles.ts'

const fixture = await (await fetch('/fixture')).json()
const panels = Object.fromEntries(Object.entries(fixture.panels).map(([name, yaml]) => [name, parsePanelManifest(yaml as string)]))
const readArtifact = async (path: string) => (await fetch(`/artifact?path=${encodeURIComponent(path)}`)).json()
function App() {
  const [states, setStates] = useState(fixture.states)
  const [name, setName] = useState<string>(fixture.initialName)
  const [readonly, setReadonly] = useState(false)
  const [message, setMessage] = useState('')
  const [locale, setLocale] = useState('zh-CN')
  const [edits, setEdits] = useState(0)
  const manifest = panels[name]!
  ;(window as any).visualTest = { states, name, locale, edits }
  return <main style={{ padding: 20, font: '14px system-ui', color: '#263044', maxWidth: 1400, margin: 'auto' }}>
    <header style={{ display: 'flex', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
      <button aria-label="切换测试语言" onClick={() => setLocale(old => old === 'zh-CN' ? 'en-US' : 'zh-CN')}>{locale === 'zh-CN' ? 'English' : '中文'}</button>
      {Object.entries(fixture.labels as Record<string, string>).map(([id, label]) =>
        <button key={id} aria-label={label} onClick={() => setName(id)}>{label}</button>)}
      <label><input type="checkbox" checked={readonly} onChange={event => setReadonly(event.target.checked)} />只读</label>
      <button aria-label="保存测试文件" onClick={async () => {
        setMessage('正在保存')
        const response = await fetch('/save', { method: 'POST', body: JSON.stringify({ name, state: states[name] }) })
        setMessage(response.ok ? '已保存并通过校验' : await response.text())
      }}>保存测试文件</button><span role="status">{message}</span>
    </header>
    <style>{DESIGN_TW_CSS + DOCK_CSS}</style>
    <div className="dsh-design-dock dsh-design-root" style={{ position: 'relative', width: '100%', height: 'calc(100vh - 90px)', border: 0 }}>
    <div key={name} className="dsh-design-dock-panel-workspace" style={{height: '100%'}}>{renderManifest(manifest, states[name] as DesignData, {
      editable: !readonly,
      locale,
      readArtifact, artifactFiles: fixture.artifactFiles,
      panelData: (bundle, section) => states[bundle]?.[section] ?? {},
      onEdit: edit => { setEdits(old => old + 1); setStates((old: any) => ({ ...old, [name]: applyDesignEditToDraft(old[name], manifest, edit) })) },
      onPanelUpdate: updates => { setEdits(old => old + 1); setStates((old: any) => ({ ...old, [name]: applyPanelUpdatesToDraft(old[name], updates) })) },
    })}</div>
    </div>
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)
