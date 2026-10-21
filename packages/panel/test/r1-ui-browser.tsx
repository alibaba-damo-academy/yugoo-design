/** Synthetic shared-renderer fixture. No native Host, Agent or user storage. */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { renderManifest, applyPanelUpdatesToDraft } from '../src/interpreter.ts'
import '../src/visual-components.css'
import '../src/panel-content-state.css'
import '@xyflow/react/dist/style.css'

const fixture = await (await fetch('/fixture')).json()
const reads: string[] = []
const readArtifact = async (path: string) => {
  reads.push(path)
  return (await fetch(`/artifact?path=${encodeURIComponent(path)}&call=${reads.length}`)).json()
}
const readExecutionLog = async () => ({ found: true, revision: 1, reset: true, entries: [
  { seq: 1, timestamp: 0, eventType: 'search' as const, message: 'Synthetic exact-artifact search record.' },
] })
function App() {
  const [name, setName] = useState('research')
  const [data, setData] = useState(fixture.states)
  const [width, setWidth] = useState(1040)
  const [readonly, setReadonly] = useState(false)
  const [locale, setLocale] = useState('en-US')
  ;(window as any).r1UI = { data, name, width, reads, setWidth, setReadonly, setLocale }
  return <main style={{ font: '14px/1.6 system-ui', padding: 8 }}>
    <nav>{['research', 'roles'].map(key => <button key={key} onClick={() => setName(key)}>{key}</button>)}</nav>
    <div id="panel-frame" style={{ width, maxWidth: '100%', height: 820, border: '1px solid #ddd', marginTop: 8 }}>
      {renderManifest(fixture.panels[name], data[name], { skill: 'research', locale, editable: !readonly,
        readArtifact, artifactFiles: fixture.artifactFiles, readExecutionLog,
        artifactActivities: fixture.activities,
        onPanelUpdate: updates => setData((previous: any) => ({ ...previous, [name]: applyPanelUpdatesToDraft(previous[name], updates) })),
      })}
    </div>
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)
