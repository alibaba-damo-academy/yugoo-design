/** Isolated browser acceptance for the product's generated-manifest interpreter. */
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { renderManifest, applyDesignEditToDraft, type DesignData } from '../src/interpreter.ts'
import type { PanelManifest } from '../../core/src/panel-dsl.ts'
import DESIGN_TW_CSS from '../src/client/generated/design.tw.css?inline'
import VISUAL_COMPONENTS_CSS from '../src/visual-components.css?inline'
import { DOCK_CSS } from '../src/client/styles.ts'
import { AutoPanelNotice } from '../src/auto-panel-notice.tsx'

type Fixture = { manifest: PanelManifest; state: DesignData; origin?: 'generated' | 'retained'; sourceChanged?: boolean;
  definitionRevision?: string; sourceRevision?: string; projectId?: string; skill?: string }

function App() {
  const [locale, setLocale] = useState<'zh-CN' | 'en-US'>('zh-CN')
  const previewOnly = ['?case=records', '?case=plain-records', '?case=report'].includes(location.search)
  const [fixture, setFixture] = useState<Fixture | null>(null)
  const [draft, setDraft] = useState<DesignData | null>(null)
  const [status, setStatus] = useState('加载中')
  const [retaining, setRetaining] = useState(false)
  async function reload() {
    const response = await fetch(`/fixture${location.search}`)
    const next = await response.json()
    if (!response.ok) throw new Error(next.error)
    setFixture(next); setDraft(next.state)
  }
  useEffect(() => {
    void fetch(`/fixture${location.search}`).then(response => response.json()).then((next: Fixture) => {
      setFixture(next)
      setDraft(next.state)
      setStatus('生成面板已加载')
    }).catch(error => setStatus(String(error)))
  }, [])
  async function save() {
    if (fixture === null || draft === null) return
    const response = await fetch('/save', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ before: fixture.state, after: draft, definitionRevision: fixture.definitionRevision, eventId: crypto.randomUUID() }),
    })
    const result = await response.json()
    setStatus(response.ok ? '设计内容已保存' : `保存失败：${result.error}`)
    if (response.ok && fixture.origin) await reload()
  }
  async function retain() {
    if (!fixture) return
    setRetaining(true)
    try {
      const response = await fetch('/retain', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: fixture.projectId, skill: fixture.skill, sourceRevision: fixture.sourceRevision,
          definitionRevision: fixture.definitionRevision }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      await reload()
    } catch (error) { setStatus(String(error)) }
    finally { setRetaining(false) }
  }
  return <main className='dsh-design-root' style={{ maxWidth: 900, margin: '1rem auto', fontFamily: 'system-ui' }}>
    <style>{DESIGN_TW_CSS + VISUAL_COMPONENTS_CSS + DOCK_CSS}</style>
    <label>测试界面语言 / Test UI language
      <select data-testid="retained-test-locale" value={locale} onChange={event => setLocale(event.target.value as 'zh-CN' | 'en-US')}>
        <option value="zh-CN">简体中文</option><option value="en-US">English</option>
      </select>
    </label>
    <div role='status'>{status}</div>
    {fixture?.origin ? <AutoPanelNotice locale={locale} origin={fixture.origin} sourceChanged={fixture.sourceChanged}
      retaining={retaining} onRetain={() => { void retain() }} /> : null}
    <button onClick={() => { void save() }} disabled={draft === null || previewOnly}>保存设计内容</button>
    {fixture !== null && draft !== null ? <div className='dsh-design-auto-browser-frame' style={{ height: '80vh', overflow: 'auto' }}><div className='dsh-design-auto-surface'>
      {renderManifest(fixture.manifest, draft, {
        locale,
        editable: !previewOnly,
        allowAttachments: false,
        onEdit: edit => setDraft(current => current === null ? null : applyDesignEditToDraft(current, fixture.manifest, edit)),
      })}
    </div></div> : null}
  </main>
}

createRoot(document.getElementById('root')!).render(<App />)
