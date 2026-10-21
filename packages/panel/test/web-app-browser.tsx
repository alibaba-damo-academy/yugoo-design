/** Real DslPanel and save preparation, isolated from the user's project. */
import { useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DslPanel } from '../src/client/panels/dsl-panel.tsx'
import { prepareDeclarativePanelSave } from '../src/client/native-panel-registry.ts'
import '../src/visual-components.css'
import '@xyflow/react/dist/style.css'
import DESIGN_TW_CSS from '../src/client/generated/design.tw.css?inline'
import { DOCK_CSS } from '../src/client/styles.ts'
import { createPanelSaveBarrier } from '../src/panel-save-barrier.ts'

const name = new URLSearchParams(location.search).get('bundle') ?? 'smart_questions'
const locale = new URLSearchParams(location.search).get('locale') ?? 'zh-CN'
const fixture = await (await fetch(`/fixture?bundle=${encodeURIComponent(name)}`)).json()
// Test-only observation of the opaque preview. Production code does not accept
// artifact messages or grant the artifact a write callback.
window.addEventListener('message', event => {
  if (name === 'page_design') {
    const probe = window as unknown as { pageMessages?: unknown[] }
    probe.pageMessages ??= []
    probe.pageMessages.push({ ownFrame: event.source === document.querySelector<HTMLIFrameElement>('.dsh-live-preview iframe')?.contentWindow, data: event.data })
  }
  if (event.source === document.querySelector<HTMLIFrameElement>('.dsh-live-preview iframe')?.contentWindow && event.data?.probe === 'style-preview') {
    ;(window as unknown as { previewProbe: unknown }).previewProbe = event.data
  }
})
function App() {
  const [draft, setDraft] = useState(fixture.state)
  const currentDraft = useRef(draft); currentDraft.current = draft
  const editCount = useRef(0)
  ;(window as unknown as { declarativeTestDraft: unknown }).declarativeTestDraft = draft
  ;(window as unknown as { declarativeTestEditCount: number }).declarativeTestEditCount = editCount.current
  const barrier = useMemo(() => createPanelSaveBarrier(), [])
  const [readOnly, setReadOnly] = useState(false)
  const [message, setMessage] = useState('')
  const [artifactFiles, setArtifactFiles] = useState(fixture.artifactFiles)
  const [revision, setRevision] = useState('fixture-1')
  return <main style={{ height: '100vh', display: 'flex', flexDirection: 'column', font: '14px system-ui' }}>
    <style>{DESIGN_TW_CSS + DOCK_CSS}</style>
    <header style={{ padding: 12 }}>智能提问 · 声明式迁移验证</header>
    <div className="dsh-design-dock dsh-design-root" style={{ position: 'relative', width: '100%', flex: 1, minHeight: 0, border: 0 }}>
      <DslPanel key={name} locale={locale} skill={name} draft={draft} onChange={next => { editCount.current++; currentDraft.current = next; setDraft(next) }} panelYaml={fixture.panel}
        registerBeforeSave={flush => barrier.register(name, flush)}
        originalState={fixture.state} readArtifact={async path => (await fetch(`/text-artifact?path=${encodeURIComponent(path)}`)).json()}
        selectPanel={skill => setMessage(`navigate:${skill}`)}
        onSaveAndContinue={() => setMessage('save-and-continue-requested')}
        artifactFiles={artifactFiles} executionAttempts={fixture.executionAttempts}
        sourceRevision={revision}
        readExecutionLog={async (run, afterSeq) => (await fetch(`/execution-log?run=${encodeURIComponent(run)}&after=${afterSeq ?? ''}`)).json()}
        readOnly={readOnly} readBinaryArtifact={async path => (await fetch(`/artifact?path=${encodeURIComponent(path)}`)).json()} />
    </div>
    <footer style={{ padding: 12, display: 'flex', gap: 16 }}>
      <label><input type="checkbox" checked={readOnly} onChange={event => setReadOnly(event.target.checked)} />只读</label>
      {name === 'page_design' ? <button onClick={() => setRevision(value => value + '-next')}>更新版本</button> : null}
      {name === 'page_design' ? <>
        <button onClick={async () => {
          const result = await (await fetch('/external-style', { method: 'POST' })).json()
          setArtifactFiles(result.artifactFiles)
        }}>模拟共享样式更新</button>
        <button onClick={() => setDraft((value: typeof draft) => ({ ...value, pages: { ...value.pages, a: { ...value.pages.a, artifact_file: 'page_design/pages/a-next.html' } } }))}>切换产物</button>
        <button onClick={() => setDraft((value: typeof draft) => ({ ...value, pages: { a: value.pages.a }, page_order: ['a'] }))}>模拟外部删除目标</button>
      </> : null}
      {name === 'whiteboard' ? <button onClick={async () => {
        const result = await (await fetch('/external-canvas', { method: 'POST' })).json()
        setArtifactFiles(result.artifactFiles)
      }}>模拟外部场景更新</button> : null}
      <button onClick={async () => {
        await barrier.flush()
        const prepared = prepareDeclarativePanelSave(currentDraft.current)
        const response = await fetch('/save', { method: 'POST', body: JSON.stringify({ ...prepared, name }) })
        setMessage(response.ok ? '已保存' : await response.text())
      }}>保存</button><span role="status">{message}</span>
    </footer>
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)
